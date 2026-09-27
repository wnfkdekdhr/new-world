import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { World, shared } from './world.js';
import { PLACES } from './terrain.js';
import { Actor, NPC, Player } from './characters.js';
import { Input, FollowCamera } from './controls.js';
import { DIALOGUE, NAMES, INTRO_NARRATION, SHARD_INFO } from './story.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.3, 0.98);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uWarm: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uWarm; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.08 + uWarm*0.08);
      c.rgb = mix(c.rgb, c.rgb*vec3(1.05,1.0,0.92), 0.4 + uWarm*0.4);
      float v = smoothstep(0.95, 0.25, length(vUv-0.5)*1.25);
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c; }`,
});
composer.addPass(grade);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------- game state ----------
const world = new World(scene, renderer);
const input = new Input(canvas);
const follow = new FollowCamera(camera, world);
const sound = new Sound();
let player, npcs = {}, shards = [], lantern;
const state = { phase: 'loading', quest: 'meet', found: new Set(), talkedBron: false, metKael: false, ignited: false };
let mist = { density: 0.0045, target: 0.0045, color: new THREE.Color(0x8e98a2), targetColor: new THREE.Color(0x8e98a2) };

// ---------- loading ----------
let loaded = 0; const TOTAL = 60;
const bump = () => { loaded++; $('loadbar').style.width = Math.min(100, (loaded / TOTAL) * 100) + '%'; };

async function boot() {
  await world.build(bump);
  const [knight, mage, barb, rogue] = await Promise.all(['Knight', 'Mage', 'Barbarian', 'Rogue_Hooded'].map((k) => Actor.load(k, bump)));
  scene.add(knight.root, mage.root, barb.root, rogue.root);
  player = new Player(knight, world);
  player.place(0, 36, Math.PI);
  const bs = world.spots.building_blacksmith_blue;
  npcs.elara = new NPC(mage, { id: 'elara', name: NAMES.elara, x: 3, z: 7, ry: 0.3, world });
  npcs.bron = new NPC(barb, { id: 'bron', name: NAMES.bron, x: bs.x * 0.72, z: bs.z * 0.72, ry: Math.atan2(-bs.x, -bs.z), world });
  npcs.kael = new NPC(rogue, { id: 'kael', name: NAMES.kael, x: PLACES.ruins.x + 9, z: PLACES.ruins.z - 1, ry: -1.2, world });
  makeShards(); makeLantern();
  world.bakeEnvironment();
  renderer.compile(scene, camera);
  $('loadbar').style.width = '100%';
  $('loading').classList.add('done');
  state.phase = 'title';
  $('title').hidden = false;
  if (params.has('shot')) return debugShot(params.get('shot'));
}

// ---------- shards & lantern ----------
function crystalMesh(color, size = 0.55) {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(size, 0); geo.scale(1, 1.8, 1);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.5, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.95 });
  const core = new THREE.Mesh(geo, mat); g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  halo.scale.setScalar(size * 4.5); g.add(halo);
  const light = new THREE.PointLight(color, 6, 10, 1.8); g.add(light);
  g.userData = { core, halo, light };
  return g;
}
let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c); return _glow;
}
function makeShards() {
  const defs = [
    ['woods', PLACES.shrine.x, PLACES.shrine.z, 0x9dffb0],
    ['lake', PLACES.lakeShard.x, PLACES.lakeShard.z, 0x8fd8ff],
    ['ruins', PLACES.ruins.x, PLACES.ruins.z, 0xffc27a],
  ];
  for (const [id, x, z, col] of defs) {
    const m = crystalMesh(col);
    const y = world.heightAt(x, z) + 1.6;
    m.position.set(x, y, z); scene.add(m);
    shards.push({ id, mesh: m, x, z, baseY: y, taken: false });
  }
}
function makeLantern() {
  const T = PLACES.tower;
  const x = T.x + 0.5, z = T.z + 7.5, y = world.heightAt(x, z);
  const g = new THREE.Group(); g.position.set(x, y, z);
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.1, 8), stone); base.position.y = 0.55;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.6, 0.5, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
  bowl.position.y = 1.35;
  [base, bowl].forEach((m) => { m.castShadow = m.receiveShadow = true; g.add(m); });
  const heart = crystalMesh(0xffd28a, 0.5); heart.position.y = 2.1; g.add(heart);
  heart.userData.core.material.emissiveIntensity = 0.05; heart.userData.halo.material.opacity = 0; heart.userData.light.intensity = 0;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.9, 140, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 72; g.add(beam);
  scene.add(g);
  world.colliders.push({ x, z, r: 1.3 });
  lantern = { group: g, heart, beam, x, z, glow: 0 };
}

// ---------- UI helpers ----------
const ui = {
  prompt(text) { const p = $('prompt'); if (text) { p.textContent = text; p.hidden = false; } else p.hidden = true; },
  toast(title, sub) {
    const t = $('toast'); t.querySelector('b').textContent = title; t.querySelector('span').textContent = sub || '';
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  },
  quest() {
    const q = $('quest');
    const map = {
      meet: ['마을 우물가의 엘라라와 이야기하기', ''],
      shards: ['빛의 파편 찾기', `${state.found.size} / 3`],
      return: ['등불탑의 엘라라에게 돌아가기', '3 / 3'],
      done: ['제1장 완료', ''],
    }[state.quest];
    q.querySelector('.obj').textContent = map[0]; q.querySelector('.count').textContent = map[1];
    const list = q.querySelector('.shardlist');
    list.hidden = state.quest !== 'shards';
    list.innerHTML = ['woods', 'lake', 'ruins'].map((id) => `<li class="${state.found.has(id) ? 'got' : ''}">${SHARD_INFO[id].title}</li>`).join('');
  },
};

// ---------- dialogue ----------
const dlg = { active: false, lines: [], i: 0, typing: false, full: '', timer: 0, choice: null, onEnd: null, speaker: null };
function startDialogue(key, onEnd) {
  dlg.active = true; dlg.lines = DIALOGUE[key].slice(); dlg.i = 0; dlg.onEnd = onEnd;
  player.locked = true; $('dialogue').hidden = false; ui.prompt(null);
  document.exitPointerLock?.();
  nextLine();
}
function nextLine() {
  const L = dlg.lines[dlg.i];
  if (!L) return endDialogue();
  if (L.goto) { dlg.lines = DIALOGUE[L.goto].slice(); dlg.i = 0; return nextLine(); }
  if (L.quest) { dlg.i++; beginShardQuest(); return nextLine(); }
  if (L.event) { dlg.i++; const ev = L.event; endDialogue(); return runEvent(ev); }
  if (L.choice) {
    $('dlgText').textContent = ''; $('dlgName').textContent = NAMES.hero;
    const box = $('choices'); box.innerHTML = ''; box.hidden = false; dlg.choice = L.choice;
    L.choice.forEach(([label, go], n) => {
      const b = document.createElement('button'); b.id = 'choice' + n; b.textContent = `${n + 1}. ${label}`;
      b.onclick = () => pick(go); box.appendChild(b);
    });
    box.querySelector('button').focus();
    return;
  }
  const [who, text] = L;
  $('dlgName').textContent = NAMES[who]; $('dialogue').dataset.who = who;
  dlg.full = text; dlg.shown = 0; dlg.typing = true;
  $('dlgText').textContent = '';
  const npc = npcs[who]; if (npc && Math.random() < 0.5) npc.actor.gesture(who === 'elara' ? 'Spellcast_Raise' : 'Interact', npc.idle);
  sound.blip();
}
function pick(go) { $('choices').hidden = true; dlg.choice = null; dlg.lines = DIALOGUE[go].slice(); dlg.i = 0; sound.click(); nextLine(); }
function advance() {
  if (!dlg.active) return false;
  if (dlg.choice) return true;
  if (dlg.typing) { dlg.typing = false; $('dlgText').textContent = dlg.full; return true; }
  dlg.i++; nextLine(); return true;
}
function endDialogue() {
  dlg.active = false; $('dialogue').hidden = true; $('choices').hidden = true; player.locked = false;
  const cb = dlg.onEnd; dlg.onEnd = null; cb?.();
}
addEventListener('keydown', (e) => {
  if (dlg.choice && (e.code === 'Digit1' || e.code === 'Digit2')) pick(dlg.choice[+e.code.slice(-1) - 1][1]);
});
$('dialogue').addEventListener('click', () => advance());

input.onAdvance = () => {
  if (state.phase === 'intro') { skipIntro(); return true; }
  return advance();
};
input.onInteract = () => {
  if (state.phase !== 'play' || dlg.active) return;
  const t = nearestInteractable();
  if (!t) return;
  if (t.type === 'npc') talkTo(t.npc.id);
  if (t.type === 'shard') takeShard(t.shard);
};

function talkTo(id) {
  if (id === 'elara') {
    if (state.quest === 'meet') return startDialogue('elara_intro');
    if (state.quest === 'shards') return startDialogue('elara_wait');
    if (state.quest === 'return') return startDialogue('elara_final');
    return startDialogue('elara_after_ignite');
  }
  if (id === 'bron') { const k = state.talkedBron ? 'bron_after' : 'bron'; state.talkedBron = true; return startDialogue(k); }
  if (id === 'kael') { const k = state.metKael ? 'kael_after' : 'kael'; state.metKael = true; return startDialogue(k); }
}

function beginShardQuest() {
  state.quest = 'shards'; ui.quest();
  ui.toast('새 임무', '빛의 파편 세 조각을 찾아라');
  sound.chime(0);
}

function takeShard(s) {
  if (s.taken) return;
  if (s.id === 'ruins' && !state.metKael) { talkTo('kael'); return; }
  s.taken = true; state.found.add(s.id);
  player.gesture('PickUp', 1.1);
  s.fly = 0;
  ui.toast(SHARD_INFO[s.id].title + ' 획득', SHARD_INFO[s.id].line);
  sound.chime(state.found.size);
  // each shard pushes the mist back a little
  mist.target = 0.0045 - state.found.size * 0.0008;
  if (state.found.size === 3) {
    state.quest = 'return';
    npcs.elara.setPos(PLACES.tower.x - 3, PLACES.tower.z + 11, 0.6);
    setTimeout(() => ui.toast('파편을 모두 모았다', '등불탑의 엘라라에게 돌아가자'), 2600);
  }
  ui.quest();
}

function runEvent(ev) {
  if (ev === 'ignite') {
    state.phase = 'cutscene'; player.locked = true;
    const t0 = performance.now();
    sound.swell();
    cutscene = { t0, dur: 7.5, from: camera.position.clone(), kind: 'ignite' };
  }
  if (ev === 'chapterEnd') {
    state.quest = 'done'; ui.quest();
    setTimeout(() => { $('chapterEnd').hidden = false; document.exitPointerLock?.(); }, 800);
  }
}

function nearestInteractable() {
  let best = null, bd = 1e9;
  for (const n of Object.values(npcs)) { const d = n.pos.distanceTo(player.pos); if (d < 3.4 && d < bd) { bd = d; best = { type: 'npc', npc: n }; } }
  for (const s of shards) if (!s.taken) { const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z); if (d < 3.2 && d < bd) { bd = d; best = { type: 'shard', shard: s }; } }
  return best;
}

// ---------- compass ----------
function objectiveTargets() {
  if (state.quest === 'meet') return [{ x: npcs.elara.pos.x, z: npcs.elara.pos.z, label: NAMES.elara }];
  if (state.quest === 'shards') return shards.filter((s) => !s.taken).map((s) => ({ x: s.x, z: s.z, label: SHARD_INFO[s.id].title }));
  if (state.quest === 'return') return [{ x: npcs.elara.pos.x, z: npcs.elara.pos.z, label: '등불탑' }];
  return [];
}
function updateCompass() {
  const yaw = follow.yaw; // camera forward = (-sin, -cos)
  const heading = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const W = $('compass').clientWidth; const FOV = Math.PI * 0.9;
  const pos = (ang) => { const d = wrap(ang - heading); return Math.abs(d) > FOV / 2 ? null : (0.5 - d / FOV) * W; };
  // cardinal marks: north = -z
  const marks = [['북', Math.PI], ['동', Math.PI / 2], ['남', 0], ['서', -Math.PI / 2]];
  const el = $('marks'); let html = '';
  for (const [t, a] of marks) { const p = pos(a); if (p !== null) html += `<i style="left:${p}px">${t}</i>`; }
  for (const o of objectiveTargets()) {
    const a = Math.atan2(o.x - player.pos.x, o.z - player.pos.z); const p = pos(a);
    const dist = Math.round(Math.hypot(o.x - player.pos.x, o.z - player.pos.z));
    if (p !== null) html += `<em style="left:${p}px"><span>${o.label} ${dist}m</span></em>`;
  }
  el.innerHTML = html;
}

// ---------- intro cinematic ----------
let intro = null, cutscene = null;
const introPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(260, 70, 210), new THREE.Vector3(170, 40, 150), new THREE.Vector3(60, 34, -40),
  new THREE.Vector3(10, 30, -60), new THREE.Vector3(-20, 16, 55), new THREE.Vector3(-3, 4.2, 38),
]);
const introLook = new THREE.CatmullRomCurve3([
  new THREE.Vector3(178, 0, 78), new THREE.Vector3(60, 5, -40), new THREE.Vector3(0, 18, -96),
  new THREE.Vector3(0, 18, -96), new THREE.Vector3(0, 6, 0), new THREE.Vector3(-3, 1.6, 26),
]);
function startIntro() {
  $('title').hidden = true; sound.start();
  state.phase = 'intro'; intro = { t: 0, dur: 22, line: -1 };
  document.body.classList.add('cine');
}
function skipIntro() { if (intro) intro.t = intro.dur; }
function updateIntro(dt) {
  intro.t += dt;
  const u = Math.min(1, intro.t / intro.dur); const e = u * u * (3 - 2 * u);
  camera.position.copy(introPath.getPointAt(e)); camera.lookAt(introLook.getPointAt(e));
  const line = Math.min(INTRO_NARRATION.length - 1, Math.floor((intro.t / intro.dur) * INTRO_NARRATION.length));
  if (line !== intro.line) { intro.line = line; const n = $('narration'); n.classList.remove('show'); void n.offsetWidth; n.textContent = INTRO_NARRATION[line]; n.classList.add('show'); }
  if (u >= 1) {
    intro = null; document.body.classList.remove('cine');
    state.phase = 'play'; input.enabled = true;
    follow.snapBehind(player);
    $('hud').hidden = false; ui.quest();
    ui.toast('제1장 · 꺼진 등불', '우물가의 엘라라를 찾아가자');
  }
}
function updateCutscene(dt) {
  const c = cutscene; const t = (performance.now() - c.t0) / 1000; const u = Math.min(1, t / c.dur);
  const L = lantern;
  const orbit = 0.6 + u * 1.4;
  const target = new THREE.Vector3(L.x, L.group.position.y + 4 + u * 10, L.z);
  const camPos = new THREE.Vector3(L.x + Math.sin(orbit) * (12 + u * 10), L.group.position.y + 3 + u * 12, L.z + Math.cos(orbit) * (12 + u * 10));
  camera.position.lerp(camPos, Math.min(1, dt * 2)); camera.lookAt(target);
  L.glow = Math.min(1, t / 2.5);
  if (u > 0.35 && !state.ignited) {
    state.ignited = true;
    mist.target = 0.0016; mist.targetColor.set(0xc4b294);
    grade.uniforms.uWarm.value = 1;
  }
  if (u >= 1) {
    cutscene = null; state.phase = 'play'; player.locked = false; follow.initialised = false;
    startDialogue('elara_after_ignite');
  }
}
$('startBtn').addEventListener('click', startIntro);
$('againBtn').addEventListener('click', () => { $('chapterEnd').hidden = true; });

// ---------- main loop ----------
const clock = new THREE.Timer();
function frame() {
  clock.update(); const dt = Math.min(0.05, clock.getDelta());
  shared.time.value += dt;
  if (state.phase === 'loading') { requestAnimationFrame(frame); return; }
  input.poll();
  if (state.phase === 'title') {
    const t = shared.time.value * 0.03;
    camera.position.set(Math.sin(t) * 60, 30, 60 + Math.cos(t) * 30); camera.lookAt(0, 10, -40);
  } else if (state.phase === 'intro') updateIntro(dt);
  else if (state.phase === 'cutscene') updateCutscene(dt);
  if (player) {
    player.update(dt, state.phase === 'play' ? input : { x: 0, y: 0 }, follow.yaw);
    if (state.phase === 'play') follow.update(dt, player, input);
    for (const n of Object.values(npcs)) n.update(dt, player);
    shared.playerXZ.value.set(player.pos.x, player.pos.z);
    const focus = state.phase === 'play' ? player.pos : camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30));
    world.followShadow(new THREE.Vector3(focus.x, world.heightAt(focus.x, focus.z), focus.z));
    if (state.phase !== 'play') shared.playerXZ.value.set(focus.x, focus.z);
  }
  world.update(dt, shared.playerXZ.value);
  // shards bob, taken shards fly into the hero
  for (const s of shards) {
    const m = s.mesh; if (!m.visible) continue;
    m.userData.core.rotation.y += dt * 1.2;
    if (!s.taken) { m.position.y = s.baseY + Math.sin(shared.time.value * 2 + s.x) * 0.2; m.userData.light.intensity = 6 + Math.sin(shared.time.value * 3) * 2; }
    else {
      s.fly += dt; const tgt = player.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      m.position.lerp(tgt, Math.min(1, dt * 4)); m.scale.setScalar(Math.max(0.01, 1 - s.fly));
      if (s.fly > 1) m.visible = false;
    }
  }
  if (lantern) {
    const g = lantern.glow; const h = lantern.heart.userData;
    h.core.material.emissiveIntensity = 0.05 + g * 5; h.halo.material.opacity = g; h.light.intensity = g * 40; h.light.distance = 40;
    lantern.beam.material.opacity = g * (0.1 + Math.sin(shared.time.value * 2) * 0.02);
    lantern.heart.rotation.y += dt * 0.6;
  }
  // mist
  mist.density += (mist.target - mist.density) * Math.min(1, dt * 0.6);
  mist.color.lerp(mist.targetColor, Math.min(1, dt * 0.4));
  scene.fog.density = mist.density; scene.fog.color.copy(mist.color);
  if (state.phase === 'play' && !dlg.active) {
    const t = nearestInteractable();
    ui.prompt(t ? (t.type === 'npc' ? `E  ${t.npc.name}와 대화하기` : 'E  빛의 파편 줍기') : null);
    updateCompass();
  }
  if (dlg.active && dlg.typing) {
    dlg.shown += dt * 38; const n = Math.floor(dlg.shown);
    $('dlgText').textContent = dlg.full.slice(0, n);
    if (n >= dlg.full.length) dlg.typing = false;
  }
  composer.render(dt); window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}

// Screenshot helper for automated previews: ?shot=village|intro|dialogue|shard|tower
function debugShot(kind) {
  state.phase = 'play'; $('title').hidden = true; $('hud').hidden = false; ui.quest();
  if (kind === 'village') { player.place(1, 16, 2.9); follow.yaw = 0.25; follow.pitch = 0.22; }
  if (kind === 'wide') { player.place(20, 62, Math.PI); follow.yaw = -0.2; follow.pitch = 0.35; follow.targetDist = follow.dist = 14; }
  if (kind === 'dialogue') { player.place(2, 10.5, Math.PI); follow.yaw = 0.9; follow.pitch = 0.2; follow.targetDist = follow.dist = 5; setTimeout(() => { startDialogue('elara_intro'); dlg.typing = false; $('dlgText').textContent = dlg.full; }, 100); }
  if (kind === 'shard') { state.quest = 'shards'; ui.quest(); player.place(PLACES.shrine.x - 5, PLACES.shrine.z + 6, 2.4); follow.yaw = -0.7; follow.pitch = 0.18; }
  if (kind === 'lake') { state.quest = 'shards'; ui.quest(); player.place(PLACES.lakeShard.x - 7, PLACES.lakeShard.z - 3, 1.2); follow.yaw = -1.75; follow.pitch = 0.22; follow.targetDist = follow.dist = 9; }
  if (kind === 'tower') { state.quest = 'return'; ui.quest(); player.place(PLACES.tower.x + 3, PLACES.tower.z + 14, 2.6); follow.yaw = 0.9; follow.pitch = 0.3; follow.targetDist = follow.dist = 10; lantern.glow = 1; mist.target = mist.density = 0.0016; mist.targetColor.set(0xc4b294); mist.color.set(0xc4b294); }
  if (kind === 'ruins') { state.quest = 'shards'; ui.quest(); player.place(PLACES.ruins.x + 14, PLACES.ruins.z + 3, -1.6); follow.yaw = -1.2; follow.pitch = 0.25; follow.targetDist = follow.dist = 9; }
  follow.initialised = false;
  window.__frames = 0; window.__ready = true;
}

requestAnimationFrame(frame);
boot().catch((e) => { console.error(e); $('loadmsg').textContent = '불러오기에 실패했어요: ' + e.message; });
