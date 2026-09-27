import { makeNoise, smoothstep, lerp } from './noise.js';

// World layout (x = east, z = south, y = up). Units are meters.
export const WORLD_SIZE = 800;
export const GRID = 321; // samples per side -> 2.5 m cells
export const CELL = WORLD_SIZE / (GRID - 1);
export const WATER_LEVEL = 0;

export const PLACES = {
  village: { x: 0, z: 0, r: 46, level: 3 },
  tower: { x: 0, z: -96, r: 34, top: 17 },
  woods: { x: 150, z: -145 },
  shrine: { x: 152, z: -150 },
  lake: { x: 178, z: 78, r: 56 },
  lakeShard: { x: 106, z: 86 },
  ruins: { x: -168, z: 42, r: 42, top: 19 },
};

// Dirt roads connecting the landmarks (polylines)
export const PATHS = [
  [[0, -8], [2, -30], [-4, -55], [-2, -80], [0, -92]],
  [[10, 0], [40, -10], [70, -40], [100, -80], [130, -120], [148, -146]],
  [[10, 6], [45, 20], [75, 50], [98, 80], [103, 85]],
  [[-10, 4], [-45, 10], [-85, 22], [-120, 30], [-150, 38]],
];

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}
export function pathDistance(x, z) {
  let d = 1e9;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, distToSegment(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
  return d;
}

const noise = makeNoise(1337);

function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 5 + noise.fbm(x / 260, z / 260, 4) * 12 + noise.fbm(x / 55, z / 55, 3) * 2.2;
  h = Math.max(h, 0.9 + noise.n2(x / 30, z / 30) * 0.3);
  // mountain ring that frames the valley
  const ringNoise = noise.fbm(x / 140, z / 140, 2) * 40;
  const m = smoothstep(250 + ringNoise, 370 + ringNoise, r);
  h += m * (30 + noise.ridge(x / 110, z / 110, 5) * 85);
  // hills for the tower and ruins
  const T = PLACES.tower, R = PLACES.ruins;
  const dt = Math.hypot(x - T.x, z - T.z);
  h += 14 * Math.exp(-(dt * dt) / (2 * 22 * 22));
  h = lerp(h, T.top, smoothstep(16, 7, dt));
  const dr = Math.hypot(x - R.x, z - R.z);
  h += 15 * Math.exp(-(dr * dr) / (2 * 34 * 34));
  h = lerp(h, R.top + noise.n2(x / 12, z / 12) * 0.4, smoothstep(30, 18, dr));
  // lake basin
  const L = PLACES.lake;
  const dl = Math.hypot(x - L.x, z - L.z) + noise.fbm(x / 40, z / 40, 3) * 16;
  h = lerp(h, -4.5, smoothstep(L.r + 26, L.r - 8, dl));
  // village plateau
  const V = PLACES.village;
  const dv = Math.hypot(x - V.x, z - V.z) + noise.n2(x / 20, z / 20) * 5;
  h = lerp(h, V.level + noise.n2(x / 15, z / 15) * 0.25, smoothstep(V.r + 18, V.r - 12, dv));
  // soften roads
  const pd = pathDistance(x, z);
  if (pd < 6) h = lerp(h, h - 0.12, smoothstep(6, 1, pd));
  return h;
}

export class Terrain {
  constructor() {
    const N = GRID;
    this.heights = new Float32Array(N * N);
    this.grass = new Float32Array(N * N);
    this.colors = new Float32Array(N * N * 3);
    this.pathD = new Float32Array(N * N);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x = -WORLD_SIZE / 2 + ix * CELL, z = -WORLD_SIZE / 2 + iz * CELL;
      this.heights[iz * N + ix] = rawHeight(x, z);
      this.pathD[iz * N + ix] = pathDistance(x, z);
    }
    this._shade();
  }
  idx(ix, iz) { return Math.min(GRID - 1, Math.max(0, iz)) * GRID + Math.min(GRID - 1, Math.max(0, ix)); }
  heightAt(x, z) {
    const fx = (x + WORLD_SIZE / 2) / CELL, fz = (z + WORLD_SIZE / 2) / CELL;
    const ix = Math.floor(fx), iz = Math.floor(fz); const tx = fx - ix, tz = fz - iz;
    const H = this.heights;
    const a = H[this.idx(ix, iz)], b = H[this.idx(ix + 1, iz)], c = H[this.idx(ix, iz + 1)], d = H[this.idx(ix + 1, iz + 1)];
    // match PlaneGeometry triangulation (diagonal from (ix,iz+1) to (ix+1,iz))
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  slopeAt(x, z) {
    const e = 1.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }
  _shade() {
    const N = GRID;
    const col = (r, g, b) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
    const grassA = col(0.42, 0.60, 0.22), grassB = col(0.30, 0.47, 0.16), grassDry = col(0.62, 0.62, 0.30);
    const forest = col(0.24, 0.38, 0.14), dirt = col(0.55, 0.44, 0.30), sand = col(0.78, 0.70, 0.52);
    const rock = col(0.46, 0.44, 0.42), rockDark = col(0.33, 0.31, 0.30), snow = col(0.92, 0.94, 0.97), plaza = col(0.60, 0.55, 0.46);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix;
      const x = -WORLD_SIZE / 2 + ix * CELL, z = -WORLD_SIZE / 2 + iz * CELL;
      const h = this.heights[i];
      const s = this.slopeAt(x, z);
      const n = noise.fbm(x / 35, z / 35, 3) * 0.5 + 0.5;
      const n2 = noise.n2(x / 9, z / 9) * 0.5 + 0.5;
      let c = mix3(grassB, grassA, n);
      c = mix3(c, grassDry, smoothstep(0.62, 0.85, noise.fbm(x / 80 + 9, z / 80, 2) * 0.5 + 0.5) * 0.6);
      const forestMask = this.forestMask(x, z);
      c = mix3(c, forest, forestMask * 0.8);
      let g = 1 - forestMask * 0.5;
      // plaza around the well
      const dv = Math.hypot(x, z);
      const pz = smoothstep(11, 7, dv + n2 * 2);
      c = mix3(c, plaza, pz); g *= 1 - pz;
      // roads
      const pd = this.pathD[i];
      const road = smoothstep(3.4, 1.6, pd + (n2 - 0.5) * 1.6);
      c = mix3(c, dirt, road); g *= 1 - smoothstep(3.8, 2.4, pd);
      // shoreline
      const sh = smoothstep(1.6, 0.6, h);
      c = mix3(c, sand, sh); g *= 1 - smoothstep(1.4, 0.9, h);
      // steep rock and snow
      const rk = smoothstep(0.55, 0.95, s + (n2 - 0.5) * 0.2);
      c = mix3(c, mix3(rock, rockDark, n2), rk); g *= 1 - smoothstep(0.45, 0.7, s);
      const sn = smoothstep(62, 78, h + (n - 0.5) * 12) * smoothstep(1.3, 0.6, s);
      c = mix3(c, snow, sn); g *= 1 - smoothstep(40, 55, h);
      this.colors.set(c, i * 3);
      this.grass[i] = Math.max(0, Math.min(1, g));
    }
  }
  forestMask(x, z) {
    const W = PLACES.woods;
    const dw = Math.hypot(x - W.x, z - W.z);
    let f = smoothstep(120, 60, dw);
    f = Math.max(f, smoothstep(0.25, 0.5, noise.fbm(x / 90 + 40, z / 90 - 12, 3)) * 0.8);
    const dv = Math.hypot(x, z);
    f *= smoothstep(60, 90, dv);
    return f;
  }
  // Heights + grass density packed for the GPU (RGBA float, nearest)
  packTexture() {
    const N = GRID; const data = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[i * 4] = this.heights[i]; data[i * 4 + 1] = this.grass[i]; }
    return data;
  }
}
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export { noise };
