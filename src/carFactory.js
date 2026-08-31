/* ==========================================================================
   carFactory.js — procedural cars built as lofted hulls.

   A car is described by a list of *stations* along its length. Each station
   gives the half-width and beltline height of the lower body plus, optionally,
   a narrower "greenhouse" tier on top (cabin width + roof height). Each
   station also tags what its top surface and its flanks are made of — sheet
   metal or glass — which is what lets one generator produce a notchback
   saloon, a long-roof estate and a rear-engined fastback that you can tell
   apart at a glance from the driver's seat of the car behind.

   Local axes: +X right, +Y up, +Z forward (the nose).
   ========================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { plateTex, ledTex } from './textures.js';
import { makeCarMaterials } from './carPaint.js';
import { bodyDetail } from './carTextures.js';

/* ------------------------------------------------------------- materials
   The set itself lives in carPaint.js — clearcoat paint, tinted glass, tread
   normals. MAT keeps its object identity across a re-init so nothing that
   captured a reference to it goes stale. */
const MAT = {};
export function initMaterials(envMap) {
  for (const k of Object.keys(MAT)) delete MAT[k];
  Object.assign(MAT, makeCarMaterials(envMap));
  MAT.env = envMap;
  return MAT;
}
export { MAT };
export { retargetEnv } from './carPaint.js';

/* ========================================================== the loft core */
/* Cross-section and station resolution, by detail tier.

   The car you are driving is on screen for twenty minutes and fills a good
   part of it. A Kombi four hundred metres up the carriageway does not, and
   there are twenty-six of those — so the loft resolution, the wheel detail and
   even the number of materials (which is the number of draw calls) are all
   graded. The player's car gets roughly three times the geometry of a traffic
   car and the traffic car ends up *cheaper* than it was before. */
const TIERS = {
  hi:  { sec: { nB: 5, nS: 9, nG: 8, nR: 15 }, steps: 104, detail: true },
  mid: { sec: { nB: 5, nS: 7, nG: 6, nR: 11 }, steps: 78,  detail: true },
  lo:  { sec: { nB: 5, nS: 6, nG: 5, nR: 9 },  steps: 60,  detail: false },
};
const REG = { BODY: 0, SIDE: 1, TOP: 2 };

function qbez(t, a, c, b) { const m = 1 - t; return m * m * a + 2 * m * t * c + t * t * b; }

/** Build the closed cross-section outline for one station. */
function section(st, pts, regs, sec) {
  const { wBody, wBottom, yFloor, yBelt, wRoof, yRoof, crown } = st;
  const { nB, nS, nG, nR } = sec;
  pts.length = 0; regs.length = 0;
  const push = (x, y, r) => { pts.push(x, y); regs.push(r); };

  // 1 — floor, left to right, edges curling up slightly
  for (let i = 0; i < nB; i++) {
    const f = i / (nB - 1);
    push(-wBottom + 2 * wBottom * f, yFloor + 0.035 * (2 * f - 1) ** 2, REG.BODY);
  }
  /* 2 — right flank up to the beltline, with a shoulder crease.

     Real sheet metal reaches its widest point at a feature line about three
     quarters of the way up the flank and then tucks back in towards the
     beltline, and that crease has a radius of a few millimetres. One bezier
     from sill to beltline has no such line anywhere on it, which is precisely
     why the old bodies read as soft. So: two curve segments meeting at the
     crease, and the samples clustered around it, because a tight radius throws
     a highlight that stays a line instead of smearing into a gradient. */
  const CR = 0.74;                          // crease height, fraction of flank
  const flank = yBelt - yFloor;
  const yCr = yFloor + flank * CR;
  const wBelt = wBody * 0.972;
  const sideAt = (t) => {
    if (t <= CR) {
      const u = t / CR;
      return [qbez(u, wBottom, wBody * 1.035, wBody),
        qbez(u, yFloor, yFloor + flank * CR * 0.62, yCr)];
    }
    const u = (t - CR) / (1 - CR);
    return [qbez(u, wBody, wBody * 1.001, wBelt),
      qbez(u, yCr, yCr + flank * (1 - CR) * 0.42, yBelt)];
  };
  // monotone reparameterisation that packs samples towards the crease
  const clump = (f) => (f <= CR
    ? CR - CR * Math.pow(1 - f / CR, 1.55)
    : CR + (1 - CR) * Math.pow((f - CR) / (1 - CR), 1.55));
  for (let i = 1; i < nS; i++) { const [x, y] = sideAt(clump(i / (nS - 1))); push(x, y, REG.BODY); }
  // 3 — right greenhouse (tumblehome). Degenerates when there is no cabin.
  const ghAt = (t) => [
    qbez(t, wBelt, wBelt * 0.995, wRoof),
    qbez(t, yBelt, yBelt + (yRoof - yBelt) * 0.58, yRoof),
  ];
  for (let i = 1; i < nG; i++) { const [x, y] = ghAt(i / (nG - 1)); push(x, y, REG.SIDE); }
  // 4 — the top surface, right to left, crowned (or valleyed, for a bonnet)
  const wr = Math.max(wRoof, 1e-4);
  for (let i = 1; i < nR; i++) {
    const f = i / (nR - 1);
    const x = wRoof - 2 * wRoof * f;
    push(x, yRoof + crown * (1 - (x / wr) ** 2), REG.TOP);
  }
  // 5 — left greenhouse, mirrored back down to the beltline
  for (let i = nG - 2; i >= 0; i--) { const [x, y] = ghAt(i / (nG - 1)); push(-x, y, REG.SIDE); }
  // 6 — left flank back down to the floor (last point closes onto floor[0])
  for (let i = nS - 2; i >= 1; i--) { const [x, y] = sideAt(clump(i / (nS - 1))); push(-x, y, REG.BODY); }
  return pts.length / 2;
}

/**
 * Loft the stations into two geometries sharing one vertex buffer:
 * `paint` (sheet metal) and `glass`.
 */
function loft(stations, sec) {
  const pts = [], regs = [];
  const P = section(stations[0], pts, regs, sec);
  const regions = regs.slice();
  const S = stations.length;

  const pos = new Float32Array(S * P * 3);
  const uv = new Float32Array(S * P * 2);
  for (let i = 0; i < S; i++) {
    const st = stations[i];
    section(st, pts, regs, sec);
    for (let k = 0; k < P; k++) {
      const o = (i * P + k) * 3;
      pos[o] = pts[k * 2];
      pos[o + 1] = pts[k * 2 + 1];
      pos[o + 2] = st.z;
      uv[(i * P + k) * 2] = k / P;
      uv[(i * P + k) * 2 + 1] = i / (S - 1);
    }
  }

  const paintIdx = [], glassIdx = [];
  for (let i = 0; i < S - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P;
      const v0 = i * P + k, v1 = i * P + k2, v2 = (i + 1) * P + k2, v3 = (i + 1) * P + k;
      const r = regions[k], r2 = regions[k2];
      let glass = false;
      if (r === REG.TOP && r2 === REG.TOP) glass = a.top === 'glass' || b.top === 'glass';
      else if (r === REG.SIDE || r2 === REG.SIDE) glass = a.side === 'glass' || b.side === 'glass';
      const dst = glass ? glassIdx : paintIdx;
      dst.push(v0, v1, v2, v0, v2, v3);
    }
  }
  // caps so the nose and tail are closed
  const capIdx = [];
  const centre = (i) => {
    let cx = 0, cy = 0;
    for (let k = 0; k < P; k++) { cx += pos[(i * P + k) * 3]; cy += pos[(i * P + k) * 3 + 1]; }
    return [cx / P, cy / P];
  };
  const extra = [];
  const addCap = (i, flip) => {
    const [cx, cy] = centre(i);
    const vi = S * P + extra.length / 3;
    extra.push(cx, cy, stations[i].z);
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P;
      if (flip) capIdx.push(vi, i * P + k2, i * P + k);
      else capIdx.push(vi, i * P + k, i * P + k2);
    }
  };
  addCap(0, true); addCap(S - 1, false);

  const posAll = new Float32Array(pos.length + extra.length);
  posAll.set(pos); posAll.set(extra, pos.length);
  const uvAll = new Float32Array(uv.length + (extra.length / 3) * 2);
  uvAll.set(uv);

  // normals from the full mesh, so the paint/glass split stays seamless
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(posAll, 3));
  full.setAttribute('uv', new THREE.BufferAttribute(uvAll, 2));
  full.setIndex([...paintIdx, ...glassIdx, ...capIdx]);
  full.computeVertexNormals();

  // self-correcting winding: the roof must face up
  const nrm = full.attributes.normal.array;
  const mid = Math.floor(S / 2);
  let topK = 0;
  for (let k = 0; k < P; k++) if (regions[k] === REG.TOP) { topK = k; break; }
  const probe = (mid * P + topK + 2) * 3 + 1;
  if (nrm[probe] < 0) {
    const flip = (arr) => { for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; } };
    flip(paintIdx); flip(glassIdx); flip(capIdx);
    full.setIndex([...paintIdx, ...glassIdx, ...capIdx]);
    full.computeVertexNormals();
  }

  const mk = (idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', full.attributes.position);
    g.setAttribute('normal', full.attributes.normal);
    g.setAttribute('uv', full.attributes.uv);
    g.setIndex(idx);
    return g;
  };
  return { paint: mk([...paintIdx, ...capIdx]), glass: glassIdx.length ? mk(glassIdx) : null };
}

/* ============================================== archetype station tables
   Normalised: wf = fraction of half-width, bf/rf = fraction of height,
   rwf = cabin half-width fraction. `-` means "no cabin tier here".
   [ t, wf, bf, rwf, rf, top, side, crown ]                                */
/* How far to drop the beltline below the table value, as a fraction of the
   car's height. The tables were drawn a little high; a deeper glasshouse
   reads far more like a real car. */
const BELT_DROP = { sedan: 0.034, wagon: 0.032, hatch: 0.030, coupe4: 0.026, fastback: 0.014, van: 0.018 };

const A = {
  sedan: [
    [0.000, 0.33, 0.665, -1, -1, 'body', 'body', -0.007],
    [0.030, 0.93, 0.720, -1, -1, 'body', 'body', -0.010],
    [0.090, 0.975, 0.755, -1, -1, 'body', 'body', -0.012],
    [0.170, 0.990, 0.765, 0.845, 0.830, 'glass', 'body', 0.000],
    [0.240, 0.995, 0.775, 0.845, 0.905, 'glass', 'body', 0.000],
    [0.310, 0.990, 0.775, 0.840, 0.975, 'body', 'glass', 0.004],
    [0.420, 0.985, 0.770, 0.835, 0.998, 'body', 'glass', 0.010],
    [0.530, 0.980, 0.762, 0.830, 1.000, 'body', 'glass', 0.010],
    [0.610, 0.975, 0.750, 0.825, 0.988, 'body', 'glass', 0.008],
    [0.665, 0.970, 0.727, 0.800, 0.952, 'glass', 'glass', 0.000],
    [0.730, 0.965, 0.694, 0.700, 0.803, 'glass', 'body', 0.000],
    [0.775, 0.960, 0.673, -1, -1, 'body', 'body', -0.014],
    [0.850, 0.955, 0.653, -1, -1, 'body', 'body', -0.024],
    [0.920, 0.930, 0.632, -1, -1, 'body', 'body', -0.027],
    [0.965, 0.850, 0.592, -1, -1, 'body', 'body', -0.020],
    [0.990, 0.720, 0.531, -1, -1, 'body', 'body', -0.010],
    [1.000, 0.620, 0.462, -1, -1, 'body', 'body', -0.005],
  ],
  wagon: [
    [0.000, 0.36, 0.700, 0.760, 0.880, 'glass', 'body', 0.000],
    [0.022, 0.92, 0.760, 0.830, 0.965, 'glass', 'body', 0.000],
    [0.050, 0.975, 0.788, 0.845, 0.995, 'body', 'body', 0.004],
    [0.140, 0.990, 0.795, 0.850, 1.000, 'body', 'glass', 0.008],
    [0.250, 0.995, 0.798, 0.850, 1.000, 'body', 'glass', 0.010],
    [0.380, 0.990, 0.792, 0.848, 0.998, 'body', 'glass', 0.010],
    [0.480, 0.985, 0.782, 0.844, 0.995, 'body', 'glass', 0.010],
    [0.570, 0.980, 0.765, 0.836, 0.985, 'body', 'glass', 0.008],
    [0.640, 0.975, 0.740, 0.808, 0.950, 'glass', 'glass', 0.000],
    [0.710, 0.968, 0.700, 0.700, 0.800, 'glass', 'body', 0.000],
    [0.755, 0.962, 0.678, -1, -1, 'body', 'body', -0.014],
    [0.835, 0.956, 0.657, -1, -1, 'body', 'body', -0.026],
    [0.905, 0.932, 0.634, -1, -1, 'body', 'body', -0.028],
    [0.958, 0.855, 0.596, -1, -1, 'body', 'body', -0.020],
    [0.990, 0.725, 0.534, -1, -1, 'body', 'body', -0.010],
    [1.000, 0.620, 0.464, -1, -1, 'body', 'body', -0.005],
  ],
  hatch: [
    [0.000, 0.40, 0.720, 0.740, 0.840, 'glass', 'body', 0.000],
    [0.030, 0.92, 0.780, 0.820, 0.940, 'glass', 'body', 0.000],
    [0.080, 0.975, 0.800, 0.840, 0.988, 'body', 'body', 0.004],
    [0.180, 0.990, 0.805, 0.845, 1.000, 'body', 'glass', 0.010],
    [0.320, 0.995, 0.805, 0.845, 1.000, 'body', 'glass', 0.012],
    [0.460, 0.988, 0.795, 0.840, 0.996, 'body', 'glass', 0.010],
    [0.570, 0.980, 0.775, 0.830, 0.982, 'body', 'glass', 0.008],
    [0.650, 0.972, 0.745, 0.800, 0.945, 'glass', 'glass', 0.000],
    [0.730, 0.964, 0.705, 0.690, 0.795, 'glass', 'body', 0.000],
    [0.780, 0.958, 0.683, -1, -1, 'body', 'body', -0.014],
    [0.860, 0.950, 0.660, -1, -1, 'body', 'body', -0.024],
    [0.925, 0.920, 0.636, -1, -1, 'body', 'body', -0.026],
    [0.970, 0.840, 0.598, -1, -1, 'body', 'body', -0.018],
    [1.000, 0.640, 0.500, -1, -1, 'body', 'body', -0.006],
  ],
  /* rear-engined fastback: wide hips, glass over the engine lid, low nose */
  fastback: [
    [0.000, 0.32, 0.700, -1, -1, 'body', 'body', -0.012],
    [0.020, 0.90, 0.770, -1, -1, 'body', 'body', -0.016],
    [0.055, 0.955, 0.795, -1, -1, 'body', 'body', -0.020],
    [0.100, 0.985, 0.830, 0.740, 0.870, 'glass', 'body', 0.000],
    [0.170, 1.000, 0.855, 0.775, 0.925, 'glass', 'body', 0.000],
    [0.250, 1.000, 0.862, 0.795, 0.972, 'glass', 'body', 0.000],
    [0.330, 0.992, 0.860, 0.808, 0.997, 'body', 'glass', 0.006],
    [0.420, 0.975, 0.848, 0.812, 1.000, 'body', 'glass', 0.012],
    [0.510, 0.958, 0.832, 0.806, 0.996, 'body', 'glass', 0.012],
    [0.590, 0.944, 0.805, 0.792, 0.972, 'body', 'glass', 0.008],
    [0.650, 0.936, 0.777, 0.760, 0.920, 'glass', 'glass', 0.000],
    [0.730, 0.930, 0.735, 0.640, 0.780, 'glass', 'body', 0.000],
    [0.780, 0.928, 0.706, -1, -1, 'body', 'body', -0.030],
    [0.855, 0.930, 0.680, -1, -1, 'body', 'body', -0.048],
    [0.920, 0.905, 0.648, -1, -1, 'body', 'body', -0.050],
    [0.965, 0.820, 0.585, -1, -1, 'body', 'body', -0.034],
    [0.990, 0.690, 0.500, -1, -1, 'body', 'body', -0.016],
    [1.000, 0.560, 0.430, -1, -1, 'body', 'body', -0.006],
  ],
  /* long-bonnet four-door coupé: low roof, fast rear screen, short boot */
  coupe4: [
    [0.000, 0.34, 0.640, -1, -1, 'body', 'body', -0.008],
    [0.028, 0.92, 0.700, -1, -1, 'body', 'body', -0.012],
    [0.075, 0.972, 0.735, -1, -1, 'body', 'body', -0.014],
    [0.130, 0.990, 0.752, 0.820, 0.800, 'glass', 'body', 0.000],
    [0.200, 0.998, 0.762, 0.828, 0.888, 'glass', 'body', 0.000],
    [0.285, 0.992, 0.765, 0.826, 0.962, 'glass', 'glass', 0.004],
    [0.375, 0.986, 0.760, 0.822, 0.994, 'body', 'glass', 0.010],
    [0.470, 0.980, 0.752, 0.818, 1.000, 'body', 'glass', 0.012],
    [0.560, 0.974, 0.740, 0.810, 0.992, 'body', 'glass', 0.010],
    [0.630, 0.968, 0.722, 0.796, 0.962, 'body', 'glass', 0.006],
    [0.685, 0.962, 0.700, 0.772, 0.912, 'glass', 'glass', 0.000],
    [0.755, 0.956, 0.664, 0.660, 0.760, 'glass', 'body', 0.000],
    [0.800, 0.952, 0.644, -1, -1, 'body', 'body', -0.018],
    [0.870, 0.948, 0.624, -1, -1, 'body', 'body', -0.030],
    [0.930, 0.922, 0.602, -1, -1, 'body', 'body', -0.032],
    [0.968, 0.840, 0.566, -1, -1, 'body', 'body', -0.022],
    [0.991, 0.712, 0.508, -1, -1, 'body', 'body', -0.010],
    [1.000, 0.600, 0.442, -1, -1, 'body', 'body', -0.005],
  ],
  van: [
    [0.000, 0.40, 0.470, 0.880, 0.960, 'body', 'body', 0.004],
    [0.020, 0.94, 0.500, 0.930, 0.992, 'body', 'body', 0.006],
    [0.060, 0.985, 0.510, 0.950, 1.000, 'body', 'glass', 0.008],
    [0.200, 0.995, 0.512, 0.955, 1.000, 'body', 'glass', 0.010],
    [0.400, 0.995, 0.512, 0.955, 1.000, 'body', 'glass', 0.010],
    [0.600, 0.992, 0.510, 0.952, 0.998, 'body', 'glass', 0.010],
    [0.720, 0.988, 0.505, 0.945, 0.990, 'body', 'glass', 0.008],
    [0.800, 0.982, 0.498, 0.910, 0.955, 'glass', 'glass', 0.000],
    [0.880, 0.975, 0.480, 0.760, 0.740, 'glass', 'body', 0.000],
    [0.920, 0.968, 0.455, -1, -1, 'body', 'body', -0.014],
    [0.960, 0.940, 0.420, -1, -1, 'body', 'body', -0.016],
    [0.988, 0.850, 0.372, -1, -1, 'body', 'body', -0.012],
    [1.000, 0.720, 0.320, -1, -1, 'body', 'body', -0.005],
  ],
};

/* Where a table says "no cabin here" (-1) we copy the lower-body values in,
   so the greenhouse tier collapses smoothly onto the beltline instead of the
   interpolator sweeping through -1 and spiking a needle at every pillar. */
for (const key of Object.keys(A)) {
  for (const k of A[key]) {
    if (k[3] < 0) { k[3] = k[1]; k[4] = k[2]; }
  }
}

/* --------------------------------------------- smooth station resampling */
function crClamped(keys, col, t) {
  // find bracketing keys
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] < t) i++;
  const p1 = keys[i], p2 = keys[i + 1];
  const p0 = keys[Math.max(0, i - 1)], p3 = keys[Math.min(keys.length - 1, i + 2)];
  const span = p2[0] - p1[0] || 1e-6;
  const u = Math.min(1, Math.max(0, (t - p1[0]) / span));
  const v0 = p0[col], v1 = p1[col], v2 = p2[col], v3 = p3[col];
  const m1 = (v2 - v0) * 0.5, m2 = (v3 - v1) * 0.5;
  const u2 = u * u, u3 = u2 * u;
  let v = (2 * u3 - 3 * u2 + 1) * v1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v2 + (u3 - u2) * m2;
  return Math.min(Math.max(v, Math.min(v1, v2)), Math.max(v1, v2));   // no overshoot
}

function nearestKey(keys, t) {
  let best = keys[0], bd = 1e9;
  for (const k of keys) { const d = Math.abs(k[0] - t); if (d < bd) { bd = d; best = k; } }
  return best;
}

/* Where the glasshouse exists, in table t, per archetype. Used to place the
   bonnet and boot-lid shut lines and to know where to put a window surround.
   Derived from the table rather than the built stations so that every car of a
   given shape shares one detail texture. */
const _cabinCache = new Map();
function archCabin(arch) {
  if (_cabinCache.has(arch)) return _cabinCache.get(arch);
  let lo = 1, hi = 0;
  for (const k of A[arch]) if (k[4] > k[2] + 0.02) { lo = Math.min(lo, k[0]); hi = Math.max(hi, k[0]); }
  const r = hi > lo ? [lo, hi] : [0.2, 0.7];
  _cabinCache.set(arch, r);
  return r;
}

function buildStations(arch, dims, steps, spec = null) {
  const keys = A[arch];
  const { length: L, width: W, height: H, floor } = dims;
  const hw = W / 2;
  const out = [];
  /* Wheel arches. Lifting the section floor in a circular arc over each axle
     is what turns a slab-sided extrusion into something with Radhäuser — it
     is the single biggest cue that a shape is a car and not a brick. */
  const axles = spec ? [
    { z: spec.axleF, r: spec.wheelRF, a: spec.wheelRF * 1.30 },
    { z: spec.axleR, r: spec.wheelRR, a: spec.wheelRR * 1.30 },
  ] : [];
  const floorAt = (z) => {
    let y = floor;
    for (const ax of axles) {
      const dz = z - ax.z;
      if (Math.abs(dz) < ax.a) {
        y = Math.max(y, ax.r + Math.sqrt(ax.a * ax.a - dz * dz) * 0.95);
      }
    }
    // approach / departure angles: the bumper edges lift off the road
    const tt = (z + L / 2) / L;
    if (tt > 0.925) y = Math.max(y, floor + ((tt - 0.925) / 0.075) ** 1.4 * H * 0.20);
    if (tt < 0.055) y = Math.max(y, floor + ((0.055 - tt) / 0.055) ** 1.4 * H * 0.15);
    return y;
  };
  /* Haunches. A real body swells over each axle — more so at the back, where
     the arch is blistered over a wider track. Without it the flank is a plane
     and the highlight running down it is dead straight, which is the single
     most synthetic thing about a rendered car. */
  const hipAt = (z) => {
    let m = 1;
    for (const ax of axles) {
      const d = (z - ax.z) / (ax.a * 1.42);
      if (Math.abs(d) < 1) {
        m = Math.max(m, 1 + (ax.z < 0 ? 0.027 : 0.019) * (1 - d * d) ** 1.4);
      }
    }
    return m;
  };
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const wf = crClamped(keys, 1, t), bf = crClamped(keys, 2, t) - (BELT_DROP[arch] || 0);
    let rwf = crClamped(keys, 3, t), rf = crClamped(keys, 4, t);
    const kk = nearestKey(keys, t);
    const z = (t - 0.5) * L;
    const hip = hipAt(z);
    const wBody = Math.max(0.02, wf * hw * hip);
    const yFloor = floorAt(z);
    const yBelt = Math.max(yFloor + 0.10, bf * H);
    const hasCabin = rf * H > yBelt + 0.035;
    out.push({
      z,
      wBody,
      wBottom: wBody * (yFloor > floor + 0.02 ? 0.96 : 0.885),
      yFloor,
      yBelt,
      wRoof: hasCabin ? rwf * hw : wBody,
      yRoof: hasCabin ? rf * H : yBelt,
      crown: crClamped(keys, 7, t) * H,
      top: kk[5], side: kk[6],
      cabin: hasCabin,
    });
  }
  return out;
}

/* ------------------------------------------------------------- the wheel

   A tyre and a rim are both solids of revolution about the wheel axis, which
   here is local X. Revolving a profile beats stacking tori: fewer triangles
   for a smoother sidewall bulge, and the UVs come out with u around the
   circumference and v across the tread, which is exactly what the tread normal
   map wants.

   The rim is deliberately left *open* at the front — the barrel is a tube, the
   face is made of spokes, and you see the brake disc through the gaps. A rim
   closed with a solid annulus reads as a hubcap no matter how many spokes you
   draw on top of it.                                                        */
function revolveX(profile, segments) {
  const N = profile.length, S = segments;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < N; i++) {
    const [px, pr] = profile[i];
    for (let j = 0; j <= S; j++) {
      const a = (j / S) * Math.PI * 2;
      pos.push(px, Math.cos(a) * pr, Math.sin(a) * pr);
      uv.push(j / S, i / (N - 1));
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < S; j++) {
      const v0 = i * (S + 1) + j, v1 = v0 + 1, v2 = v0 + S + 1, v3 = v2 + 1;
      idx.push(v0, v1, v2, v1, v3, v2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _wheelCache = new Map();
function wheelGeoms(radius, width, spokes, tier) {
  const key = `${radius}|${width}|${spokes}|${tier}`;
  if (_wheelCache.has(key)) return _wheelCache.get(key);
  const R = radius, W = width;
  const hi = tier === 'hi', mid = tier === 'mid';
  const seg = hi ? 30 : mid ? 24 : 16;

  // ---- tyre: bead, sidewall bulge, shoulder, tread, and back down again
  const tp = hi
    ? [[-0.500, 0.745], [-0.472, 0.818], [-0.442, 0.902], [-0.402, 0.961],
       [-0.330, 0.994], [0.000, 1.000], [0.330, 0.994], [0.402, 0.961],
       [0.442, 0.902], [0.472, 0.818], [0.500, 0.745]]
    : [[-0.500, 0.745], [-0.442, 0.902], [-0.335, 0.992],
       [0.335, 0.992], [0.442, 0.902], [0.500, 0.745]];
  const tyre = revolveX(tp.map(([x, r]) => [x * W, r * R]), seg);

  // ---- rim: barrel, then a flange that turns back on itself to make a lip
  const rp = [
    [-0.44 * W, 0.735 * R],
    [-0.32 * W, 0.680 * R],
    [0.16 * W, 0.680 * R],
    [0.31 * W, 0.722 * R],
    [0.378 * W, 0.750 * R],
    [0.352 * W, 0.700 * R],
  ];
  const rim = [revolveX(rp, seg)];

  // ---- spokes. Twin blades per spoke on the detailed tiers: a tapered
  //      four-sided prism is a perfectly good spoke and costs sixteen faces.
  const nPair = hi || mid ? 2 : 1;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    for (let k = 0; k < nPair; k++) {
      const off = nPair === 1 ? 0 : (k === 0 ? -0.155 : 0.155);
      const th = nPair === 1 ? 0.10 : 0.055;
      const sp = new THREE.CylinderGeometry(th * R, th * R * 1.7, 0.50 * R, 4, 1);
      sp.translate(0, 0.44 * R, 0);
      sp.rotateX(a + off);
      sp.translate(0.30 * W, 0, 0);
      rim.push(sp);
    }
  }
  /* Backplate. The rim barrel is deliberately open at the front so you can see
     the disc through the spokes, but that also means that from inboard — which
     is exactly what you see of the near wheels in any rear three-quarter view —
     you were looking into an unlit tube. One annulus closes it. */
  const back = new THREE.CircleGeometry(0.70 * R, hi ? 22 : 14);
  back.rotateY(-Math.PI / 2);
  back.translate(-0.40 * W, 0, 0);
  rim.push(back);
  // ---- centre cap
  rim.push(cyl(0.19 * R, 0.17 * R, 0.14 * W, hi ? 14 : 10, 0.30 * W, 0, 0));
  const cap = new THREE.CircleGeometry(0.17 * R, hi ? 14 : 10);
  cap.rotateY(Math.PI / 2); cap.translate(0.37 * W, 0, 0);
  rim.push(cap);

  const res = { tyre, rim: mergeGeometries(rim) };

  // ---- polished lip ring and lug bolts: player cars only
  if (hi) {
    const bright = [];
    const lip = new THREE.TorusGeometry(0.755 * R, 0.016 * R, 4, seg);
    lip.rotateY(Math.PI / 2); lip.translate(0.372 * W, 0, 0);
    bright.push(lip);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const b = cyl(0.036 * R, 0.036 * R, 0.05 * W, 6, 0, 0, 0);
      b.translate(0, 0.27 * R, 0);
      b.rotateX(a);
      b.translate(0.345 * W, 0, 0);
      bright.push(b);
    }
    res.bright = mergeGeometries(bright);
  }

  // ---- brake disc, with a face you can see through the spokes
  if (hi || mid) {
    const disc = [cyl(0.655 * R, 0.655 * R, 0.055 * R, hi ? 22 : 16, 0, 0, 0)];
    for (const sgn of [-1, 1]) {
      const f = new THREE.CircleGeometry(0.655 * R, hi ? 22 : 16);
      f.rotateY(sgn * Math.PI / 2); f.translate(sgn * 0.028 * R, 0, 0);
      disc.push(f);
    }
    res.disc = mergeGeometries(disc);
    // caliper: a block bridging the disc at the trailing top edge
    const cal = [];
    cal.push(box(W * 0.17, R * 0.42, R * 0.19, 0, R * 0.42, -R * 0.14));
    cal.push(box(W * 0.21, R * 0.13, R * 0.15, 0, R * 0.55, -R * 0.14));
    res.cal = mergeGeometries(cal);
  }

  _wheelCache.set(key, res);
  return res;
}

export function buildWheel(spec, front, tier = 'lo') {
  const g = new THREE.Group();
  const r = front ? spec.wheelRF : spec.wheelRR;
  const w = front ? spec.wheelWF : spec.wheelWR;
  const geo = wheelGeoms(r, w, spec.spokes || 5, tier);
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(geo.tyre, MAT.tyre));
  spin.add(new THREE.Mesh(geo.rim, spec.rimDark ? MAT.rimDark : MAT.rim));
  if (geo.bright) spin.add(new THREE.Mesh(geo.bright, MAT.rimLip));
  g.add(spin);
  if (geo.disc) g.add(new THREE.Mesh(geo.disc, MAT.disc));
  if (geo.cal && spec.caliper) {
    g.add(new THREE.Mesh(geo.cal, spec.caliper === 'yellow' ? MAT.caliperYel : MAT.caliperRed));
  }
  g.userData.spin = spin;
  g.userData.radius = r;
  return g;
}

/* ======================================================= detail dressing */
function box(w, h, d, x, y, z, rx = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(r1, r2, h, seg, x, y, z, rot = 'z') {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  if (rot === 'z') g.rotateZ(Math.PI / 2);
  if (rot === 'x') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Front-end signature: this is most of what tells the marques apart. */
function frontEnd(spec, dims, bucket, tier) {
  const hw = dims.width / 2, H = dims.height, L = dims.length, nose = L / 2;
  const fine = tier !== 'lo';
  const y = spec.lightY * H;
  const zf = nose + 0.012;

  /* A lamp unit is a recess, a bright reflector, a lens, and a slim daytime
     running light. Four thin boxes instead of one is the difference between "a
     white rectangle stuck on the nose" and "a headlight" — and the DRL is most
     of what makes a car read as a car at four hundred metres. */
  const lamp = (x, w, h, ry = 0) => {
    bucket.dark.push(box(w * 1.16, h * 1.42, 0.10, x, y, zf - 0.085, 0, ry));
    /* The reflector has to stay *inside* the lens. At w*0.99 it poked out past
       the dark cover glass and, being chrome under a bright sky, read as a
       white slab bolted to the nose. */
    if (fine) bucket.reflector.push(box(w * 0.80, h * 0.66, 0.035, x, y, zf - 0.072, 0, ry));
    bucket.light.push(box(w, h, 0.05, x, y, zf - 0.028, 0, ry));
    // two small projector barrels inside, so the unit has something in it
    if (fine) {
      for (const k of [-0.24, 0.24]) {
        bucket.chrome.push(cyl(h * 0.30, h * 0.30, 0.05, 10, x + w * k, y, zf - 0.052, 'x'));
      }
    }
  };
  /** Horizontal bars in a grille aperture: an open grille, not a black hole. */
  const bars = (w, h, x, yc, z, n) => {
    bucket.grille.push(box(w, h, 0.085, x, yc, z - 0.03));
    if (!fine) return;
    for (let i = 0; i < n; i++) {
      const yy = yc - h / 2 + (h * (i + 0.5)) / n;
      bucket.trim.push(box(w * 0.97, h / (n * 3.1), 0.03, x, yy, z + 0.004));
    }
  };

  switch (spec.face) {
    case 'kidney': {   // twin vertical kidney grilles, L-shaped corona DRLs
      for (const s of [-1, 1]) {
        bars(hw * 0.30, H * 0.215, s * hw * 0.185, H * 0.44, zf - 0.005, 5);
        bucket.chrome.push(box(hw * 0.335, H * 0.235, 0.05, s * hw * 0.185, H * 0.44, zf - 0.055));
        lamp(s * hw * 0.585, hw * 0.44, H * 0.105);
        bucket.drl.push(box(hw * 0.40, H * 0.022, 0.045, s * hw * 0.585, y + H * 0.052, zf - 0.026));
        if (fine) bucket.drl.push(box(hw * 0.075, H * 0.075, 0.045, s * hw * 0.775, y + H * 0.012, zf - 0.026));
        bucket.grille.push(box(hw * 0.42, H * 0.10, 0.08, s * hw * 0.60, H * 0.235, zf - 0.05));
      }
      break;
    }
    case 'singleframe': {  // one wide hexagonal frame, slim laser DRL blades
      bars(hw * 1.06, H * 0.275, 0, H * 0.415, zf - 0.015, 7);
      bucket.chrome.push(box(hw * 1.12, H * 0.30, 0.045, 0, H * 0.415, zf - 0.06));
      for (const s of [-1, 1]) {
        lamp(s * hw * 0.605, hw * 0.48, H * 0.085);
        bucket.drl.push(box(hw * 0.46, H * 0.020, 0.045, s * hw * 0.605, y + H * 0.040, zf - 0.024));
        if (fine) {
          for (let i = 0; i < 4; i++) {
            bucket.drl.push(box(hw * 0.035, H * 0.038, 0.04,
              s * hw * (0.44 + i * 0.11), y - H * 0.028, zf - 0.024));
          }
        }
        bucket.grille.push(box(hw * 0.36, H * 0.105, 0.08, s * hw * 0.615, H * 0.245, zf - 0.05));
      }
      break;
    }
    case 'star': {   // wide grille, horizontal chrome blades, an empty ring
      bars(hw * 1.30, H * 0.25, 0, H * 0.43, zf - 0.015, 3);
      bucket.chrome.push(box(hw * 1.36, H * 0.275, 0.04, 0, H * 0.43, zf - 0.055));
      /* A plain chrome ring, deliberately empty. An earlier version put a
         three-pointed star in here, which is somebody's trademark — none of
         these cars carries a real marque's badge. */
      const badge = new THREE.TorusGeometry(H * 0.062, H * 0.013, 6, 18);
      badge.translate(0, H * 0.43, zf + 0.005); bucket.chrome.push(badge);
      for (const s of [-1, 1]) {
        lamp(s * hw * 0.60, hw * 0.45, H * 0.085);
        bucket.drl.push(box(hw * 0.40, H * 0.019, 0.045, s * hw * 0.60, y + H * 0.038, zf - 0.024));
        if (fine) bucket.drl.push(box(hw * 0.34, H * 0.017, 0.045, s * hw * 0.60, y - H * 0.030, zf - 0.024));
        bucket.grille.push(box(hw * 0.44, H * 0.115, 0.08, s * hw * 0.58, H * 0.225, zf - 0.05));
      }
      break;
    }
    case 'roundlamp': {  // no radiator grille at all — four round lamps
      for (const s of [-1, 1]) {
        const cx = s * hw * 0.645;
        /* The pod is body colour, not black. On a rear-engined fastback the
           round lamps sit up on the crowns of the front wings, so from the
           cockpit you are supposed to see two humps out there — but they have
           to be painted humps, not two dark domes surfacing through the
           bonnet, which is what a black housing looked like. */
        const bowl = new THREE.SphereGeometry(H * 0.101, fine ? 18 : 12, 9);
        bowl.scale(1, 0.86, 0.72); bowl.rotateX(0.34);
        bowl.translate(cx, y - H * 0.014, zf - 0.30);
        bucket.paint.push(bowl);
        const l = new THREE.SphereGeometry(H * 0.076, fine ? 18 : 12, 10);
        l.scale(1, 0.92, 0.55); l.rotateX(0.34);
        l.translate(cx, y, zf - 0.288);
        bucket.light.push(l);
        // the bright bit is a small element inside the dark cover glass
        if (fine) {
          const inner = new THREE.SphereGeometry(H * 0.034, 12, 8);
          inner.scale(1, 1, 0.6); inner.rotateX(0.34);
          inner.translate(cx, y + H * 0.006, zf - 0.300);
          bucket.drl.push(inner);
        }
        const ring = new THREE.TorusGeometry(H * 0.088, H * 0.011, 5, fine ? 20 : 12);
        ring.rotateX(0.34); ring.translate(cx, y, zf - 0.282);
        bucket.drl.push(ring);
        bars(hw * 0.46, H * 0.125, s * hw * 0.555, H * 0.235, zf - 0.03, 3);
      }
      bars(hw * 0.42, H * 0.09, 0, H * 0.215, zf - 0.04, 2);
      break;
    }
    default: {   // generic mainstream face
      bars(hw * 1.00, H * 0.16, 0, H * 0.42, zf - 0.015, 4);
      bucket.chrome.push(box(hw * 1.02, H * 0.05, 0.04, 0, H * 0.485, zf - 0.05));
      for (const s of [-1, 1]) {
        lamp(s * hw * 0.58, hw * 0.43, H * 0.09);
        bucket.drl.push(box(hw * 0.34, H * 0.016, 0.045, s * hw * 0.58, y - H * 0.032, zf - 0.024));
      }
      bucket.grille.push(box(hw * 1.10, H * 0.09, 0.08, 0, H * 0.235, zf - 0.05));
    }
  }

  // plate recess, splitter and the two brake ducts either side of it
  bucket.dark.push(box(hw * 0.64, H * 0.115, 0.05, 0, H * 0.245, nose - 0.03));
  bucket.dark.push(box(hw * 1.80, H * 0.075, 0.28, 0, H * 0.145, nose - 0.19));
  bucket.paint.push(box(hw * 1.72, H * 0.028, 0.20, 0, H * 0.112, nose - 0.13, -0.06));
  if (fine) {
    for (const s of [-1, 1]) {
      bucket.trim.push(box(hw * 0.10, H * 0.075, 0.05, s * hw * 1.02, H * 0.22, nose - 0.28));
    }
  }
}

function rearEnd(spec, dims, bucket, tier, stations) {
  const hw = dims.width / 2, H = dims.height, L = dims.length, tail = -L / 2;
  const fine = tier !== 'lo';
  const zr = tail - 0.035;
  const y = spec.tailY * H;

  /* A dark inset band across the tail with the lenses sitting in it. Modern
     cars all do this and it is what stops a rear end being a flat panel with
     two red stickers on it. */
  if (fine) bucket.dark.push(box(hw * 1.66, H * 0.135, 0.05, 0, y, zr + 0.012));
  const lens = (x, w, h, z = zr) => {
    bucket.dark.push(box(w * 1.16, h * 1.42, 0.06, x, y, z - 0.02));
    bucket.tail.push(box(w, h, 0.055, x, y, z + 0.008));
  };

  if (spec.tailStyle === 'bar') {           // full-width light bar
    bucket.tail.push(box(hw * 1.58, H * 0.045, 0.05, 0, y, zr + 0.015));
    for (const s of [-1, 1]) lens(s * hw * 0.70, hw * 0.40, H * 0.095);
  } else if (spec.tailStyle === 'lshape') {  // L-shaped graphics
    for (const s of [-1, 1]) {
      lens(s * hw * 0.62, hw * 0.50, H * 0.072);
      bucket.tail.push(box(hw * 0.13, H * 0.13, 0.05, s * hw * 0.855, y - H * 0.030, zr + 0.006));
    }
  } else {
    for (const s of [-1, 1]) lens(s * hw * 0.62, hw * 0.48, H * 0.092);
  }
  if (fine) {
    for (const s of [-1, 1]) {
      bucket.trim.push(box(hw * 0.13, H * 0.032, 0.04, s * hw * 0.34, y - H * 0.022, zr + 0.01));
      bucket.tail.push(box(hw * 0.10, H * 0.026, 0.03, s * hw * 0.80, H * 0.235, tail + 0.02));
    }
  }
  /* Plate recess, and a diffuser that is an insert in a painted bumper rather
     than a full-width black slab across the whole tail. */
  bucket.dark.push(box(hw * 0.64, H * 0.115, 0.05, 0, H * 0.30, tail + 0.015));
  bucket.dark.push(box(hw * 1.16, H * 0.095, 0.22, 0, H * 0.175, tail + 0.12));
  bucket.paint.push(box(hw * 1.66, H * 0.105, 0.20, 0, H * 0.255, tail + 0.13));
  if (fine) {
    for (let i = -1; i <= 1; i++) {
      bucket.trim.push(box(0.020, H * 0.070, 0.16, i * hw * 0.30, H * 0.170, tail + 0.10));
    }
  }
  // exhausts: a chrome tip with a dark bore down it
  const n = spec.pipes || 2;
  for (let i = 0; i < n; i++) {
    const side = i < n / 2 ? -1 : 1;
    const k = n <= 2 ? 0 : (i % 2 ? 0.5 : -0.5);
    const x = side * hw * (0.44 + k * 0.20);
    bucket.chrome.push(cyl(0.058, 0.055, 0.16, fine ? 14 : 8, x, H * 0.175, tail + 0.05, 'x'));
    bucket.dark.push(cyl(0.042, 0.042, 0.11, fine ? 12 : 8, x, H * 0.175, tail + 0.10, 'x'));
  }
  /* Wing / spoiler. Heights come off the *actual* loft rather than a fraction
     of the car's height: guessing left the ducktail floating a hand's width
     above the engine lid, which is the first thing the eye picks up. */
  const deckAt = (z) => {
    let best = stations[0], bd = 1e9;
    for (const st of stations) {
      const d = Math.abs(st.z - z);
      if (d < bd) { bd = d; best = st; }
    }
    return Math.max(best.yBelt, best.yRoof) + best.crown;
  };
  if (spec.wing === 'ducktail') {
    const zA = tail + 0.30, zB = tail + 0.19;
    const yA = deckAt(zA), yB = deckAt(zB);
    bucket.paint.push(box(hw * 1.44, H * 0.038, 0.26, 0, yA + H * 0.048, zA, -0.19));
    bucket.paint.push(box(hw * 1.40, H * 0.075, 0.10, 0, yB + H * 0.012, zB));
    if (fine) bucket.trim.push(box(hw * 1.42, H * 0.014, 0.05, 0, yA + H * 0.070, zA + 0.10, -0.19));
  } else if (spec.wing === 'roof') {
    const zA = tail + 0.26;
    bucket.paint.push(box(hw * 1.50, H * 0.040, 0.30, 0, deckAt(zA) + H * 0.030, zA, -0.14));
    if (fine) bucket.trim.push(box(hw * 1.46, H * 0.016, 0.06, 0, deckAt(zA) + H * 0.048, zA - 0.12, -0.14));
  } else if (spec.wing === 'lip') {
    const zA = tail + 0.11;
    bucket.paint.push(box(hw * 1.58, H * 0.030, 0.15, 0, deckAt(zA) + H * 0.016, zA, -0.24));
  }
}

function sideDetail(spec, dims, bucket, stations, tier, arch) {
  const hw = dims.width / 2, H = dims.height, L = dims.length;
  const fine = tier !== 'lo';
  const mz = spec.mirrorZ * L - L / 2;
  const zt = (t) => (t - 0.5) * L;
  const belt = spec.beltAt || 0.70;
  const cab = archCabin(arch);

  for (const s of [-1, 1]) {
    /* Mirror: a stalk, a shell with a rounded back, and a dark glass face.
       The old one was a single box, which from the cockpit looked like a brick
       bolted to the door. */
    bucket.dark.push(box(0.085, 0.032, 0.05, s * hw * 0.99, H * spec.mirrorY, mz));
    const shell = new THREE.SphereGeometry(0.088, fine ? 14 : 8, fine ? 10 : 6);
    shell.scale(0.88, 0.70, 1.18);
    shell.rotateY(s * 0.16);
    shell.translate(s * (hw + 0.10), H * spec.mirrorY + 0.028, mz);
    bucket.paint.push(shell);
    bucket.dark.push(box(0.018, 0.052, 0.135, s * (hw + 0.137), H * spec.mirrorY + 0.028, mz, 0, s * 0.16));

    // door handles, sunk into a shadowed recess
    for (const dz of spec.handles || []) {
      bucket.dark.push(box(0.024, 0.052, 0.20, s * hw * 0.985, H * belt, zt(dz)));
      bucket.chrome.push(box(0.032, 0.026, 0.15, s * hw * 1.000, H * belt + 0.004, zt(dz)));
    }
    // sill / side skirt, with a body-coloured blade under it
    bucket.dark.push(box(0.05, H * 0.075, L * 0.42, s * hw * 0.96, H * 0.165, -L * 0.02));
    if (fine) bucket.paint.push(box(0.028, H * 0.022, L * 0.40, s * hw * 1.00, H * 0.135, -L * 0.02));
  }

  /* Window surround and arch lips, laid along the *actual* loft, so they
     follow the shape the station table produced rather than an approximation
     of it. A bright line around the glasshouse and a lip around each arch are
     two of the strongest "this is a real car" cues there are. */
  if (fine) {
    const tube = (pts, r, seg) => {
      if (pts.length < 4) return null;
      const c = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(c, Math.min(seg, pts.length * 2), r, 4, false);
    };
    for (const s of [-1, 1]) {
      const belts = [];
      for (const st of stations) {
        if (st.cabin) belts.push(new THREE.Vector3(s * st.wBody * 0.982, st.yBelt + 0.006, st.z));
      }
      const g = tube(belts, 0.011, 26);
      if (g) bucket.trim.push(g);
      if (arch === 'wagon' || arch === 'van') {
        const rail = [];
        for (const st of stations) {
          if (st.cabin && st.wRoof > st.wBody * 0.5) {
            rail.push(new THREE.Vector3(s * st.wRoof * 0.80, st.yRoof + 0.022, st.z));
          }
        }
        const rg = tube(rail, 0.020, 20);
        if (rg) bucket.trim.push(rg);
      }
      for (const [zA, r] of [[spec.axleF, spec.wheelRF], [spec.axleR, spec.wheelRR]]) {
        const a = r * 1.30, lip = [];
        for (const st of stations) {
          if (Math.abs(st.z - zA) < a * 0.97 && st.yFloor > dims.floor + 0.015) {
            lip.push(new THREE.Vector3(s * (st.wBody + 0.014), st.yFloor - 0.004, st.z));
          }
        }
        const lg = tube(lip, 0.019, 16);
        if (lg) bucket.paint.push(lg);
      }
    }
    /* Shark-fin aerial. It has to sit on the roof at *that* station: the
       tables only reach rf = 1.0 around the middle of the cabin, so anchoring
       it to H left it hovering 15 cm above the rear of the roof. */
    const finZ = zt(Math.min(cab[1] - 0.06, cab[0] + 0.13));
    let roofSt = stations[0], rd = 1e9;
    for (const st of stations) {
      const d = Math.abs(st.z - finZ);
      if (d < rd) { rd = d; roofSt = st; }
    }
    const fin = new THREE.BoxGeometry(0.035, 0.055, 0.20);
    fin.translate(0, roofSt.yRoof + roofSt.crown + 0.018, finZ);
    bucket.paint.push(fin);
    // wipers parked at the base of the windscreen
    if (tier === 'hi') {
      for (const s of [-1, 1]) {
        bucket.dark.push(box(0.42, 0.016, 0.024, s * hw * 0.34, H * (belt + 0.055), zt(cab[1] + 0.012), 0, s * 0.12));
      }
    }
  }

  /* Interior. You look straight through the glass on a turntable and from the
     cockpit camera, so an empty shell is very obvious. Seats, a dash and a
     wheel are a few hundred triangles and they carry the whole illusion. */
  const iw = dims.width * 0.78;
  bucket.interior.push(box(iw, 0.05, L * 0.42, 0, H * (belt - 0.155), zt((cab[0] + cab[1]) / 2)));
  bucket.interior.push(box(iw, H * 0.16, 0.06, 0, H * (belt - 0.10), zt(cab[0] + 0.035)));
  bucket.interior.push(box(iw * 0.98, H * 0.10, 0.30, 0, H * (belt - 0.045), zt(cab[1] - 0.035), 0.22));
  if (fine) {
    const rim = new THREE.TorusGeometry(0.165, 0.020, 4, 14);
    rim.rotateX(1.16);
    rim.translate(-dims.width * 0.215, H * (belt - 0.015), zt(cab[1] - 0.115));
    bucket.interior.push(rim);
  }
  const seat = (x, t0) => {
    bucket.seat.push(box(0.44, 0.09, 0.44, x, H * (belt - 0.185), zt(t0) + 0.10));
    bucket.seat.push(box(0.42, H * 0.30, 0.10, x, H * (belt - 0.055), zt(t0) - 0.13, -0.16));
    bucket.seat.push(box(0.20, 0.13, 0.08, x, H * (belt + 0.055), zt(t0) - 0.19));
  };
  const frontT = Math.max(cab[0] + 0.10, cab[1] - 0.255);
  seat(-dims.width * 0.215, frontT);
  seat(dims.width * 0.215, frontT);
  if (fine && cab[1] - cab[0] > 0.44) {
    const rearT = frontT - 0.155;
    bucket.seat.push(box(iw * 0.90, 0.10, 0.42, 0, H * (belt - 0.185), zt(rearT) + 0.08));
    bucket.seat.push(box(iw * 0.90, H * 0.26, 0.10, 0, H * (belt - 0.065), zt(rearT) - 0.14, -0.13));
  }

  /* Inner arch liners and a floor pan. Without these you look straight
     through the wheel arch and out the other side of the car. */
  for (const [zA, r] of [[spec.axleF, spec.wheelRF], [spec.axleR, spec.wheelRR]]) {
    const a = r * 1.30;
    const liner = new THREE.CylinderGeometry(a * 0.985, a * 0.985, dims.width * 0.90, fine ? 18 : 12, 1, true, 0, Math.PI);
    liner.rotateZ(Math.PI / 2);
    liner.translate(0, r, zA);
    bucket.liner.push(liner);
  }
  bucket.liner.push(box(dims.width * 0.90, 0.04, L * 0.94, 0, dims.floor + 0.01, 0));
}

/* ---------------------------------------------------------- plate & LEDs */
function plateMesh(text, w, h, x, y, z, ry = 0) {
  const { tex, aspect } = plateTex(text);
  const g = new THREE.PlaneGeometry(w, w / aspect);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.0 }));
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}

/* Front and rear plate carry the same texture, so they can be one mesh — and
   one draw call rather than two, thirty times over. */
function platePair(text, w, yF, zF, yR, zR) {
  const { tex, aspect } = plateTex(text);
  const h = w / aspect;
  const f = new THREE.PlaneGeometry(w, h);
  f.translate(0, yF, zF);
  const r = new THREE.PlaneGeometry(w, h);
  r.rotateY(Math.PI);
  r.translate(0, yR, zR);
  return new THREE.Mesh(mergeGeometries([f, r]),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.0 }));
}

/* ============================================================ car specs */
const D = (length, width, height, floor = 0.15) => ({ length, width, height, floor });

export const CARS = {
  /* ---------------------------------------------------- the four you drive */
  turbo: {
    name: 'Zuffenhausen 9 Turbo S', marque: 'Rennsport', arch: 'fastback',
    dims: D(4.54, 1.90, 1.30, 0.125),
    axleF: 1.29, axleR: -1.16, trackF: 1.60, trackR: 1.66,
    wheelRF: 0.345, wheelRR: 0.365, wheelWF: 0.245, wheelWR: 0.315,
    spokes: 5, caliper: 'yellow', face: 'roundlamp', lightY: 0.605,
    tailStyle: 'bar', tailY: 0.66, pipes: 2, wing: 'ducktail',
    mirrorZ: 0.752, mirrorY: 0.715, beltAt: 0.66, handles: [0.56],
    plate: 'S PS 911',
    /* Gentianblau first, because the still photograph in the menu is of the
       blue car and the car you drive has to be the car in the picture. */
    paints: [{ n: 'Gentianblau', c: 0x1b46b0 }, { n: 'Indischrot', c: 0xb0121f },
      { n: 'GT-Silber', c: 0xb9bdc0 }, { n: 'Achatgrau', c: 0x4a5157 }],
    perf: { mass: 1640, power: 478, cd: 0.72, vmax: 330, grip: 1.42, awd: true, gears: 8, launch: 0.78, redline: 7200 },
    blurb: 'Heckmotor, Allrad, 650 PS. Klebt bei 300 noch auf der linken Spur und lässt sich vom Gegenverkehr nicht beeindrucken. Teuerste Art, in Flensburg Punkte zu sammeln.',

    blurbEn: 'Rear engine, all-wheel drive, 650 hp. Still planted in the left-hand lane at 300, and utterly unbothered by oncoming traffic. The most expensive way there is to collect points in Flensburg.',  },
  m5: {
    name: 'Bayern M-Sport M5 CS', marque: 'Bayerische Motoren', arch: 'sedan',
    dims: D(5.00, 1.90, 1.47, 0.155),
    axleF: 1.55, axleR: -1.43, trackF: 1.63, trackR: 1.65,
    wheelRF: 0.355, wheelRR: 0.365, wheelWF: 0.275, wheelWR: 0.305,
    spokes: 5, caliper: 'red', face: 'kidney', lightY: 0.55,
    tailStyle: 'lshape', tailY: 0.68, pipes: 4, wing: 'lip',
    mirrorZ: 0.756, mirrorY: 0.735, beltAt: 0.70, handles: [0.44, 0.615],
    plate: 'M BM 5',
    /* First entry matches the menu photograph — see carHero.js. */
    paints: [{ n: 'Frozen Bluestone', c: 0x3b4350 }, { n: 'Marina-Bay-Blau', c: 0x1c56b4 },
      { n: 'Frozen Schwarz', c: 0x1a1c1f }, { n: 'Brands-Hatch-Grau', c: 0x6e757b }],
    perf: { mass: 1825, power: 467, cd: 0.78, vmax: 305, grip: 1.34, awd: true, gears: 8, launch: 0.73, redline: 7200 },
    blurb: 'Vier Türen, Allrad, V8-Biturbo. Der Klassiker der linken Spur: fährt 300 als wäre es 130 und hat Platz für das Gepäck von vier Leuten, die das nicht wollten.',

    blurbEn: 'Four doors, all-wheel drive, twin-turbo V8. The classic of the fast lane: does 300 like it is 130, with room for the luggage of four people who did not want to be here.',  },
  rs6: {
    name: 'Ingolstadt RS-6 Avant', marque: 'Vier Ringe', arch: 'wagon',
    dims: D(5.02, 1.95, 1.47, 0.16),
    axleF: 1.53, axleR: -1.40, trackF: 1.67, trackR: 1.66,
    wheelRF: 0.360, wheelRR: 0.360, wheelWF: 0.285, wheelWR: 0.285,
    spokes: 5, rimDark: true, caliper: 'red', face: 'singleframe', lightY: 0.545,
    tailStyle: 'bar', tailY: 0.68, pipes: 2, wing: 'roof',
    mirrorZ: 0.744, mirrorY: 0.745, beltAt: 0.715, handles: [0.44, 0.615],
    plate: 'IN AU 6',
    paints: [{ n: 'Nardograu', c: 0x9a9da0 }, { n: 'Mythosschwarz', c: 0x22252a }, { n: 'Tangorot', c: 0x8e1a12 }],
    perf: { mass: 2075, power: 441, cd: 0.86, vmax: 305, grip: 1.38, awd: true, gears: 8, launch: 0.625, redline: 6800 },
    blurb: 'Ein Kombi. Platz für Kinderwagen, Hund und den halben Baumarkt — und 600 PS. Die braucht man auf dem Rückweg aus dem Familienurlaub, wenn hinten zum vierzigsten Mal gefragt wird, ob man bald da ist. Man ist dann bald da.',

    blurbEn: 'An estate car. Room for the pram, the dog and half a hardware shop — and 600 hp. You need those on the drive home from the family holiday, when the back seat asks for the fortieth time whether you are nearly there. You are nearly there.',  },
  amg: {
    name: 'Affalterbach AMG 63 S', marque: 'Stern aus Stuttgart', arch: 'coupe4',
    dims: D(4.94, 1.90, 1.43, 0.15),
    axleF: 1.52, axleR: -1.34, trackF: 1.62, trackR: 1.64,
    wheelRF: 0.350, wheelRR: 0.365, wheelWF: 0.265, wheelWR: 0.305,
    spokes: 5, caliper: 'red', face: 'star', lightY: 0.55,
    tailStyle: 'lshape', tailY: 0.665, pipes: 4, wing: 'lip',
    mirrorZ: 0.756, mirrorY: 0.725, beltAt: 0.69, handles: [0.44, 0.615],
    plate: 'S MB 63',
    /* First entry matches the menu photograph — see carHero.js. */
    paints: [{ n: 'Graphitgrau', c: 0x44474c }, { n: 'Selenitgrau', c: 0x5b6066 },
      { n: 'Obsidianschwarz', c: 0x191b1e }, { n: 'Hyazinthrot', c: 0x7e1220 }],
    perf: { mass: 1800, power: 375, cd: 0.76, vmax: 290, grip: 1.30, awd: false, gears: 7, launch: 0.605, redline: 7000 },
    blurb: 'Handgebauter V8, Hinterradantrieb, und ein Geräusch, das aus Nachbarn Feinde macht. Geradeaus fantastisch, in Kurven will das Heck gelegentlich mitreden. Verbraucht auf dem Weg zum Bäcker mehr als ein Kleinwagen im Monat.',

    blurbEn: 'A hand-built V8, rear-wheel drive, and a noise that turns neighbours into enemies. Magnificent in a straight line; in corners the back end likes to join the conversation. Uses more fuel going to the bakery than a small car does in a month.',  },

  /* ---------------------------------------------------------- other traffic */
  kombi: {
    name: 'Kombi', arch: 'wagon', dims: D(4.77, 1.83, 1.48, 0.185),
    axleF: 1.44, axleR: -1.35, trackF: 1.58, trackR: 1.57,
    wheelRF: 0.325, wheelRR: 0.325, wheelWF: 0.215, wheelWR: 0.215,
    spokes: 5, rimDark: true, face: 'generic', lightY: 0.56, tailStyle: 'plain', tailY: 0.70,
    pipes: 1, mirrorZ: 0.744, mirrorY: 0.750, beltAt: 0.72, handles: [0.44, 0.615],
    perf: { mass: 1560, power: 110, cd: 0.80, vmax: 215, grip: 1.05, awd: false, gears: 7, redline: 5000 },
  },
  hatch: {
    name: 'Kleinwagen', arch: 'hatch', dims: D(4.28, 1.79, 1.46, 0.19),
    axleF: 1.28, axleR: -1.30, trackF: 1.54, trackR: 1.53,
    wheelRF: 0.315, wheelRR: 0.315, wheelWF: 0.205, wheelWR: 0.205,
    spokes: 5, rimDark: true, face: 'generic', lightY: 0.57, tailStyle: 'plain', tailY: 0.72,
    pipes: 1, mirrorZ: 0.752, mirrorY: 0.760, beltAt: 0.73, handles: [0.42, 0.62],
    perf: { mass: 1320, power: 85, cd: 0.76, vmax: 200, grip: 1.02, awd: false, gears: 6, redline: 5200 },
  },
  taxi: {
    name: 'Limousine', arch: 'sedan', dims: D(4.95, 1.85, 1.47, 0.175),
    axleF: 1.52, axleR: -1.40, trackF: 1.60, trackR: 1.60,
    wheelRF: 0.335, wheelRR: 0.335, wheelWF: 0.215, wheelWR: 0.215,
    spokes: 5, face: 'star', lightY: 0.55, tailStyle: 'plain', tailY: 0.69,
    pipes: 2, mirrorZ: 0.756, mirrorY: 0.730, beltAt: 0.70, handles: [0.44, 0.615],
    perf: { mass: 1720, power: 145, cd: 0.74, vmax: 235, grip: 1.06, awd: false, gears: 9, redline: 4800 },
  },
  van: {
    name: 'Transporter', arch: 'van', dims: D(4.95, 1.92, 1.99, 0.215),
    axleF: 1.45, axleR: -1.55, trackF: 1.62, trackR: 1.62,
    wheelRF: 0.345, wheelRR: 0.345, wheelWF: 0.225, wheelWR: 0.225,
    spokes: 6, rimDark: true, face: 'generic', lightY: 0.40, tailStyle: 'plain', tailY: 0.62,
    pipes: 1, mirrorZ: 0.878, mirrorY: 0.585, beltAt: 0.50, handles: [0.56],
    perf: { mass: 2200, power: 110, cd: 1.20, vmax: 175, grip: 0.96, awd: false, gears: 6, redline: 4400 },
  },

  /* ------------------------------------------------------- Zivilstreifen */
  /* Real Zivilstreifen are not slow. The Autobahnpolizei runs 5-series
     Tourings, E-Klassen and A6 quattros with trained drivers, so these top out
     only just below the cars you drive — you cannot simply out-drag one, and
     an escape has to be earned through traffic, braking and corners. */
  zivi_limo: {
    name: 'Zivilstreife E-Klasse', arch: 'sedan', dims: D(4.95, 1.85, 1.46, 0.175),
    axleF: 1.52, axleR: -1.40, trackF: 1.60, trackR: 1.60,
    wheelRF: 0.345, wheelRR: 0.345, wheelWF: 0.235, wheelWR: 0.235,
    ledZ: 0.285, ledY: 0.80,
    spokes: 5, rimDark: true, face: 'star', lightY: 0.55, tailStyle: 'plain', tailY: 0.69,
    pipes: 2, mirrorZ: 0.756, mirrorY: 0.730, beltAt: 0.70, handles: [0.44, 0.615],
    perf: { mass: 1780, power: 270, cd: 0.75, vmax: 295, grip: 1.24, awd: true, gears: 9, redline: 6400 },
  },
  zivi_touring: {
    name: 'Zivilstreife 5er Touring', arch: 'wagon', dims: D(5.06, 1.87, 1.50, 0.18),
    axleF: 1.55, axleR: -1.42, trackF: 1.60, trackR: 1.62,
    wheelRF: 0.345, wheelRR: 0.345, wheelWF: 0.245, wheelWR: 0.245,
    ledZ: 0.055, ledY: 0.865,
    spokes: 5, rimDark: true, face: 'kidney', lightY: 0.55, tailStyle: 'lshape', tailY: 0.69,
    pipes: 2, mirrorZ: 0.744, mirrorY: 0.745, beltAt: 0.715, handles: [0.44, 0.615],
    perf: { mass: 1880, power: 250, cd: 0.80, vmax: 285, grip: 1.26, awd: true, gears: 8, redline: 6200 },
  },
  zivi_avant: {
    name: 'Zivilstreife A6 Avant', arch: 'wagon', dims: D(4.94, 1.89, 1.47, 0.18),
    axleF: 1.50, axleR: -1.40, trackF: 1.62, trackR: 1.61,
    wheelRF: 0.340, wheelRR: 0.340, wheelWF: 0.235, wheelWR: 0.235,
    ledZ: 0.055, ledY: 0.865,
    spokes: 5, rimDark: true, face: 'singleframe', lightY: 0.55, tailStyle: 'bar', tailY: 0.69,
    pipes: 2, mirrorZ: 0.744, mirrorY: 0.745, beltAt: 0.715, handles: [0.44, 0.615],
    perf: { mass: 1870, power: 265, cd: 0.79, vmax: 290, grip: 1.28, awd: true, gears: 8, redline: 6500 },
  },
  zivi_kompakt: {
    name: 'Zivilstreife 3er', arch: 'sedan', dims: D(4.71, 1.83, 1.44, 0.17),
    axleF: 1.44, axleR: -1.31, trackF: 1.58, trackR: 1.60,
    wheelRF: 0.335, wheelRR: 0.345, wheelWF: 0.225, wheelWR: 0.245,
    ledZ: 0.285, ledY: 0.795,
    spokes: 5, rimDark: true, face: 'kidney', lightY: 0.555, tailStyle: 'lshape', tailY: 0.685,
    pipes: 2, mirrorZ: 0.752, mirrorY: 0.735, beltAt: 0.70, handles: [0.44, 0.615],
    perf: { mass: 1670, power: 285, cd: 0.73, vmax: 300, grip: 1.32, awd: true, gears: 8, redline: 7000 },
  },
  messwagen: {
    name: 'Messfahrzeug', arch: 'van', dims: D(4.95, 1.92, 1.99, 0.215),
    axleF: 1.45, axleR: -1.55, trackF: 1.62, trackR: 1.62,
    wheelRF: 0.345, wheelRR: 0.345, wheelWF: 0.225, wheelWR: 0.225,
    ledZ: 0.045, ledY: 0.72,
    spokes: 6, rimDark: true, face: 'generic', lightY: 0.40, tailStyle: 'plain', tailY: 0.62,
    pipes: 1, mirrorZ: 0.878, mirrorY: 0.585, beltAt: 0.50, handles: [0.56],
    perf: { mass: 2300, power: 110, cd: 1.20, vmax: 170, grip: 0.96, awd: false, gears: 6, redline: 4400 },
  },
};

export const PLAYER_CARS = ['turbo', 'm5', 'rs6', 'amg'];

/* --------------------------------------- German Kreis codes along the A81 */
export const KREIS = ['S', 'BB', 'LB', 'TÜ', 'RW', 'VS', 'TUT', 'KN', 'FDS', 'HN', 'WN', 'ES', 'GP', 'RT'];
export function randomPlate(rand) {
  const k = KREIS[Math.floor(rand() * KREIS.length)];
  const L = 'ABCDEFGHIKLMNOPRSTUVWXYZ';
  const a = L[Math.floor(rand() * L.length)] + L[Math.floor(rand() * L.length)];
  const n = 10 + Math.floor(rand() * 9980);
  return `${k} ${a} ${n}`;
}

/* ================================================== geometry cache & build */
const _geoCache = new Map();

/** Detail tier: the car you drive, the cars watching you, and everyone else. */
function tierOf(id) {
  if (PLAYER_CARS.includes(id)) return 'hi';
  if (id.startsWith('zivi') || id === 'messwagen') return 'mid';
  return 'lo';
}

const BUCKETS = ['paint', 'glass', 'dark', 'grille', 'chrome', 'trim', 'reflector',
  'light', 'drl', 'tail', 'interior', 'seat', 'liner'];

/* Which buckets collapse into which on the cheap tier. Every bucket is one
   mesh and every mesh is one draw call; with twenty-six traffic cars and four
   patrol cars the material count costs more than the triangles do, and at two
   hundred metres nobody can tell satin trim from gloss black anyway. */
const LO_MERGE = {
  grille: 'dark', trim: 'dark', chrome: 'dark', reflector: 'dark',
  drl: 'light', seat: 'interior',
};

/** Where the door shut lines fall, in table t. Derived from the handles. */
function shutLines(spec) {
  const h = spec.handles || [];
  if (h.length >= 2) {
    const a = Math.min(...h), b = Math.max(...h);
    return [+(a - 0.105).toFixed(3), +((a + b) / 2).toFixed(3), +(b + 0.105).toFixed(3)];
  }
  if (h.length === 1) return [+(h[0] - 0.150).toFixed(3), +(h[0] + 0.135).toFixed(3)];
  return [0.42, 0.60];
}

function bakeCar(id) {
  if (_geoCache.has(id)) return _geoCache.get(id);
  const spec = CARS[id];
  const dims = spec.dims;
  const tier = tierOf(id);
  const T = TIERS[tier];
  const stations = buildStations(spec.arch, dims, T.steps, spec);
  const { paint, glass } = loft(stations, T.sec);

  const bucket = {};
  for (const k of BUCKETS) bucket[k] = [];
  bucket.paint.push(paint);
  if (glass) bucket.glass.push(glass);
  frontEnd(spec, dims, bucket, tier);
  rearEnd(spec, dims, bucket, tier, stations);
  sideDetail(spec, dims, bucket, stations, tier, spec.arch);

  if (tier === 'lo') {
    for (const from of Object.keys(LO_MERGE)) {
      if (bucket[from].length) {
        bucket[LO_MERGE[from]].push(...bucket[from]);
        bucket[from] = [];
      }
    }
  }

  const out = {};
  for (const k of BUCKETS) {
    if (!bucket[k].length) continue;
    out[k] = bucket[k].length === 1 ? bucket[k][0] : mergeGeometries(bucket[k]);
  }

  /* Panel gaps, sill shading and roughness variation live in the paint's
     texture, drawn in loft UV space (see carTextures.js). Only the cars you
     can get close to get them. */
  const detail = T.detail ? bodyDetail({
    sec: T.sec, arch: spec.arch, cabin: archCabin(spec.arch),
    lines: shutLines(spec), belt: spec.beltAt || 0.7,
  }) : null;

  const res = { geos: out, detail, tier };
  _geoCache.set(id, res);
  return res;
}

/* A loaded glTF body, if one is available for this id.

   carModels.js registers itself here rather than carFactory importing it, so
   there is no import cycle and the procedural path has no dependency on the
   loader at all: if models are switched off, not licensed, or fail to
   download, buildCar simply never asks. */
let _modelProvider = null;
export function setModelProvider(fn) { _modelProvider = fn; }

/**
 * Build a complete car.
 * opts: { paint, plate, police:{blue:true, led:true}, marked }
 */
export function buildCar(id, opts = {}) {
  if (_modelProvider) {
    const m = _modelProvider(id, opts);
    if (m) return m;
  }
  const spec = CARS[id];
  const dims = spec.dims;
  const { geos, detail, tier } = bakeCar(id);
  const g = new THREE.Group();
  g.name = id;

  const paintCol = opts.paint ?? (spec.paints ? spec.paints[0].c : 0x8b9095);
  const paintMat = MAT.body(paintCol, detail);

  const add = (geo, mat) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
  add(geos.paint, paintMat);
  add(geos.interior, MAT.interior);
  add(geos.seat, MAT.seat);
  add(geos.liner, MAT.liner);
  add(geos.dark, MAT.dark);
  add(geos.grille, MAT.grille);
  add(geos.chrome, MAT.chrome);
  add(geos.trim, MAT.trim);
  add(geos.reflector, MAT.reflector);
  const headMat = MAT.headlight.clone();
  const tailMat = MAT.tail.clone();
  add(geos.light, headMat);
  add(geos.drl, MAT.drl);
  add(geos.tail, tailMat);
  // glass last: it is transparent and reads through to the interior behind it
  add(geos.glass, MAT.glass);

  // ---- wheels
  const wheels = [];
  for (const [front, zAxle, track] of [[true, spec.axleF, spec.trackF], [false, spec.axleR, spec.trackR]]) {
    for (const s of [-1, 1]) {
      const w = buildWheel(spec, front, tier);
      w.position.set(s * track / 2, front ? spec.wheelRF : spec.wheelRR, zAxle);
      w.userData.front = front;
      g.add(w); wheels.push(w);
    }
  }

  finishCar(g, { id, spec, dims, wheels, paintMat, headMat, tailMat, tier, opts });
  return g;
}

/**
 * Everything a car needs that is not its bodywork: plates, contact shadow,
 * police kit, headlamp glow sprites, and the `userData` contract that
 * vehicles.js, police.js, hud.js and the collision code all read.
 *
 * Extracted so a loaded glTF body can be dressed by exactly the same code —
 * if these two paths ever diverge, the police lights or the plates break on
 * one of them and it is very hard to see why.
 */
export function finishCar(g, ctx) {
  const { id, spec, dims, wheels, paintMat, headMat, tailMat, tier, opts } = ctx;
  // ---- plates, front and rear, in one mesh
  const plateTxt = opts.plate || spec.plate || 'S AB 81';
  const pw = Math.min(0.52, dims.width * 0.30);
  g.add(platePair(plateTxt, pw,
    dims.height * 0.245, dims.length / 2 + 0.008,
    dims.height * 0.30, -dims.length / 2 - 0.008));

  // ---- fake contact shadow, car-shaped rather than a circle in a rectangle
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(dims.width * 2.05, dims.length * 1.34), MAT.shadow);
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.015;
  sh.renderOrder = -1;
  g.add(sh);

  // ---- unmarked police kit: blue LEDs behind the grille and on the rear shelf
  const blues = [];
  let led = null;
  if (opts.police) {
    const H = dims.height, hw = dims.width / 2, L = dims.length;
    const mkBlue = (x, y, z, w, h, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), MAT.blue.clone());
      m.position.set(x, y, z); m.rotation.y = ry;
      g.add(m); blues.push(m); return m;
    };
    // front: two strips tucked in behind the radiator grille
    mkBlue(-hw * 0.34, H * 0.455, L / 2 + 0.006, hw * 0.32, H * 0.060);
    mkBlue(hw * 0.34, H * 0.455, L / 2 + 0.006, hw * 0.32, H * 0.060);
    // rear: on the parcel shelf, shining out through the back glass
    const lz = -L / 2 + L * (spec.ledZ ?? 0.30);
    const ly = H * (spec.ledY ?? 0.80);
    mkBlue(-hw * 0.40, ly, lz, hw * 0.34, H * 0.045);
    mkBlue(hw * 0.40, ly, lz, hw * 0.34, H * 0.045);
    // side repeaters in the mirrors
    mkBlue(-hw - 0.02, H * spec.mirrorY + 0.03, spec.mirrorZ * L - L / 2, 0.05, 0.03, Math.PI / 2);
    mkBlue(hw + 0.02, H * spec.mirrorY + 0.03, spec.mirrorZ * L - L / 2, 0.05, 0.03, Math.PI / 2);

    // rear-window LED matrix: STOP POLIZEI
    const off = ledTex('STOP POLIZEI', false), on = ledTex('STOP POLIZEI', true);
    const lw = dims.width * 0.56;
    const lm = new THREE.Mesh(
      new THREE.PlaneGeometry(lw, lw / on.aspect),
      new THREE.MeshBasicMaterial({ map: off.tex, transparent: false })
    );
    lm.position.set(0, ly - H * 0.055, lz - 0.04);
    lm.rotation.y = Math.PI;
    lm.userData = { off: off.tex, on: on.tex };
    g.add(lm); led = lm;
  }

  /* Headlamp glow. A Lichthupe has to be legible from hundreds of metres in
     daylight, and cranking a small emissive box does not do it — these
     additive sprites do. They stay at zero opacity until something flashes. */
  const glows = [];
  if (opts.glow !== false) {
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(MAT.glow.clone());
      sp.scale.setScalar(dims.width * 0.62);
      sp.position.set(s * dims.width * 0.30, spec.lightY * dims.height, dims.length / 2 + 0.05);
      sp.visible = false;
      g.add(sp); glows.push(sp);
    }
  }

  g.userData = {
    id, spec, dims, wheels, blues, led, glows, tier,
    paintMat, headMat, tailMat,
    halfLen: dims.length / 2, halfWid: dims.width / 2,
  };
  return g;
}

/* ===================================================== Sattelzug (artic) */
export function buildTruck(opts = {}) {
  const g = new THREE.Group();
  const cabCol = opts.cab ?? 0x2f5fa8;
  const boxCol = opts.box ?? 0xe8e9e6;
  const cabMat = MAT.make(cabCol, 0.5, 0.35);
  const boxMat = MAT.make(boxCol, 0.15, 0.62);

  // cab-over-engine tractor unit
  const cab = [];
  cab.push(box(2.48, 2.10, 2.30, 0, 2.10, 1.25));
  cab.push(box(2.42, 0.55, 2.24, 0, 3.42, 1.22));          // roof fairing
  cab.push(box(2.50, 0.70, 1.10, 0, 0.85, 1.85));          // bumper area
  const cabG = mergeGeometries(cab);
  g.add(new THREE.Mesh(cabG, cabMat));

  const glass = [];
  glass.push(box(2.20, 1.00, 0.10, 0, 2.72, 2.36, -0.10));   // windscreen
  for (const s of [-1, 1]) glass.push(box(0.08, 0.72, 1.10, s * 1.245, 2.55, 1.30));
  g.add(new THREE.Mesh(mergeGeometries(glass), MAT.glass));

  const dark = [];
  dark.push(box(2.56, 0.42, 0.36, 0, 0.62, 2.30));           // front bumper
  dark.push(box(2.30, 0.34, 0.30, 0, 1.16, 2.34));           // grille
  dark.push(box(2.10, 0.12, 3.40, 0, 1.05, -0.60));          // chassis
  dark.push(box(2.30, 0.14, 0.30, 0, 1.22, -2.20));
  for (const s of [-1, 1]) {                                  // mirrors, tanks, stacks
    dark.push(box(0.10, 0.44, 0.34, s * 1.55, 2.55, 1.95));
    dark.push(cyl(0.30, 0.30, 1.00, 12, s * 1.20, 1.05, -0.40));
    dark.push(cyl(0.09, 0.09, 1.90, 10, s * 1.10, 2.10, -1.85, 'y'));
  }
  g.add(new THREE.Mesh(mergeGeometries(dark), MAT.dark));

  const lights = [];
  for (const s of [-1, 1]) lights.push(box(0.60, 0.26, 0.16, s * 0.90, 1.28, 2.40));
  g.add(new THREE.Mesh(mergeGeometries(lights), MAT.headlight));

  // semi-trailer
  const tr = new THREE.Group();
  tr.position.z = -1.30;
  const body = [];
  body.push(box(2.55, 2.85, 13.20, 0, 2.65, -5.60));
  const trBody = new THREE.Mesh(mergeGeometries(body), boxMat);
  tr.add(trBody);
  const trDark = [];
  trDark.push(box(2.40, 0.16, 12.60, 0, 1.18, -5.60));
  trDark.push(box(2.50, 0.55, 0.14, 0, 0.72, -12.10));         // underrun bar
  for (const s of [-1, 1]) trDark.push(box(0.06, 0.60, 1.60, s * 1.27, 0.85, -10.50));
  tr.add(new THREE.Mesh(mergeGeometries(trDark), MAT.dark));
  const trTail = [];
  for (const s of [-1, 1]) trTail.push(box(0.34, 0.50, 0.10, s * 1.00, 1.05, -12.22));
  tr.add(new THREE.Mesh(mergeGeometries(trTail), MAT.tail));
  g.add(tr);

  // wheels: steer axle, twin drive axles, tri-axle bogie
  const wheels = [];
  const addAxle = (z, twin, r = 0.52) => {
    for (const s of [-1, 1]) {
      for (let t = 0; t < (twin ? 2 : 1); t++) {
        const w = buildWheel({ wheelRF: r, wheelRR: r, wheelWF: 0.30, wheelWR: 0.30, spokes: 6, rimDark: true }, true);
        w.position.set(s * (1.02 + t * 0.34), r, z);
        g.add(w); wheels.push(w);
      }
    }
  };
  addAxle(1.35, false);
  addAxle(-1.35, true); addAxle(-2.75, true);
  addAxle(-9.30, true); addAxle(-10.70, true); addAxle(-12.10, true);

  const plate = opts.plate || 'RW TR 4711';
  g.add(plateMesh(plate, 0.52, 0, 0, 0.95, 2.52));

  const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 17.5), MAT.shadow);
  sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.015, -5.2); sh.renderOrder = -1;
  g.add(sh);

  /* Everything above was modelled with the origin at the tractor's front
     axle, so the combination hangs 13 m out behind z=0. Re-centre it on the
     middle of the rig, otherwise the collision box misses the whole trailer
     and the player drives through it before suddenly being ejected. */
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.z = 5.5;
  while (g.children.length) inner.add(g.children[0]);
  outer.add(inner);

  outer.userData = {
    id: 'truck', wheels, blues: [], led: null,
    dims: { length: 15.8, width: 2.55, height: 4.0 },
    halfLen: 7.9, halfWid: 1.30,
    perf: { mass: 38000, power: 375, cd: 5.8, vmax: 90, grip: 0.7, gears: 12, redline: 2200 },
  };
  return outer;
}
