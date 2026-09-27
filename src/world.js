import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { Terrain, WORLD_SIZE, GRID, CELL, PLACES, noise } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';

const loader = new GLTFLoader();
// Decode embedded textures through <img> rather than fetch(blob:), which strict CSPs refuse
loader.register((parser) => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'img_texture_loader' }; });
// Artifact hosting cannot serve .glb and its CSP blocks fetching data: URIs, so that build
// ships each GLB as base64 inside a .json file and decodes it here.
export const MODEL_EXT = import.meta.env.VITE_MODEL_EXT || '.glb';
const cache = new Map();
async function fetchModel(url) {
  if (MODEL_EXT !== '.json') return loader.loadAsync(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const bin = atob((await res.json()).glb);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return loader.parseAsync(bytes.buffer, '');
}
export function loadGLB(url, onProgress) {
  if (!cache.has(url)) cache.set(url, fetchModel(url).then((g) => { onProgress?.(); return g; }));
  return cache.get(url);
}

export const shared = { time: { value: 0 }, playerXZ: { value: new THREE.Vector2() } };

export class World {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.terrain = new Terrain();
    this.colliders = []; // {x,z,r}
    this.animated = [];
    this.occluders = [];
  }

  async build(progress) {
    this._sky();
    this._terrainMesh();
    this._water();
    this._grass();
    await this._props(progress);
    this._ambientParticles();
  }

  heightAt(x, z) { return this.terrain.heightAt(x, z); }

  _sky() {
    const sky = new Sky(); sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = 5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.0025; u.mieDirectionalG.value = 0.8;
    this.sky = sky;
    this.sun = new THREE.Vector3();
    this.setSun(13, 205);
    this.scene.add(sky);

    const sunLight = new THREE.DirectionalLight(0xffe2b8, 3.0);
    sunLight.castShadow = true;
    const S = 45;
    Object.assign(sunLight.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.6;
    this.sunLight = sunLight;
    this.scene.add(sunLight, sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a4a30, 0.7);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0x8e98a2, 0.0045);
  }

  setSun(elevationDeg, azimuthDeg) {
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg), theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sun.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sun);
    if (this.water) this.water.material.uniforms.sunDirection.value.copy(this.sun).normalize();
  }

  bakeEnvironment() {
    // Soft gradient sky for image-based light; the real sky's sun disk would blow out lit faces
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(0x7fa6d4) }, mid: { value: new THREE.Color(0xd8d0bd) }, bot: { value: new THREE.Color(0x4f4a3a) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }',
    }));
    envScene.add(dome);
    if (this.envRT) this.envRT.dispose();
    this.envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  followShadow(target) {
    const L = this.sunLight;
    L.position.copy(target).addScaledVector(this.sun, 160);
    L.target.position.copy(target);
    // snap to texel grid to avoid shimmering
    const texel = (2 * 45) / 2048;
    L.position.x = Math.round(L.position.x / texel) * texel; L.position.z = Math.round(L.position.z / texel) * texel;
    L.target.position.x = Math.round(L.target.position.x / texel) * texel; L.target.position.z = Math.round(L.target.position.z / texel) * texel;
  }

  _terrainMesh() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.terrain.heights[i]);
    geo.setAttribute('color', new THREE.BufferAttribute(this.terrain.colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float d1 = vn(vWPos.xz*0.9), d2 = vn(vWPos.xz*3.7), d3 = vn(vWPos.xz*0.12);
diffuseColor.rgb *= 0.82 + 0.18*d1 + 0.10*(d2-0.5) + 0.12*(d3-0.5);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrainMesh = mesh;
  }

  _water() {
    const tex = new THREE.TextureLoader().load('assets/waternormals.jpg', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
    const L = PLACES.lake;
    const geo = new THREE.CircleGeometry(L.r + 60, 64);
    const water = new Water(geo, {
      textureWidth: 512, textureHeight: 512, waterNormals: tex,
      sunDirection: this.sun.clone().normalize(), sunColor: 0xfff0d0, waterColor: 0x1d4a55,
      distortionScale: 2.2, fog: true,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.set(L.x, 0, L.z);
    water.material.uniforms.size.value = 3.5;
    this.water = water;
    this.scene.add(water);
  }

  _grass() {
    const RANGE = 90; this.grassRange = RANGE;
    const touch = matchMedia('(pointer: coarse)').matches;
    const COUNT = touch ? 45000 : 140000;
    const blade = new THREE.BufferGeometry();
    const SEG = 4; const verts = []; const ts = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG; const w = 0.05 * (1 - t * 0.85);
      if (i < SEG) { verts.push(-w, t, 0, w, t, 0); ts.push(t, t); } else { verts.push(0, 1, 0); ts.push(1); }
    }
    const idx = [];
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = (SEG - 1) * 2; idx.push(a, a + 1, a + 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
    geo.setIndex(idx);
    const off = new Float32Array(COUNT * 2), rnd = new Float32Array(COUNT * 4);
    const r = mulberry32(99);
    for (let i = 0; i < COUNT; i++) {
      off[i * 2] = r() * RANGE; off[i * 2 + 1] = r() * RANGE;
      rnd[i * 4] = r() * Math.PI * 2; rnd[i * 4 + 1] = 0.3 + r() * 0.45; rnd[i * 4 + 2] = r(); rnd[i * 4 + 3] = r();
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = COUNT;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const hTex = new THREE.DataTexture(this.terrain.packTexture(), GRID, GRID, THREE.RGBAFormat, THREE.FloatType);
    hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true;

    const mat = new THREE.MeshLambertMaterial({ color: 0x6f9a3a, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uH: { value: hTex }, uCenter: shared.playerXZ, uTime: shared.time });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 aOff; attribute vec4 aRnd; attribute float aT;
uniform sampler2D uH; uniform vec2 uCenter; uniform float uTime;
varying float vT; varying float vShade;
vec2 sampleH(vec2 wp){
  vec2 f = (wp + ${(WORLD_SIZE / 2).toFixed(1)}) / ${CELL.toFixed(4)};
  ivec2 i = ivec2(floor(f)); vec2 t = fract(f);
  vec2 a = texelFetch(uH, clamp(i, ivec2(0), ivec2(${GRID - 1})), 0).rg;
  vec2 b = texelFetch(uH, clamp(i+ivec2(1,0), ivec2(0), ivec2(${GRID - 1})), 0).rg;
  vec2 c = texelFetch(uH, clamp(i+ivec2(0,1), ivec2(0), ivec2(${GRID - 1})), 0).rg;
  vec2 d = texelFetch(uH, clamp(i+ivec2(1,1), ivec2(0), ivec2(${GRID - 1})), 0).rg;
  if (t.x + t.y <= 1.0) return a + (b-a)*t.x + (c-a)*t.y;
  return d + (c-d)*(1.0-t.x) + (b-d)*(1.0-t.y);
}`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
float R = ${RANGE.toFixed(1)};
vec2 wp = uCenter + mod(aOff - uCenter + R*0.5, R) - R*0.5;
vec2 hs = sampleH(wp);
float edge = 1.0 - smoothstep(R*0.36, R*0.5, length(wp - uCenter));
float keep = step(aRnd.w, hs.y * 1.15) * edge;
float hgt = aRnd.y * (0.55 + 0.5*hs.y) * keep;
float ca = cos(aRnd.x), sa = sin(aRnd.x);
vec3 p = position; p.y *= hgt; p.x *= (0.8 + aRnd.z*0.6);
float wind = sin(uTime*1.7 + wp.x*0.12 + wp.y*0.09) * 0.5 + sin(uTime*3.1 + wp.x*0.6) * 0.18;
float bend = (0.25 + aRnd.z*0.3 + wind*0.35) * aT * aT * hgt;
vec3 bp = vec3(p.x*ca, p.y, p.x*sa);
bp.x += bend * 0.8; bp.z += bend * 0.45;
vec3 transformed = vec3(wp.x, hs.x - 0.05, wp.y) + bp;
vT = aT; vShade = aRnd.z;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vT; varying float vShade;')
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 base = mix(vec3(0.08,0.17,0.03), vec3(0.20,0.34,0.07), vShade);
vec3 tip = mix(vec3(0.34,0.48,0.13), vec3(0.50,0.52,0.21), vShade*vShade);
diffuseColor.rgb = mix(base, tip, smoothstep(0.0, 1.0, vT));`);
    };
    const depthMat = new THREE.MeshDepthMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.grassMesh = mesh;
    void depthMat;
  }

  async _envModel(name) { const g = await loadGLB(`assets/env/${name}${MODEL_EXT}`, this._onAsset); return g.scene; }

  // Instanced scatter of a model with a list of {x,z,s,ry,y?}
  async _instances(name, list, { collide = 0, sway = false, cast = true } = {}) {
    if (!list.length) return;
    const root = await this._envModel(name);
    root.updateMatrixWorld(true);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mat = o.material.clone(); mat.roughness = 1; mat.metalness = 0;
      if (sway) {
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = shared.time;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
float sw = sin(uTime*1.2 + ip.x*0.15 + ip.z*0.21) * 0.035 * max(position.y - 0.25, 0.0);
transformed.x += sw; transformed.z += sw*0.6;`);
        };
      }
      const im = new THREE.InstancedMesh(o.geometry, mat, list.length);
      list.forEach((t, i) => {
        const y = t.y ?? this.heightAt(t.x, t.z) - (t.sink ?? 0.15);
        q.setFromAxisAngle(up, t.ry ?? 0);
        m.compose(new THREE.Vector3(t.x, y, t.z), q, new THREE.Vector3(t.s, t.s * (t.sy ?? 1), t.s));
        m.multiply(o.matrixWorld);
        im.setMatrixAt(i, m);
      });
      im.castShadow = cast; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    });
    if (collide) for (const t of list) this.colliders.push({ x: t.x, z: t.z, r: collide * t.s });
  }

  async _placeModel(name, x, z, s, ry, { collide = 0.55, sink = 0.2, y } = {}) {
    const root = (await this._envModel(name)).clone();
    root.position.set(x, y ?? this.heightAt(x, z) - sink, z);
    root.scale.setScalar(s); root.rotation.y = ry;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.roughness = 0.95; o.material.metalness = 0; } });
    this.scene.add(root);
    if (collide) this.colliders.push({ x, z, r: collide * s });
    if (s >= 5) this.occluders.push(root);
    return root;
  }

  async _props(progress) {
    this._onAsset = progress;
    const BS = 6.5;
    const face = (x, z) => Math.atan2(-x, -z); // rotate so +Z of the model faces the plaza
    // Village ring
    const ring = [
      ['building_tavern_blue', 22, 23], ['building_home_A_blue', 55, 25], ['building_market_blue', 128, 23],
      ['building_home_B_red', 158, 25], ['building_blacksmith_blue', 205, 24], ['building_home_A_red', 238, 26],
      ['building_home_B_blue', 302, 25], ['building_church_blue', 334, 30],
    ];
    const jobs = [];
    this.spots = {};
    for (const [name, deg, r] of ring) {
      const a = THREE.MathUtils.degToRad(deg); const x = Math.cos(a) * r, z = Math.sin(a) * r;
      jobs.push(this._placeModel(name, x, z, BS, face(x, z)));
      this.spots[name] = { x, z };
    }
    jobs.push(this._placeModel('building_well_blue', 0, 0, 4.2, 0.4, { collide: 0.45 }));
    jobs.push(this._placeModel('building_windmill_blue', -48, 40, 8, 0.8, { collide: 0.4 }));
    jobs.push(this._placeModel('building_watermill_blue', 113, 58, 6.5, 2.2, { collide: 0.5 }));
    jobs.push(this._placeModel('building_grain', -34, 52, 6, 0.3, { collide: 0 }));
    jobs.push(this._placeModel('building_grain', -60, 58, 6, 0.9, { collide: 0 }));
    // Lantern tower
    const T = PLACES.tower;
    this.lanternTower = await this._placeModel('building_tower_A_blue', T.x, T.z - 3, 8.5, 0, { collide: 0.45, sink: 0.1 });
    // Ruins on the west hill
    const R = PLACES.ruins;
    const rr = mulberry32(5);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2; const d = 17 + rr() * 3;
      const x = R.x + Math.cos(a) * d, z = R.z + Math.sin(a) * d;
      if (i === 3) continue; // gap for the road
      jobs.push(this._placeModel(i % 3 === 0 ? 'wall_straight' : 'fence_stone_straight', x, z, 6, -a + Math.PI / 2, { collide: 0.4 }));
    }
    jobs.push(this._placeModel('building_destroyed', R.x - 6, R.z - 5, 7, 0.6, { collide: 0.5 }));
    jobs.push(this._placeModel('building_destroyed', R.x + 8, R.z + 6, 6, 2.1, { collide: 0.5 }));
    jobs.push(this._placeModel('building_stage_C', R.x + 7, R.z - 8, 6, 1.1, { collide: 0.5 }));

    // Props around the village
    const props = [
      ['barrel', 17, 13, 3.5], ['barrel', 18.5, 11.5, 3.2], ['crate_A_big', 14, 15, 3.2], ['sack', 4, 16, 3.5], ['wheelbarrow', -8, 15, 3.4],
      ['crate_B_small', 5.5, 17, 3], ['weaponrack', -16, -12, 3.5], ['barrel', -18, -15, 3.2], ['resource_lumber', -22, -4, 3.5],
      ['tent', 30, -2, 5], ['flag_blue', 9, -9, 4], ['flag_blue', -9, -9, 4], ['bucket_water', 2.6, 2.2, 3], ['target', -30, 20, 4],
      ['tent', -155, 50, 5], ['crate_long_A', -160, 30, 3], ['barrel', 101, 80, 3.2],
    ];
    for (const [n, x, z, s] of props) jobs.push(this._placeModel(n, x, z, s, (x * 7 + z) % 6.28, { collide: n === 'tent' ? 0.5 : 0.25, sink: 0.05 }).catch(() => {}));
    // Wooden fences along the fields
    for (let i = 0; i < 8; i++) jobs.push(this._placeModel('fence_wood_straight', -30 - i * 4.6, 64, 4, 0, { collide: 0 }));
    await Promise.all(jobs);

    // Scatter nature
    const rnd = mulberry32(2024);
    const trees = { tree_single_A: [], tree_single_B: [], trees_A_large: [], trees_B_large: [], trees_A_medium: [], trees_B_medium: [] };
    const rocks = { rock_single_A: [], rock_single_B: [], rock_single_C: [], rock_single_D: [], rock_single_E: [] };
    const keepClear = (x, z) => {
      if (Math.hypot(x, z) < 52) return true;
      if (this.terrain.pathD[this._gi(x, z)] < 6) return true;
      for (const p of [PLACES.tower, PLACES.ruins]) if (Math.hypot(x - p.x, z - p.z) < 26) return true;
      if (Math.hypot(x - PLACES.shrine.x, z - PLACES.shrine.z) < 16) return true;
      if (Math.hypot(x - PLACES.lakeShard.x, z - PLACES.lakeShard.z) < 10) return true;
      if (Math.hypot(x - 113, z - 58) < 12) return true;
      if (Math.hypot(x + 48, z - 50) < 26) return true;
      return false;
    };
    const tNames = Object.keys(trees);
    for (let i = 0; i < 9000 && Object.values(trees).reduce((a, b) => a + b.length, 0) < 2600; i++) {
      const x = (rnd() - 0.5) * 680, z = (rnd() - 0.5) * 680;
      const h = this.heightAt(x, z);
      if (h < 1.3 || h > 48 || this.terrain.slopeAt(x, z) > 0.75 || keepClear(x, z)) continue;
      const f = this.terrain.forestMask(x, z);
      const meadow = smoothstep(0.1, 0.4, noise.fbm(x / 50, z / 50, 2) * 0.5 + 0.2) * 0.25;
      if (rnd() > f + meadow + 0.04) continue;
      const n = f > 0.5 ? tNames[2 + Math.floor(rnd() * 4)] : tNames[Math.floor(rnd() * tNames.length)];
      const big = n.startsWith('trees');
      trees[n].push({ x, z, s: (big ? 5.5 : 6.5) + rnd() * 3, ry: rnd() * 6.28, sy: 0.9 + rnd() * 0.35 });
    }
    const rNames = Object.keys(rocks);
    for (let i = 0; i < 2500 && Object.values(rocks).reduce((a, b) => a + b.length, 0) < 520; i++) {
      const x = (rnd() - 0.5) * 700, z = (rnd() - 0.5) * 700;
      const h = this.heightAt(x, z);
      if (h < -1 || keepClear(x, z)) continue;
      const s = this.terrain.slopeAt(x, z);
      if (rnd() > 0.15 + s * 0.6) continue;
      rocks[rNames[Math.floor(rnd() * rNames.length)]].push({ x, z, s: 3 + rnd() * 6, ry: rnd() * 6.28, sink: 0.4 });
    }
    // Stone circle at the forest shrine
    const S = PLACES.shrine;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      rocks.rock_single_C.push({ x: S.x + Math.cos(a) * 7, z: S.z + Math.sin(a) * 7, s: 5.5, sy: 1.8, ry: a, sink: 0.2 });
    }
    // Rocks and lilies at the lake shard
    const LS = PLACES.lakeShard;
    rocks.rock_single_D.push({ x: LS.x + 3, z: LS.z + 2, s: 6, ry: 1 }, { x: LS.x - 3, z: LS.z + 3, s: 4, ry: 2 });
    const lilies = [];
    for (let i = 0; i < 40; i++) { const a = rnd() * 6.28, d = 6 + rnd() * 30; lilies.push({ x: LS.x + 20 + Math.cos(a) * d, z: LS.z + Math.sin(a) * d, s: 3 + rnd() * 2, ry: rnd() * 6, y: 0.03 }); }
    const sj = [];
    for (const [n, l] of Object.entries(trees)) sj.push(this._instances(n, l, { collide: n.startsWith('trees') ? 0.35 : 0.08, sway: true }));
    for (const [n, l] of Object.entries(rocks)) sj.push(this._instances(n, l, { collide: 0.22 }));
    sj.push(this._instances('waterlily_A', lilies.filter((l) => this.heightAt(l.x, l.z) < -0.6), { cast: false }));
    await Promise.all(sj);

    // Drifting clouds
    const cloud = await this._envModel('cloud_big');
    this.clouds = [];
    for (let i = 0; i < 16; i++) {
      const c = cloud.clone(); c.scale.setScalar(26 + rnd() * 20);
      c.position.set((rnd() - 0.5) * 700, 95 + rnd() * 40, (rnd() - 0.5) * 700); c.rotation.y = rnd() * 6;
      c.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.fog = false; o.material.emissive = new THREE.Color(0x4a4640); o.castShadow = false; } });
      this.scene.add(c); this.clouds.push(c);
    }
  }

  _gi(x, z) {
    const ix = Math.round((x + WORLD_SIZE / 2) / CELL), iz = Math.round((z + WORLD_SIZE / 2) / CELL);
    return this.terrain.idx(ix, iz);
  }

  _ambientParticles() {
    // pollen / fireflies drifting around the player
    const N = 500; const pos = new Float32Array(N * 3); const r = mulberry32(3);
    for (let i = 0; i < N; i++) { pos[i * 3] = r() * 60; pos[i * 3 + 1] = r() * 8; pos[i * 3 + 2] = r() * 60; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: shared.time, uCenter: shared.playerXZ, uH: { value: 0 } },
      vertexShader: `uniform float uTime; uniform vec2 uCenter; varying float vA;
        void main(){ vec3 p = position; float R = 60.0;
          p.xz = uCenter + mod(p.xz - uCenter + R*0.5, R) - R*0.5;
          p.x += sin(uTime*0.3 + position.z)*1.5; p.z += cos(uTime*0.25 + position.x)*1.5;
          p.y += sin(uTime*0.5 + position.x*3.0)*0.6;
          vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
          vA = (0.5 + 0.5*sin(uTime*2.0 + position.x*10.0)) * (1.0 - smoothstep(20.0, 30.0, length(p.xz-uCenter)));
          gl_PointSize = 60.0 / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d);
          gl_FragColor = vec4(vec3(1.0,0.9,0.6)*a*vA*0.8, 1.0); }`,
    });
    this.motes = new THREE.Points(g, m); this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  update(dt, center) {
    this.motes.position.y = this.heightAt(center.x, center.z);
    for (const c of this.clouds || []) { c.position.x += dt * 1.6; if (c.position.x > 380) c.position.x = -380; }
    if (this.water) this.water.material.uniforms.time.value += dt * 0.6;
  }
}
