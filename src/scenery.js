/* ==========================================================================
   scenery.js — the land the A81 runs through.

   The terrain is one long ribbon following the road, but a ribbon laid out
   along the true centreline folds over itself as soon as its half-width
   exceeds the radius of curvature (~640 m here). So each lateral ring is laid
   out along a *progressively smoothed* phantom centreline: near rings hug
   every bend, far rings are laid along an almost straight line. The mesh stays
   connected, nothing folds, and you get a horizon 3 km away.
   ========================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { track, N, SEG, LENGTH, SECTIONS, BIOME, sectionAt, toWorld, sample } from './track.js';
import { groundTex } from './textures.js';

/* ------------------------------------------------------------ small noise */
/* Integer hash. Must stay inside int32 via Math.imul — plain `*` overflows
   into float territory, which quietly collapses the output range (this once
   made fbm() return 0.04..0.46 instead of 0..1, so every hill offset came out
   negative and the whole landscape went flat). */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {                      // 2-D value noise, smoothstepped
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.3 + 11, y * 2.3 - 7) * 0.28 + vnoise(x * 5.1 - 3, y * 5.1 + 19) * 0.12;

/* ---------------------------------------------- smoothed phantom centrelines
   blur radii in track samples (1 sample = 8 m)                             */
const LEVELS = [0, 26, 110, 320, 760];
const SM = LEVELS.map(() => ({ x: null, z: null, y: null, h: null }));

function boxBlur(src, radius) {
  if (radius === 0) return src.slice();
  const n = src.length, out = new Float32Array(n);
  let acc = 0;
  const w = radius * 2 + 1;
  for (let i = -radius; i <= radius; i++) acc += src[Math.min(n - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) {
    out[i] = acc / w;
    acc -= src[Math.min(n - 1, Math.max(0, i - radius))];
    acc += src[Math.min(n - 1, Math.max(0, i + radius + 1))];
  }
  return out;
}

(function buildPhantoms() {
  LEVELS.forEach((r, l) => {
    SM[l].x = boxBlur(track.x, r);
    SM[l].z = boxBlur(track.z, r);
    SM[l].y = boxBlur(track.y, Math.min(r, 200));
    const h = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2);
      h[i] = Math.atan2(SM[l].x[b] - SM[l].x[a], SM[l].z[b] - SM[l].z[a]);
    }
    SM[l].h = h;
  });
})();

/* --------------------------------------------------------------- the rings
   [ lateral distance in metres, phantom-centreline level ]                 */
const RING = [
  [14.5, 0], [19, 0], [26, 0], [40, 0], [62, 1], [95, 1],
  [150, 2], [250, 2], [430, 3], [820, 3], [1700, 4], [3200, 4],
];
const US = [...RING.map(r => [-r[0], r[1]]).reverse(), [0, 0], ...RING];

/* ---------------------------------------------------------- biome palettes
   Three tints per biome, chosen by a low-frequency noise so the land breaks
   up into the patchwork of fields you actually see from a German motorway. */
const PALETTE = {
  [BIOME.URBAN]:    [0x5e6659, 0x6b7263, 0x4d554a],
  [BIOME.VINEYARD]: [0x66743c, 0x8a8446, 0x5b5238],
  [BIOME.FOREST]:   [0x2a4227, 0x33502e, 0x21351f],
  [BIOME.FARM]:     [0x6d8033, 0xc0aa52, 0x6d5b42],
  [BIOME.ALB]:      [0x62723c, 0x8d8b4c, 0x4d5a36],
  [BIOME.HEGAU]:    [0x57693a, 0x66774a, 0x445431],
};

function hillHeight(x, z, ad) {
  if (ad <= 14.5) return 0;
  const t = ad - 14.5;
  // cut/fill: the verge falls away from the carriageway
  let y = -Math.min(4.0, t * 0.115);
  const ramp = Math.min(1, t / 110) ** 1.15;
  y += (fbm(x / 265, z / 265) - 0.5) * 26 * ramp;
  y += (fbm(x / 92 + 21, z / 92 - 13) - 0.5) * 6.5 * ramp;
  y += (fbm(x / 880 + 5, z / 880 - 5) - 0.5) * 74 * Math.min(1, t / 680) ** 1.2;
  return y;
}

/**
 * Terrain: one chunked ribbon mesh with vertex colours.
 * Returns { group, heightAt }.
 */
export function buildTerrain() {
  const group = new THREE.Group();
  group.name = 'terrain';
  const STEP = 2;                             // every 2nd sample = 16 m
  const ROWS_PER_CHUNK = 34;                  // ~544 m per chunk
  const cols = US.length;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0,
    map: groundTex('#ffffff', '#d2d2d2', 3000, [1, 1]),
  });

  const totalRows = Math.floor((N - 1) / STEP) + 1;
  const c3 = new THREE.Color();

  for (let c0 = 0; c0 < totalRows - 1; c0 += ROWS_PER_CHUNK) {
    const c1 = Math.min(totalRows - 1, c0 + ROWS_PER_CHUNK);
    const rows = c1 - c0 + 1;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) {
      const ii = Math.min(N - 1, (c0 + r) * STEP);
      const sec = SECTIONS[track.sectionIdx[ii]];
      const pal = PALETTE[sec.biome] || PALETTE[BIOME.FARM];
      for (let j = 0; j < cols; j++) {
        const [d, lv] = US[j];
        const cx = SM[lv].x[ii], cz = SM[lv].z[ii], cy = SM[lv].y[ii], h = SM[lv].h[ii];
        const rx = -Math.cos(h), rz = Math.sin(h);
        const x = cx + rx * d, z = cz + rz * d;
        const ad = Math.abs(d);
        const y = cy + hillHeight(x, z, ad) - (ad <= 14.5 ? 0.30 : 0);
        const o = (r * cols + j) * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        uvs[(r * cols + j) * 2] = x / 11;
        uvs[(r * cols + j) * 2 + 1] = z / 11;
        // field patchwork
        const f = fbm(x / 165 + 3, z / 165 - 8);
        let base = pal[f < 0.44 ? 0 : f < 0.63 ? 1 : 2];
        c3.setHex(base);
        const sh = 0.84 + fbm(x / 48, z / 48) * 0.32;
        // the mown verge is a lighter, tidier green than the fields beyond
        const verge = ad < 24 ? 1.10 : 1.0;
        c3.multiplyScalar(sh * verge);
        col[o] = c3.r; col[o + 1] = c3.g; col[o + 2] = c3.b;
      }
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = r * cols + j, b = r * cols + j + 1, cc = (r + 1) * cols + j + 1, d = (r + 1) * cols + j;
        idx.push(a, b, cc, a, cc, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  return group;
}

/* ============================================================ vegetation
   Polyhedron-derived geometries (Icosahedron) come out non-indexed while the
   primitives are indexed; mergeGeometries needs one or the other. */
const flat = (g) => (g.index ? g.toNonIndexed() : g);

function spruceGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3.2, 5);
  trunk.translate(0, 1.6, 0); parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const c = new THREE.ConeGeometry(2.5 - t * 1.35, 6.5 - t * 2.4, 7);
    c.translate(0, 3.4 + i * 3.4, 0);
    parts.push(c);
  }
  return mergeGeometries(parts.map(flat));
}
function leafyGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.19, 0.30, 3.0, 5);
  trunk.translate(0, 1.5, 0); parts.push(trunk);
  for (const [x, y, z, r] of [[0, 5.0, 0, 3.0], [1.5, 4.2, 0.6, 2.0], [-1.3, 4.4, -0.8, 1.9], [0.3, 6.6, -0.4, 1.9]]) {
    const s = new THREE.IcosahedronGeometry(r, 0);
    s.translate(x, y, z); parts.push(s);
  }
  return mergeGeometries(parts.map(flat));
}
function bushGeo() {
  const s = new THREE.IcosahedronGeometry(1.1, 0);
  s.scale(1, 0.72, 1); s.translate(0, 0.8, 0);
  return s;
}

const DENSITY = {          // trees per kilometre, per side
  [BIOME.URBAN]: 26, [BIOME.VINEYARD]: 30, [BIOME.FOREST]: 190,
  [BIOME.FARM]: 22, [BIOME.ALB]: 40, [BIOME.HEGAU]: 70,
};

export function buildVegetation(rand, terrainHeight) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const spruce = [], leafy = [], bush = [], vine = [];

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (let s = 20; s < LENGTH - 20; s += 9) {
    const sec = sectionAt(s);
    const dens = DENSITY[sec.biome] || 30;
    const perStep = (dens / 1000) * 9 * 2;
    let n = Math.floor(perStep) + (rand() < perStep % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const side = rand() < 0.5 ? -1 : 1;
      // keep well clear of the carriageway, hard shoulder and barrier
      const d = 20 + rand() ** 0.55 * 205;
      const u = side * d;
      const w = toWorld(s + rand() * 9, u, p);
      const y = w.y + hillHeight(w.x, w.z, d) - 0.3;
      const scale = 0.65 + rand() * 0.8;
      q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, rand() * 6.28);
      sc.set(scale, scale * (0.85 + rand() * 0.4), scale);
      m4.compose({ x: w.x, y, z: w.z }, q, sc);
      const roll = rand();
      if (sec.biome === BIOME.FOREST) (roll < 0.82 ? spruce : leafy).push(m4.clone());
      else if (sec.biome === BIOME.URBAN) (roll < 0.35 ? spruce : roll < 0.8 ? leafy : bush).push(m4.clone());
      else if (sec.biome === BIOME.ALB) (roll < 0.55 ? spruce : roll < 0.85 ? leafy : bush).push(m4.clone());
      else (roll < 0.30 ? spruce : roll < 0.78 ? leafy : bush).push(m4.clone());
    }
    // vineyard rows on the Neckar slopes
    if (sec.biome === BIOME.VINEYARD && rand() < 0.30) {
      const side = rand() < 0.5 ? -1 : 1;
      const d0 = 45 + rand() * 120;
      const rows = 5 + Math.floor(rand() * 7);
      for (let r = 0; r < rows; r++) {
        for (let t = 0; t < 9; t++) {
          const u = side * (d0 + r * 3.4);
          const w = toWorld(s + t * 2.6, u, p);
          const y = w.y + hillHeight(w.x, w.z, Math.abs(u)) - 0.3;
          q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
          sc.set(1, 0.85 + rand() * 0.3, 1);
          m4.compose({ x: w.x, y, z: w.z }, q, sc);
          vine.push(m4.clone());
        }
      }
    }
  }

  const inst = (geo, mat, arr) => {
    if (!arr.length) return;
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
  };
  const needle = new THREE.MeshStandardMaterial({ color: 0x2c4a2b, roughness: 0.92, flatShading: true });
  const broad = new THREE.MeshStandardMaterial({ color: 0x466d33, roughness: 0.9, flatShading: true });
  const scrub = new THREE.MeshStandardMaterial({ color: 0x55703a, roughness: 0.95, flatShading: true });
  const vineM = new THREE.MeshStandardMaterial({ color: 0x5d6f3c, roughness: 0.9, flatShading: true });

  inst(spruceGeo(), needle, spruce);
  inst(leafyGeo(), broad, leafy);
  inst(bushGeo(), scrub, bush);
  const vg = new THREE.BoxGeometry(0.25, 1.6, 0.9); vg.translate(0, 0.8, 0);
  inst(vg, vineM, vine);

  group.userData.counts = { spruce: spruce.length, leafy: leafy.length, bush: bush.length, vine: vine.length };
  return group;
}

/* ============================================================= landmarks */

/** thyssenkrupp lift test tower, Rottweil — visible for miles from the A81. */
function testTower() {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6d7075, roughness: 0.6, metalness: 0.4 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 15.5, 196, 24, 1, true), concrete);
  shaft.position.y = 98; g.add(shaft);
  const membrane = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.0, 48, 24, 1, true), dark);
  membrane.position.y = 218; g.add(membrane);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(11.6, 11.6, 3, 24), concrete);
  cap.position.y = 243; g.add(cap);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 14.5, 3.2, 24), concrete);
  deck.position.y = 232; g.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 20, 8), dark);
  mast.position.y = 254; g.add(mast);
  return g;
}

/** Wind turbine for the Baar plateau. Blades turn. */
function turbine() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.55 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 3.0, 105, 14, 1, true), white);
  tower.position.y = 52.5; g.add(tower);
  const nac = new THREE.Mesh(new THREE.BoxGeometry(4.0, 3.6, 11), white);
  nac.position.set(0, 106, -1.5); g.add(nac);
  const hub = new THREE.Group();
  hub.position.set(0, 106, 4.5);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.0, 10), white);
  cone.rotation.x = Math.PI / 2; hub.add(cone);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 38, 0.5), white);
    b.geometry.translate(0, 19, 0);
    b.rotation.z = (i / 3) * Math.PI * 2;
    hub.add(b);
  }
  g.add(hub);
  g.userData.hub = hub;
  return g;
}

/** Big industrial hall — Porsche in Zuffenhausen, Mercedes at Sindelfingen. */
function factoryHall(w, d, h, wallTex, roofCol = 0x8b9095) {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.75, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
  body.position.y = h / 2; g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.7, d * 1.02), roof);
  top.position.y = h + 0.35; g.add(top);
  for (let i = 0; i < Math.floor(d / 14); i++) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 1.6, 3.4), roof);
    sh.position.set(0, h + 1.4, -d / 2 + 8 + i * 14); g.add(sh);
  }
  return g;
}

/** Village: pitched-roof houses plus a church steeple. */
function village(rand, count) {
  const g = new THREE.Group();
  const wallM = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.9 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x8a4032, roughness: 0.85 });
  for (let i = 0; i < count; i++) {
    const w = 7 + rand() * 5, d = 9 + rand() * 6, h = 5 + rand() * 3;
    const hs = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallM);
    b.position.y = h / 2; hs.add(b);
    const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.60, 3.4, 4), roofM);
    r.rotation.y = Math.PI / 4;
    r.position.y = h + 1.7;
    r.scale.set(1, 1, Math.min(1.25, d / w));
    hs.add(r);
    hs.position.set((rand() - 0.5) * 130, 0, (rand() - 0.5) * 150);
    hs.rotation.y = rand() * 6.28;
    g.add(hs);
  }
  // Kirche
  const t = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 22, 6), wallM);
  tower.position.y = 11; t.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.6, 13, 4), roofM);
  spire.position.y = 28.5; spire.rotation.y = Math.PI / 4; t.add(spire);
  const nave = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 20), wallM);
  nave.position.set(0, 4.5, -13); t.add(nave);
  t.position.set((rand() - 0.5) * 60, 0, (rand() - 0.5) * 60);
  g.add(t);
  return g;
}

/** A steep Hegau volcanic cone with woodland on top. */
function hegauCone(h, r) {
  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: 0x6a6f5c, roughness: 0.95, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x33512e, roughness: 0.93, flatShading: true });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 11, 3), rock);
  cone.position.y = h / 2; g.add(cone);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, h * 0.42, 11, 2), wood);
  cap.position.y = h * 0.80; g.add(cap);
  return g;
}

/**
 * Everything that is placed once, at a named spot on the route.
 * Returns { group, turbines } — turbines get their blades spun each frame.
 */
export function buildLandmarks(rand, facadeTex) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const turbines = [];
  const p = new THREE.Vector3();

  const put = (obj, s, u, rotOffset = 0) => {
    const w = toWorld(s, u, p);
    const c = sample(s);
    obj.position.set(w.x, w.y + hillHeight(w.x, w.z, Math.abs(u)) - 0.3, w.z);
    obj.rotation.y = c.head + rotOffset;
    group.add(obj);
    return obj;
  };

  // positions are taken from the section table so they survive any STAGE_KM
  const at = (pred, off = 0) => {
    const sec = SECTIONS.find(pred);
    return sec ? sec.km * 1000 + off : null;
  };
  const F = (frac) => LENGTH * frac;

  // Porsche-Werk Zuffenhausen, right at the start
  put(factoryHall(74, 128, 17, facadeTex('#c9ccd0', '#2c3a48', 3, 14), 0x9aa0a6), F(0.017), 190, 0.25);
  put(factoryHall(52, 84, 13, facadeTex('#d2d4d6', '#2c3a48', 2, 10), 0x9aa0a6), F(0.030), -205, -0.4);
  // Mercedes-Benz Werk Sindelfingen
  const sindel = at(s => s.name.startsWith('Sindelfingen')) ?? F(0.20);
  put(factoryHall(96, 190, 21, facadeTex('#cfd2d5', '#26323d', 4, 18), 0x8f959b), sindel + 240, 235, 0.15);
  put(factoryHall(62, 110, 15, facadeTex('#c7cacd', '#26323d', 3, 12), 0x8f959b), sindel + 900, -250, -0.2);

  // villages in the Gäu and the Neckar valley
  for (const [f, u] of [[0.305, 300], [0.390, -320], [0.467, 280], [0.648, -300], [0.836, 320], [0.955, -280]]) {
    put(village(rand, 9 + Math.floor(rand() * 8)), F(f), u);
  }

  // the thyssenkrupp test tower at Rottweil — you really can see it for miles
  const rottweil = at(s => s.tower) ?? F(0.74);
  put(testTower(), rottweil + 300, 430);

  // wind farm on the Baar plateau
  const baar = at(s => s.biome === BIOME.ALB) ?? F(0.78);
  for (const [d, u] of [[2200, 380], [2800, 520], [3600, 300], [4400, 560], [5200, 340], [6000, 620], [6700, 400]]) {
    const s = Math.min(LENGTH - 400, baar + d * (LENGTH / 42000));
    turbines.push(put(turbine(), s, u));
  }

  // Hegau volcanic cones on the run down to Singen
  const hegau = SECTIONS.filter(s => s.biome === BIOME.HEGAU)[0];
  const h0 = hegau ? hegau.km * 1000 : F(0.93);
  for (const [d, u, h, r] of [[400, 620, 170, 260], [1200, -520, 140, 210], [2000, 700, 190, 300], [1700, -760, 120, 190]]) {
    put(hegauCone(h, r), Math.min(LENGTH - 120, h0 + d * (LENGTH / 42000)), u);
  }

  return { group, turbines };
}

export { hillHeight };
