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
import { plateTex, ledTex, shadowTex } from './textures.js';

/* ------------------------------------------------------------- materials */
const MAT = {};
export function initMaterials(envMap) {
  const paint = (hex, metal = 0.38, rough = 0.21) => new THREE.MeshStandardMaterial({
    color: hex, metalness: metal, roughness: rough, envMap, envMapIntensity: 1.35,
  });
  MAT.make = paint;
  MAT.glass = new THREE.MeshStandardMaterial({
    color: 0x121a21, metalness: 0.85, roughness: 0.06, envMap, envMapIntensity: 2.2,
    transparent: true, opacity: 0.78,
  });
  MAT.dark = new THREE.MeshStandardMaterial({ color: 0x14171a, metalness: 0.35, roughness: 0.62, envMap, envMapIntensity: 0.5 });
  MAT.grille = new THREE.MeshStandardMaterial({ color: 0x0a0c0e, metalness: 0.6, roughness: 0.45, envMap, envMapIntensity: 0.4 });
  MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dce0, metalness: 1.0, roughness: 0.13, envMap, envMapIntensity: 2.0 });
  MAT.tyre = new THREE.MeshStandardMaterial({ color: 0x0e1012, metalness: 0.0, roughness: 0.92 });
  MAT.rim = new THREE.MeshStandardMaterial({ color: 0x9fa5ab, metalness: 0.95, roughness: 0.24, envMap, envMapIntensity: 1.5 });
  MAT.rimDark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.9, roughness: 0.35, envMap, envMapIntensity: 1.0 });
  MAT.disc = new THREE.MeshStandardMaterial({ color: 0x5d6266, metalness: 0.85, roughness: 0.42 });
  MAT.caliperRed = new THREE.MeshStandardMaterial({ color: 0xc02018, metalness: 0.3, roughness: 0.4 });
  MAT.caliperYel = new THREE.MeshStandardMaterial({ color: 0xe0b418, metalness: 0.3, roughness: 0.4 });
  MAT.headlight = new THREE.MeshStandardMaterial({
    color: 0x9db0c6, emissive: 0xffeec6, emissiveIntensity: 0.22, metalness: 0.5, roughness: 0.26, envMap,
  });
  MAT.tail = new THREE.MeshStandardMaterial({ color: 0x6a0d10, emissive: 0xff1d10, emissiveIntensity: 0.75, roughness: 0.3, metalness: 0.2 });
  MAT.blue = new THREE.MeshStandardMaterial({ color: 0x081538, emissive: 0x1636ff, emissiveIntensity: 0, roughness: 0.28, metalness: 0.35 });
  MAT.shadow = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, opacity: 0.85 });
  MAT.interior = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.9, metalness: 0 });
  MAT.liner = new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  return MAT;
}
export { MAT };

/* ========================================================== the loft core */
const SEC = { nB: 5, nS: 6, nG: 5, nR: 9 };
const REG = { BODY: 0, SIDE: 1, TOP: 2 };

function qbez(t, a, c, b) { const m = 1 - t; return m * m * a + 2 * m * t * c + t * t * b; }

/** Build the closed cross-section outline for one station. */
function section(st, pts, regs) {
  const { wBody, wBottom, yFloor, yBelt, wRoof, yRoof, crown } = st;
  const { nB, nS, nG, nR } = SEC;
  pts.length = 0; regs.length = 0;
  const push = (x, y, r) => { pts.push(x, y); regs.push(r); };

  // 1 — floor, left to right, edges curling up slightly
  for (let i = 0; i < nB; i++) {
    const f = i / (nB - 1);
    push(-wBottom + 2 * wBottom * f, yFloor + 0.035 * (2 * f - 1) ** 2, REG.BODY);
  }
  // 2 — right flank up to the beltline, bulging out over the sill
  const sideAt = (t) => [
    qbez(t, wBottom, wBody * 1.03, wBody),
    qbez(t, yFloor, yFloor + (yBelt - yFloor) * 0.66, yBelt),
  ];
  for (let i = 1; i < nS; i++) { const [x, y] = sideAt(i / (nS - 1)); push(x, y, REG.BODY); }
  // 3 — right greenhouse (tumblehome). Degenerates when there is no cabin.
  const ghAt = (t) => [
    qbez(t, wBody, wBody * 0.995, wRoof),
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
  for (let i = nS - 2; i >= 1; i--) { const [x, y] = sideAt(i / (nS - 1)); push(-x, y, REG.BODY); }
  return pts.length / 2;
}

/**
 * Loft the stations into two geometries sharing one vertex buffer:
 * `paint` (sheet metal) and `glass`.
 */
function loft(stations) {
  const pts = [], regs = [];
  const P = section(stations[0], pts, regs);
  const regions = regs.slice();
  const S = stations.length;

  const pos = new Float32Array(S * P * 3);
  const uv = new Float32Array(S * P * 2);
  for (let i = 0; i < S; i++) {
    const st = stations[i];
    section(st, pts, regs);
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

function buildStations(arch, dims, steps = 58, spec = null) {
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
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const wf = crClamped(keys, 1, t), bf = crClamped(keys, 2, t) - (BELT_DROP[arch] || 0);
    let rwf = crClamped(keys, 3, t), rf = crClamped(keys, 4, t);
    const kk = nearestKey(keys, t);
    const wBody = Math.max(0.02, wf * hw);
    const z = (t - 0.5) * L;
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
    });
  }
  return out;
}

/* ------------------------------------------------------------- the wheel */
const _wheelCache = new Map();
function wheelGeoms(radius, width, spokes, caliperColour) {
  const key = `${radius}|${width}|${spokes}`;
  if (_wheelCache.has(key)) return _wheelCache.get(key);
  const tyre = [], rim = [], dark = [], disc = [];
  const t = new THREE.CylinderGeometry(radius, radius, width, 24, 1, true);
  t.rotateZ(Math.PI / 2); tyre.push(t);
  // sidewall shoulders
  for (const s of [-1, 1]) {
    const sw = new THREE.TorusGeometry(radius * 0.93, radius * 0.075, 8, 22);
    sw.rotateY(Math.PI / 2); sw.translate(s * width * 0.46, 0, 0);
    tyre.push(sw);
  }
  const rf = new THREE.CylinderGeometry(radius * 0.74, radius * 0.74, width * 0.72, 20, 1, false);
  rf.rotateZ(Math.PI / 2); rim.push(rf);
  for (const s of [-1, 1]) {
    const face = new THREE.CircleGeometry(radius * 0.745, 20);
    face.rotateY(s * Math.PI / 2); face.translate(s * width * 0.37, 0, 0);
    rim.push(face);
  }
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(width * 0.16, radius * 0.62, radius * 0.11);
    sp.translate(0, radius * 0.33, 0);
    sp.rotateX(a);
    sp.translate(width * 0.40, 0, 0);
    rim.push(sp);
  }
  const hub = new THREE.CylinderGeometry(radius * 0.20, radius * 0.20, width * 0.86, 12);
  hub.rotateZ(Math.PI / 2); dark.push(hub);
  const br = new THREE.CylinderGeometry(radius * 0.60, radius * 0.60, width * 0.14, 18);
  br.rotateZ(Math.PI / 2); disc.push(br);
  const cal = new THREE.BoxGeometry(width * 0.20, radius * 0.44, radius * 0.20);
  cal.translate(0, radius * 0.40, -radius * 0.16);
  const res = {
    tyre: mergeGeometries(tyre), rim: mergeGeometries(rim),
    dark: mergeGeometries(dark), disc: mergeGeometries(disc), cal,
  };
  _wheelCache.set(key, res);
  return res;
}

function buildWheel(spec, front) {
  const g = new THREE.Group();
  const r = front ? spec.wheelRF : spec.wheelRR;
  const w = front ? spec.wheelWF : spec.wheelWR;
  const geo = wheelGeoms(r, w, spec.spokes || 5);
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(geo.tyre, MAT.tyre));
  spin.add(new THREE.Mesh(geo.rim, spec.rimDark ? MAT.rimDark : MAT.rim));
  spin.add(new THREE.Mesh(geo.dark, MAT.dark));
  g.add(spin);
  g.add(new THREE.Mesh(geo.disc, MAT.disc));
  if (spec.caliper) g.add(new THREE.Mesh(geo.cal, spec.caliper === 'yellow' ? MAT.caliperYel : MAT.caliperRed));
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
function frontEnd(spec, dims, bucket) {
  const hw = dims.width / 2, H = dims.height, L = dims.length, nose = L / 2;
  const y = spec.lightY * H;
  const zf = nose + 0.012;
  switch (spec.face) {
    case 'kidney': {   // twin vertical kidney grilles + LED rings
      for (const s of [-1, 1]) {
        bucket.grille.push(box(hw * 0.30, H * 0.20, 0.10, s * hw * 0.19, H * 0.44, zf - 0.02));
        bucket.chrome.push(box(hw * 0.32, H * 0.215, 0.05, s * hw * 0.19, H * 0.44, zf - 0.05));
        // corona rings
        for (const o of [-1, 1]) {
          const ring = new THREE.TorusGeometry(H * 0.055, H * 0.011, 6, 16);
          ring.translate(s * hw * (0.55 + o * 0.14), y, zf - 0.03);
          bucket.light.push(ring);
        }
        bucket.dark.push(box(hw * 0.44, H * 0.115, 0.09, s * hw * 0.55, y, zf - 0.06));
      }
      break;
    }
    case 'singleframe': {  // one big hexagonal frame, slim laser LEDs
      bucket.grille.push(box(hw * 1.05, H * 0.26, 0.11, 0, H * 0.41, zf - 0.03));
      bucket.chrome.push(box(hw * 1.10, H * 0.285, 0.045, 0, H * 0.41, zf - 0.06));
      for (const s of [-1, 1]) {
        bucket.light.push(box(hw * 0.50, H * 0.055, 0.08, s * hw * 0.60, y, zf - 0.04));
        bucket.dark.push(box(hw * 0.52, H * 0.085, 0.09, s * hw * 0.60, y - H * 0.012, zf - 0.07));
        bucket.grille.push(box(hw * 0.34, H * 0.10, 0.09, s * hw * 0.62, H * 0.26, zf - 0.04));
      }
      break;
    }
    case 'star': {   // wide diamond grille with a centre badge
      bucket.grille.push(box(hw * 1.30, H * 0.24, 0.10, 0, H * 0.43, zf - 0.03));
      bucket.chrome.push(box(hw * 1.34, H * 0.265, 0.04, 0, H * 0.43, zf - 0.055));
      const badge = new THREE.TorusGeometry(H * 0.062, H * 0.012, 6, 18);
      badge.translate(0, H * 0.43, zf - 0.01); bucket.chrome.push(badge);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.BoxGeometry(H * 0.010, H * 0.115, 0.02);
        sp.rotateZ(i * Math.PI * 2 / 3);
        sp.translate(0, H * 0.43, zf - 0.012);
        bucket.chrome.push(sp);
      }
      for (const s of [-1, 1]) {
        bucket.light.push(box(hw * 0.46, H * 0.075, 0.08, s * hw * 0.60, y, zf - 0.05));
        bucket.dark.push(box(hw * 0.48, H * 0.105, 0.09, s * hw * 0.60, y, zf - 0.08));
      }
      break;
    }
    case 'roundlamp': {  // no radiator grille at all — four round lamps
      for (const s of [-1, 1]) {
        const l = new THREE.SphereGeometry(H * 0.082, 18, 12);
        l.scale(1, 0.92, 0.55);
        l.rotateX(0.34);
        l.translate(s * hw * 0.645, y, zf - 0.285);
        bucket.light.push(l);
        const inner = new THREE.TorusGeometry(H * 0.086, H * 0.014, 6, 20);
        inner.rotateX(0.34);
        inner.translate(s * hw * 0.645, y, zf - 0.283);
        bucket.dark.push(inner);
        // cooling intakes low down in the apron
        bucket.grille.push(box(hw * 0.46, H * 0.12, 0.10, s * hw * 0.55, H * 0.235, zf - 0.06));
      }
      bucket.grille.push(box(hw * 0.42, H * 0.085, 0.09, 0, H * 0.215, zf - 0.07));
      break;
    }
    default: {   // generic mainstream face
      bucket.grille.push(box(hw * 1.00, H * 0.155, 0.09, 0, H * 0.42, zf - 0.03));
      bucket.chrome.push(box(hw * 1.02, H * 0.05, 0.04, 0, H * 0.485, zf - 0.05));
      for (const s of [-1, 1]) {
        bucket.light.push(box(hw * 0.44, H * 0.085, 0.08, s * hw * 0.58, y, zf - 0.04));
        bucket.dark.push(box(hw * 0.46, H * 0.11, 0.09, s * hw * 0.58, y, zf - 0.07));
      }
    }
  }
  // splitter / lower lip
  bucket.dark.push(box(hw * 1.85, H * 0.055, 0.30, 0, H * 0.135, nose - 0.20));
}

function rearEnd(spec, dims, bucket) {
  const hw = dims.width / 2, H = dims.height, L = dims.length, tail = -L / 2;
  const zr = tail - 0.035;
  const y = spec.tailY * H;
  if (spec.tailStyle === 'bar') {           // full-width light bar
    bucket.tail.push(box(hw * 1.62, H * 0.055, 0.07, 0, y, zr + 0.02));
    for (const s of [-1, 1]) bucket.tail.push(box(hw * 0.42, H * 0.10, 0.09, s * hw * 0.70, y, zr));
  } else if (spec.tailStyle === 'lshape') {  // BMW-ish L graphics
    for (const s of [-1, 1]) {
      bucket.tail.push(box(hw * 0.52, H * 0.075, 0.08, s * hw * 0.62, y, zr));
      bucket.tail.push(box(hw * 0.14, H * 0.135, 0.07, s * hw * 0.86, y - H * 0.03, zr + 0.01));
    }
  } else {
    for (const s of [-1, 1]) bucket.tail.push(box(hw * 0.50, H * 0.095, 0.09, s * hw * 0.62, y, zr));
  }
  bucket.dark.push(box(hw * 1.78, H * 0.10, 0.26, 0, H * 0.185, tail + 0.14));   // diffuser
  // exhausts
  const n = spec.pipes || 2;
  for (let i = 0; i < n; i++) {
    const side = i < n / 2 ? -1 : 1;
    const k = n <= 2 ? 0 : (i % 2 ? 0.5 : -0.5);
    const x = side * hw * (0.62 + k * 0.22);
    bucket.chrome.push(cyl(0.055, 0.055, 0.18, 12, x, H * 0.155, tail + 0.03, 'x'));
    bucket.dark.push(cyl(0.042, 0.042, 0.10, 10, x, H * 0.155, tail + 0.08, 'x'));
  }
  // wing / spoiler
  if (spec.wing === 'ducktail') {
    bucket.paint.push(box(hw * 1.44, H * 0.040, 0.26, 0, H * 0.918, tail + 0.30, -0.19));
    bucket.paint.push(box(hw * 1.40, H * 0.085, 0.09, 0, H * 0.872, tail + 0.19));
  } else if (spec.wing === 'roof') {
    bucket.paint.push(box(hw * 1.50, H * 0.040, 0.30, 0, H * 0.995, tail + 0.28, -0.14));
  } else if (spec.wing === 'lip') {
    bucket.paint.push(box(hw * 1.58, H * 0.032, 0.14, 0, H * 0.735, tail + 0.10, -0.24));
  }
}

function sideDetail(spec, dims, bucket) {
  const hw = dims.width / 2, H = dims.height, L = dims.length;
  const mz = spec.mirrorZ * L - L / 2;
  for (const s of [-1, 1]) {
    bucket.dark.push(box(0.10, 0.035, 0.05, s * hw * 0.98, H * spec.mirrorY, mz));
    bucket.paint.push(box(0.075, 0.055, 0.16, s * (hw + 0.10), H * spec.mirrorY + 0.03, mz, 0, s * 0.16));
    bucket.dark.push(box(0.020, 0.048, 0.135, s * (hw + 0.135), H * spec.mirrorY + 0.03, mz, 0, s * 0.16));
    // door handles
    for (const dz of spec.handles || []) {
      bucket.chrome.push(box(0.035, 0.030, 0.15, s * hw * 0.995, H * (spec.beltAt || 0.70), dz * L - L / 2));
    }
    // sill / side skirt
    bucket.dark.push(box(0.05, H * 0.075, L * 0.42, s * hw * 0.96, H * 0.165, -L * 0.02));
  }
  // interior slab so the cabin is not a hollow shell
  bucket.interior.push(box(dims.width * 0.80, H * 0.16, L * 0.30, 0, H * (spec.beltAt || 0.70) - 0.02, L * 0.02));

  /* Inner arch liners and a floor pan. Without these you look straight
     through the wheel arch and out the other side of the car. */
  for (const [zA, r] of [[spec.axleF, spec.wheelRF], [spec.axleR, spec.wheelRR]]) {
    const a = r * 1.30;
    const liner = new THREE.CylinderGeometry(a * 0.985, a * 0.985, dims.width * 0.90, 16, 1, true, 0, Math.PI);
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
    paints: [{ n: 'Indischrot', c: 0xb0121f }, { n: 'GT-Silber', c: 0xb9bdc0 }, { n: 'Achatgrau', c: 0x4a5157 }],
    perf: { mass: 1640, power: 478, cd: 0.72, vmax: 330, grip: 1.42, awd: true, gears: 8, redline: 7200 },
    blurb: 'Heckmotor, Allrad, 650 PS. Klebt bei 300 noch auf der linken Spur und lässt sich vom Gegenverkehr nicht beeindrucken. Teuerste Art, in Flensburg Punkte zu sammeln.',
  },
  m5: {
    name: 'Bayern M-Sport M5 CS', marque: 'Bayerische Motoren', arch: 'sedan',
    dims: D(5.00, 1.90, 1.47, 0.155),
    axleF: 1.55, axleR: -1.43, trackF: 1.63, trackR: 1.65,
    wheelRF: 0.355, wheelRR: 0.365, wheelWF: 0.275, wheelWR: 0.305,
    spokes: 5, caliper: 'red', face: 'kidney', lightY: 0.55,
    tailStyle: 'lshape', tailY: 0.68, pipes: 4, wing: 'lip',
    mirrorZ: 0.756, mirrorY: 0.735, beltAt: 0.70, handles: [0.44, 0.615],
    plate: 'M BM 5',
    paints: [{ n: 'Marina-Bay-Blau', c: 0x1c56b4 }, { n: 'Frozen Schwarz', c: 0x1a1c1f }, { n: 'Brands-Hatch-Grau', c: 0x6e757b }],
    perf: { mass: 1825, power: 460, cd: 0.78, vmax: 305, grip: 1.34, awd: true, gears: 8, redline: 7000 },
    blurb: 'Vier Türen, Allrad, V8-Biturbo. Der Klassiker der linken Spur: fährt 300 als wäre es 130 und hat Platz für das Gepäck von vier Leuten, die das nicht wollten.',
  },
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
    perf: { mass: 2075, power: 441, cd: 0.86, vmax: 305, grip: 1.38, awd: true, gears: 8, redline: 6800 },
    blurb: 'Der Kombi, der alles gewinnt. Quattro heißt: bei Regen, Rollsplitt und Baustelle immer noch Vollgas. Dafür 2,1 Tonnen, die man in der Kurve merkt.',
  },
  amg: {
    name: 'Affalterbach AMG 63 S', marque: 'Stern aus Stuttgart', arch: 'coupe4',
    dims: D(4.94, 1.90, 1.43, 0.15),
    axleF: 1.52, axleR: -1.34, trackF: 1.62, trackR: 1.64,
    wheelRF: 0.350, wheelRR: 0.365, wheelWF: 0.265, wheelWR: 0.305,
    spokes: 5, caliper: 'red', face: 'star', lightY: 0.55,
    tailStyle: 'lshape', tailY: 0.665, pipes: 4, wing: 'lip',
    mirrorZ: 0.756, mirrorY: 0.725, beltAt: 0.69, handles: [0.44, 0.615],
    plate: 'S MB 63',
    paints: [{ n: 'Selenitgrau', c: 0x5b6066 }, { n: 'Obsidianschwarz', c: 0x191b1e }, { n: 'Hyazinthrot', c: 0x7e1220 }],
    perf: { mass: 1795, power: 375, cd: 0.76, vmax: 315, grip: 1.30, awd: false, gears: 9, redline: 7000 },
    blurb: 'Hinterrad, Handarbeit, Hubraum. Beschleunigt so wie es klingt und will beim Rausbeschleunigen aus der Kurve mitreden. Für Leute, die Gegenlenken für ein Feature halten.',
  },

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
  zivi_limo: {
    name: 'Zivilstreife', arch: 'sedan', dims: D(4.77, 1.83, 1.46, 0.18),
    axleF: 1.46, axleR: -1.34, trackF: 1.58, trackR: 1.57,
    wheelRF: 0.330, wheelRR: 0.330, wheelWF: 0.215, wheelWR: 0.215,
    spokes: 5, rimDark: true, face: 'generic', lightY: 0.56, tailStyle: 'plain', tailY: 0.70,
    ledZ: 0.285, ledY: 0.80,
    pipes: 2, mirrorZ: 0.750, mirrorY: 0.740, beltAt: 0.71, handles: [0.44, 0.615],
    perf: { mass: 1680, power: 206, cd: 0.76, vmax: 265, grip: 1.20, awd: true, gears: 7, redline: 6200 },
  },
  zivi_avant: {
    name: 'Zivilstreife Avant', arch: 'wagon', dims: D(4.94, 1.89, 1.47, 0.18),
    axleF: 1.50, axleR: -1.40, trackF: 1.62, trackR: 1.61,
    wheelRF: 0.340, wheelRR: 0.340, wheelWF: 0.235, wheelWR: 0.235,
    spokes: 5, rimDark: true, face: 'singleframe', lightY: 0.55, tailStyle: 'bar', tailY: 0.69,
    ledZ: 0.055, ledY: 0.865,
    pipes: 2, mirrorZ: 0.744, mirrorY: 0.745, beltAt: 0.715, handles: [0.44, 0.615],
    perf: { mass: 1830, power: 250, cd: 0.80, vmax: 280, grip: 1.24, awd: true, gears: 8, redline: 6400 },
  },
  zivi_kompakt: {
    name: 'Zivilstreife Kompakt', arch: 'sedan', dims: D(4.71, 1.83, 1.44, 0.17),
    axleF: 1.44, axleR: -1.31, trackF: 1.58, trackR: 1.60,
    wheelRF: 0.335, wheelRR: 0.345, wheelWF: 0.225, wheelWR: 0.245,
    spokes: 5, rimDark: true, face: 'kidney', lightY: 0.555, tailStyle: 'lshape', tailY: 0.685,
    ledZ: 0.285, ledY: 0.795,
    pipes: 2, mirrorZ: 0.752, mirrorY: 0.735, beltAt: 0.70, handles: [0.44, 0.615],
    perf: { mass: 1650, power: 280, cd: 0.74, vmax: 290, grip: 1.28, awd: true, gears: 8, redline: 7000 },
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

function bakeCar(id) {
  if (_geoCache.has(id)) return _geoCache.get(id);
  const spec = CARS[id];
  const dims = spec.dims;
  const stations = buildStations(spec.arch, dims, 62, spec);
  const { paint, glass } = loft(stations);

  const bucket = { paint: [], glass: [], dark: [], grille: [], chrome: [], light: [], tail: [], interior: [], liner: [] };
  bucket.paint.push(paint);
  if (glass) bucket.glass.push(glass);
  frontEnd(spec, dims, bucket);
  rearEnd(spec, dims, bucket);
  sideDetail(spec, dims, bucket);

  const out = {};
  for (const k of Object.keys(bucket)) {
    if (!bucket[k].length) continue;
    out[k] = bucket[k].length === 1 ? bucket[k][0] : mergeGeometries(bucket[k]);
  }
  _geoCache.set(id, out);
  return out;
}

/**
 * Build a complete car.
 * opts: { paint, plate, police:{blue:true, led:true}, marked }
 */
export function buildCar(id, opts = {}) {
  const spec = CARS[id];
  const dims = spec.dims;
  const geos = bakeCar(id);
  const g = new THREE.Group();
  g.name = id;

  const paintCol = opts.paint ?? (spec.paints ? spec.paints[0].c : 0x8b9095);
  const paintMat = MAT.make(paintCol, 0.38, 0.21);

  const add = (geo, mat) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
  add(geos.paint, paintMat);
  add(geos.glass, MAT.glass);
  add(geos.interior, MAT.interior);
  add(geos.liner, MAT.liner);
  add(geos.dark, MAT.dark);
  add(geos.grille, MAT.grille);
  add(geos.chrome, MAT.chrome);
  const headMat = MAT.headlight.clone();
  const tailMat = MAT.tail.clone();
  add(geos.light, headMat);
  add(geos.tail, tailMat);

  // ---- wheels
  const wheels = [];
  for (const [front, zAxle, track] of [[true, spec.axleF, spec.trackF], [false, spec.axleR, spec.trackR]]) {
    for (const s of [-1, 1]) {
      const w = buildWheel(spec, front);
      w.position.set(s * track / 2, front ? spec.wheelRF : spec.wheelRR, zAxle);
      w.userData.front = front;
      g.add(w); wheels.push(w);
    }
  }

  // ---- plates
  const plateTxt = opts.plate || spec.plate || 'S AB 81';
  const pw = Math.min(0.52, dims.width * 0.30);
  g.add(plateMesh(plateTxt, pw, 0, 0, dims.height * 0.245, dims.length / 2 + 0.005));
  const rp = plateMesh(plateTxt, pw, 0, 0, dims.height * 0.30, -dims.length / 2 - 0.005, Math.PI);
  g.add(rp);

  // ---- fake contact shadow
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(dims.width * 1.5, dims.length * 1.12), MAT.shadow);
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

  g.userData = {
    id, spec, dims, wheels, blues, led,
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
