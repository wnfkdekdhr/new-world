import * as THREE from 'three';

// Keyboard, mouse and touch input
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.x = 0; this.y = 0; this.walk = false; this.jump = false;
    this.lookDX = 0; this.lookDY = 0; this.zoom = 0; this.enabled = false;
    this.onInteract = null; this.onAdvance = null;
    this.canvas = canvas;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { e.preventDefault(); if (this.onAdvance?.()) return; this.jump = true; }
      if (e.code === 'KeyE' || e.code === 'Enter') { if (!this.onAdvance?.()) this.onInteract?.(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    let dragging = false;
    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      if (this.enabled && e.button === 0 && canvas.requestPointerLock && !matchMedia('(pointer: coarse)').matches) {
        try { const p = canvas.requestPointerLock(); p?.catch?.(() => {}); } catch { /* optional */ }
      }
    });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || dragging) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
    });
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); }, { passive: true });
    this._touch();
  }
  _touch() {
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 50;
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = sx - 60 + 'px'; stick.style.top = sy - 60 + 'px'; stick.classList.add('on');
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy; const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.tx = dx / R; this.ty = -dy / R;
        } else if (t.identifier === lookId) { this.lookDX += (t.clientX - lx) * 1.6; this.lookDY += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.tx = this.ty = 0; knob.style.transform = ''; stick.classList.remove('on'); }
        if (t.identifier === lookId) lookId = null;
      }
    };
    this.canvas.addEventListener('touchend', end); this.canvas.addEventListener('touchcancel', end);
    document.getElementById('btnJump')?.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.onAdvance?.()) this.jump = true; });
    document.getElementById('btnAct')?.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.onAdvance?.()) this.onInteract?.(); });
  }
  poll() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.tx || this.ty) { x = this.tx; y = this.ty; }
    this.x = x; this.y = y;
    this.walk = k.has('ShiftLeft') || k.has('ShiftRight') || (Math.hypot(this.tx || 0, this.ty || 0) > 0 && Math.hypot(this.tx, this.ty) < 0.55);
  }
}

// Third-person orbit camera with terrain avoidance
export class FollowCamera {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.yaw = 0; this.pitch = 0.32; this.dist = 7.5; this.targetDist = 7.5;
    this.focus = new THREE.Vector3(); this.initialised = false; this.ray = new THREE.Raycaster();
  }
  update(dt, player, input) {
    this.yaw -= input.lookDX * 0.0032; this.pitch += input.lookDY * 0.0026;
    input.lookDX = input.lookDY = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.25, 1.15);
    this.targetDist = THREE.MathUtils.clamp(this.targetDist + input.zoom * 0.9, 3, 16); input.zoom = 0;
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);
    const want = player.pos.clone().add(new THREE.Vector3(0, 1.55, 0));
    if (!this.initialised) { this.focus.copy(want); this.initialised = true; }
    this.focus.lerp(want, Math.min(1, dt * 10));
    const cp = Math.cos(this.pitch);
    const pos = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist).add(this.focus);
    // pull the camera in front of buildings that block the view
    const dir = pos.clone().sub(this.focus); const len = dir.length(); dir.divideScalar(len);
    this.ray.set(this.focus, dir); this.ray.far = len;
    const hit = this.ray.intersectObjects(this.world.occluders, true)[0];
    if (hit) pos.copy(this.focus).addScaledVector(dir, Math.max(1.2, hit.distance - 0.4));
    const g = this.world.heightAt(pos.x, pos.z) + 0.6;
    if (pos.y < g) pos.y = g;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.focus);
  }
  // Align behind the player without a jump cut
  snapBehind(player) { this.yaw = player.facing + Math.PI; this.initialised = false; }
}
