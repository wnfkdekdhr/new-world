import * as THREE from 'three';
import { loadGLB, MODEL_EXT } from './world.js';

const SHOW = {
  Knight: ['1H_Sword', 'Badge_Shield', 'Knight_Helmet', 'Knight_Cape', 'Knight_ArmLeft', 'Knight_ArmRight', 'Knight_Body', 'Knight_Head', 'Knight_LegLeft', 'Knight_LegRight'],
  Mage: ['2H_Staff', 'Mage_Hat', 'Mage_Cape', 'Mage_ArmLeft', 'Mage_ArmRight', 'Mage_Body', 'Mage_Head', 'Mage_LegLeft', 'Mage_LegRight'],
  Barbarian: ['Mug', 'Barbarian_Hat', 'Barbarian_Cape', 'Barbarian_ArmLeft', 'Barbarian_ArmRight', 'Barbarian_Body', 'Barbarian_Head', 'Barbarian_LegLeft', 'Barbarian_LegRight'],
  Rogue_Hooded: ['Knife', 'Rogue_Cape', 'Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_Head_Hooded', 'Rogue_LegLeft', 'Rogue_LegRight'],
};

export class Actor {
  static async load(kind, onProgress) {
    const g = await loadGLB(`assets/chars/${kind}${MODEL_EXT}`, onProgress);
    return new Actor(kind, g);
  }
  constructor(kind, gltf) {
    this.kind = kind;
    this.root = new THREE.Group();
    const model = gltf.scene;
    const show = new Set(SHOW[kind]);
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        if (!show.has(o.name) && !show.has(o.parent?.name)) o.visible = false;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        if (o.material) { o.material.roughness = 0.75; o.material.metalness = 0.05; }
      }
    });
    // normalise height to ~1.85 m
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.visible && /Body|Head/.test(o.name)) box.expandByObject(o); });
    const h = box.max.y - box.min.y;
    const s = h > 0.1 ? 1.75 / h : 1;
    model.scale.setScalar(s);
    this.model = model;
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = {};
    for (const c of gltf.animations) this.clips[c.name] = c;
    this.current = null;
    this.play('Idle', 0);
  }
  play(name, fade = 0.25, { once = false, speed = 1 } = {}) {
    const clip = this.clips[name]; if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.timeScale = speed;
    if (this.current === action && !once) return action;
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.enabled = true; action.setEffectiveWeight(1);
    if (this.current && fade > 0) action.crossFadeFrom(this.current, fade, true);
    else if (this.current) this.current.stop();
    action.play();
    this.current = action; this.currentName = name;
    return action;
  }
  // Play a one-shot, then return to a loop
  gesture(name, back = 'Idle') {
    const a = this.play(name, 0.2, { once: true });
    if (!a) return;
    const onDone = (e) => { if (e.action === a) { this.mixer.removeEventListener('finished', onDone); this.play(back, 0.3); } };
    this.mixer.addEventListener('finished', onDone);
  }
  update(dt) { this.mixer.update(dt); }
}

export class NPC {
  constructor(actor, { id, name, x, z, ry = 0, idle = 'Idle', world }) {
    Object.assign(this, { actor, id, name, idle, world });
    this.baseRy = ry;
    this.setPos(x, z, ry);
    actor.play(idle, 0);
  }
  setPos(x, z, ry = this.baseRy) {
    this.actor.root.position.set(x, this.world.heightAt(x, z), z);
    this.actor.root.rotation.y = ry; this.baseRy = ry;
  }
  get pos() { return this.actor.root.position; }
  update(dt, player) {
    const p = this.pos; const d = p.distanceTo(player.pos);
    let target = this.baseRy;
    if (d < 6) target = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
    let diff = target - this.actor.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.actor.root.rotation.y += diff * Math.min(1, dt * 4);
    this.actor.update(dt);
  }
}

export class Player {
  constructor(actor, world) {
    this.actor = actor; this.world = world;
    this.vel = new THREE.Vector3(); this.vy = 0; this.onGround = true;
    this.facing = 0; this.locked = false; this.speed = 0;
  }
  get pos() { return this.actor.root.position; }
  place(x, z, facing = 0) { this.pos.set(x, this.world.heightAt(x, z), z); this.facing = facing; this.actor.root.rotation.y = facing; }

  update(dt, input, camYaw) {
    const w = this.world;
    let mx = input.x, mz = input.y; // x = strafe right, y = forward
    const len = Math.hypot(mx, mz);
    if (this.locked) { mx = 0; mz = 0; }
    const moving = !this.locked && len > 0.1;
    const run = !input.walk;
    const targetSpeed = moving ? (run ? 6.8 : 2.6) * Math.min(1, len) : 0;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 8);
    if (moving) {
      // camera looks toward -forward; convert input to world space
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const rx = -fz, rz = fx;
      const dx = fx * mz + rx * mx, dz = fz * mz + rz * mx;
      const dl = Math.hypot(dx, dz) || 1;
      const target = Math.atan2(dx / dl, dz / dl);
      let diff = target - this.facing; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * Math.min(1, dt * 12);
    }
    const step = this.speed * dt;
    if (step > 0.0001) {
      const nx = this.pos.x + Math.sin(this.facing) * step, nz = this.pos.z + Math.cos(this.facing) * step;
      this._tryMove(nx, nz);
    }
    // collisions with props
    for (const c of w.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), r = c.r + 0.4;
      if (d < r && d > 1e-4) { this.pos.x = c.x + (dx / d) * r; this.pos.z = c.z + (dz / d) * r; }
    }
    // jump + gravity
    const ground = w.heightAt(this.pos.x, this.pos.z);
    if (input.jump && this.onGround && !this.locked) { this.vy = 7; this.onGround = false; this.actor.play('Jump_Start', 0.1, { once: true }); this.jumpT = 0; }
    input.jump = false;
    this.vy -= 20 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vy < -3) this.landT = 0.18;
      this.pos.y = ground; this.vy = 0; this.onGround = true;
    } else if (this.pos.y - ground > 0.35) this.onGround = false;
    if (this.onGround && this.pos.y - ground < 0.35) this.pos.y = ground;
    this.actor.root.rotation.y = this.facing;
    this._animate(dt);
    this.actor.update(dt);
  }
  _tryMove(nx, nz) {
    const w = this.world;
    const r = Math.hypot(nx, nz);
    if (r > 330) return;
    const h0 = w.heightAt(this.pos.x, this.pos.z), h1 = w.heightAt(nx, nz);
    const d = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (h1 < -1.1) return; // deep water
    if ((h1 - h0) / d > 1.2 && h1 > h0) return; // too steep to climb
    this.pos.x = nx; this.pos.z = nz;
  }
  _animate(dt) {
    const a = this.actor;
    if (this.gestureLock) return;
    if (!this.onGround) { this.jumpT = (this.jumpT ?? 0) + dt; if (this.jumpT > 0.25) a.play('Jump_Idle', 0.2); return; }
    if (this.landT > 0) { this.landT -= dt; a.play('Jump_Land', 0.08); return; }
    if (this.speed > 4.2) a.play('Running_A', 0.2, { speed: this.speed / 6.8 * 1.05 });
    else if (this.speed > 0.4) a.play('Walking_A', 0.2, { speed: Math.max(0.7, this.speed / 2.6) });
    else a.play('Idle', 0.3);
  }
  gesture(name, dur = 1.2) {
    this.gestureLock = true;
    this.actor.play(name, 0.15, { once: true });
    setTimeout(() => { this.gestureLock = false; }, dur * 1000);
  }
}
