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
import { track, N, LENGTH, SECTIONS, BIOME, sectionAt, toWorld, sample } from './track.js';
import { groundTex, tuftTex } from './textures.js';

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
   Lateral distances of each ring, in metres. Which phantom centreline a ring
   follows is a *continuous* function of that distance (below): snapping rings
   to discrete levels steps the ribbon sideways and vertically wherever the
   level changes, which shows up as cliff faces far out and as a ridge in the
   grass right beside the road. */
const RING = [14.5, 19, 26, 40, 62, 95, 150, 250, 430, 820, 1700, 3200];
const US = [...RING.map(d => -d).reverse(), 0, ...RING];

/* lateral distance -> fractional phantom-centreline level */
const LEVEL_AT = [[0, 0], [40, 0], [95, 1], [250, 2], [820, 3], [3200, 4]];
function levelOf(ad) {
  for (let i = 0; i < LEVEL_AT.length - 1; i++) {
    const [d0, l0] = LEVEL_AT[i], [d1, l1] = LEVEL_AT[i + 1];
    if (ad <= d1) return l0 + (l1 - l0) * Math.max(0, (ad - d0) / (d1 - d0));
  }
  return LEVEL_AT[LEVEL_AT.length - 1][1];
}

/** Ring position on one phantom centreline. */
function ringOn(ii, d, lv) {
  const S = SM[lv];
  const h = S.h[ii];
  return [S.x[ii] - Math.cos(h) * d, S.y[ii], S.z[ii] + Math.sin(h) * d];
}

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
        const d = US[j];
        const ad = Math.abs(d);
        // blend between the two bracketing phantom centrelines, so the ribbon
        // has no step anywhere across its 6.4 km width
        const L = levelOf(ad);
        const l0 = Math.floor(L), l1 = Math.min(LEVELS.length - 1, l0 + 1);
        const t = L - l0;
        const a = ringOn(ii, d, l0);
        const x = t > 0 ? a[0] + (ringOn(ii, d, l1)[0] - a[0]) * t : a[0];
        const b = t > 0 ? ringOn(ii, d, l1) : a;
        const z = a[2] + (b[2] - a[2]) * t;
        const cy = a[1] + (b[1] - a[1]) * t;
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

/* Bucket size for vegetation instancing. One InstancedMesh spanning all 26 km
   can never be frustum-culled, so its full triangle count is paid every frame;
   splitting it per route segment lets the far ones drop out. */
const VEG_BUCKET = 1800;

export function buildVegetation(rand) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const nBuckets = Math.ceil(LENGTH / VEG_BUCKET);
  const mk = () => Array.from({ length: nBuckets }, () => []);
  const bins = { spruce: mk(), leafy: mk(), bush: mk(), vine: mk() };

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const UP = { x: 0, y: 1, z: 0 };

  for (let s = 20; s < LENGTH - 20; s += 9) {
    const sec = sectionAt(s);
    const b = Math.min(nBuckets - 1, Math.floor(s / VEG_BUCKET));
    const dens = DENSITY[sec.biome] || 30;
    const perStep = (dens / 1000) * 9 * 2;
    const n = Math.floor(perStep) + (rand() < perStep % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const side = rand() < 0.5 ? -1 : 1;
      // well clear of the carriageway, hard shoulder and barrier
      const d = 20 + rand() ** 0.55 * 205;
      const w = toWorld(s + rand() * 9, side * d, p);
      const y = w.y + hillHeight(w.x, w.z, d) - 0.3;
      const scale = 0.65 + rand() * 0.8;
      q.setFromAxisAngle(UP, rand() * 6.28);
      sc.set(scale, scale * (0.85 + rand() * 0.4), scale);
      m4.compose({ x: w.x, y, z: w.z }, q, sc);
      const roll = rand();
      let kind;
      if (sec.biome === BIOME.FOREST) kind = roll < 0.82 ? 'spruce' : 'leafy';
      else if (sec.biome === BIOME.URBAN) kind = roll < 0.35 ? 'spruce' : roll < 0.8 ? 'leafy' : 'bush';
      else if (sec.biome === BIOME.ALB) kind = roll < 0.55 ? 'spruce' : roll < 0.85 ? 'leafy' : 'bush';
      else kind = roll < 0.30 ? 'spruce' : roll < 0.78 ? 'leafy' : 'bush';
      bins[kind][b].push(m4.clone());
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
          q.setFromAxisAngle(UP, 0);
          sc.set(1, 0.85 + rand() * 0.3, 1);
          m4.compose({ x: w.x, y, z: w.z }, q, sc);
          bins.vine[b].push(m4.clone());
        }
      }
    }
  }

  const needle = new THREE.MeshStandardMaterial({ color: 0x2c4a2b, roughness: 0.92, flatShading: true });
  const broad = new THREE.MeshStandardMaterial({ color: 0x466d33, roughness: 0.9, flatShading: true });
  const scrub = new THREE.MeshStandardMaterial({ color: 0x55703a, roughness: 0.95, flatShading: true });
  const vineM = new THREE.MeshStandardMaterial({ color: 0x5d6f3c, roughness: 0.9, flatShading: true });
  const vg = new THREE.BoxGeometry(0.25, 1.6, 0.9); vg.translate(0, 0.8, 0);

  const GEOM = { spruce: spruceGeo(), leafy: leafyGeo(), bush: bushGeo(), vine: vg };
  const MATS = { spruce: needle, leafy: broad, bush: scrub, vine: vineM };
  const counts = {};
  for (const kind of Object.keys(bins)) {
    counts[kind] = 0;
    for (const arr of bins[kind]) {
      if (!arr.length) continue;
      counts[kind] += arr.length;
      const im = new THREE.InstancedMesh(GEOM[kind], MATS[kind], arr.length);
      arr.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  group.userData.counts = counts;
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

/* ============================================================= verge grass
   Cross-billboard tufts along the mown verges and the median.

   Blanket coverage is not affordable: tufts dense enough to read across the
   whole 12 m verge over 26 km is well over a million triangles. This is a
   fringe instead — four narrow bands where the eye actually rests (either side
   of the median barriers, and at the foot of each outer barrier) at ~3.5 tufts
   per metre of route. All of it is bucketed and switched off until the player
   is close, so the ~360 k triangles in the full set never render at once. */
const GRASS_BUCKET = 200;            // metres of route per InstancedMesh
/** Buckets whose centre is further than this from the player stay dark. */
export const GRASS_VIS = 170;
/** Must track the median ribbon's own lift in world.js, or the tufts sink. */
export const MEDIAN_DY = -0.13;

/**
 * Two crossed quads with their base on the ground, each doubled with reversed
 * winding: eight triangles a tuft, all single-sided and all facing up.
 *
 * Two things are going on here, and they are coupled.
 *
 * Every normal points straight up because a crossed billboard's true normals
 * face sideways, which gives each tuft one face square to the sun and one
 * edge-on — a little light-and-dark blob sitting on the verge. Shading a tuft
 * as if it were the ground it grows out of is what makes a scatter of
 * billboards read as grass.
 *
 * But an up-facing normal cannot be combined with side: DoubleSide, because
 * three.js negates the normal for back-facing fragments — so half of every
 * tuft ends up pointing *down*, lit by nothing but the hemisphere's ground
 * colour, and renders very nearly black. That is what made the mid-distance
 * verge read as dark speckles. Hence the reversed duplicate and FrontSide:
 * every fragment that draws is front-facing with the normal it was given.
 */
function tuftGeo() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const front = mergeGeometries([a, b]);
  const back = front.clone();
  const arr = back.getIndex().array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t;
  }
  back.getIndex().needsUpdate = true;
  const g = mergeGeometries([front, back]);
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return g;
}

/**
 * The terrain ribbon's own y at one RING distance, computed exactly as
 * buildTerrain() computes it. Only valid for |d| <= 40, where levelOf() is 0
 * and the ring therefore sits on the real centreline rather than on a blurred
 * phantom one — which is all the verge bands need.
 */
function ringY(s, d, p) {
  const ad = Math.abs(d);
  const w = toWorld(s, d, p);
  return w.y + hillHeight(w.x, w.z, ad) - (ad <= 14.5 ? 0.30 : 0);
}

/**
 * The height of the terrain *as meshed*. The ribbon only has vertices at the
 * RING distances, so between two rings its surface is the straight line
 * between them. Evaluating hillHeight() at the tuft's own lateral distance
 * instead leaves a tuft up to 20 cm off the ground out past 14.5 m — and
 * because hillHeight() returns 0 for ad <= 14.5 while the -0.30 verge drop
 * applies only there, the naive sum also has a 30 cm step at 14.5 that the
 * mesh does not have.
 */
function vergeY(s, u, p) {
  const ad = Math.abs(u), sgn = u < 0 ? -1 : 1;
  let d0 = 0, d1 = RING[0];
  for (let i = 0; i + 1 < RING.length && ad >= RING[i]; i++) { d0 = RING[i]; d1 = RING[i + 1]; }
  const y0 = ringY(s, sgn * d0, p), y1 = ringY(s, sgn * d1, p);
  return y0 + (y1 - y0) * ((ad - d0) / (d1 - d0));
}

/* Verge grass is mown and fertilised by the Autobahnmeisterei, so it stays a
   tidier, brighter green than the biome behind it — but it still picks up the
   season: dusty gold on the Gäu and the Alb, deep and damp in the forest. */
const GRASS_TINT = {
  [BIOME.URBAN]:    [0.92, 0.96, 0.88],
  [BIOME.VINEYARD]: [1.00, 1.00, 0.88],
  [BIOME.FOREST]:   [0.82, 0.94, 0.84],
  [BIOME.FARM]:     [1.04, 1.02, 0.86],
  [BIOME.ALB]:      [1.00, 1.00, 0.88],
  [BIOME.HEGAU]:    [0.94, 1.00, 0.90],
};

/**
 * @param rand     the shared deterministic rng
 * @param blocked  (s, u) => true where paving, a bridge or the tunnel bore
 *                 means no grass may grow. u is signed.
 * Returns a group whose userData.buckets is [{ mesh, x, y, z }] for the cull.
 */
export function buildVergeGrass(rand, blocked = () => false) {
  const group = new THREE.Group();
  group.name = 'vergeGrass';
  const mat = new THREE.MeshStandardMaterial({
    map: tuftTex(),
    /* alphaTest rather than transparent: it writes depth, so it needs no
       sorting against the terrain or against itself, and the mipmaps thin the
       blades out with distance, which is a free LOD. */
    alphaTest: 0.26, transparent: false,
    /* FrontSide, not DoubleSide — see tuftGeo(). */
    side: THREE.FrontSide, roughness: 0.95, metalness: 0,
  });
  const geo = tuftGeo();

  const nBuckets = Math.ceil(LENGTH / GRASS_BUCKET);
  const bins = Array.from({ length: nBuckets }, () => []);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const p = { x: 0, y: 0, z: 0 };
  const UP = { x: 0, y: 1, z: 0 };
  const c3 = new THREE.Color();

  /* Median tufts stand on the median ribbon, which world.js lifts to
     MEDIAN_DY; the outer bands stand on the terrain. Using the terrain height
     for the median would bury them 17 cm. The outer band starts at 12.85 and
     not at the 12.5 m paved edge so that a half-metre billboard cannot cross
     onto the asphalt. */
  /* Weighted toward the barrier line in each band rather than spread evenly.
     Longer grass really does grow where the mower cannot reach — against the
     posts and along the paved edge — and a dense line there reads as a fringe,
     where the same tufts spread over three metres read as a scatter of shrubs.
     The outer band still starts at 12.85 and not at the 12.5 m paved edge so
     that a half-metre billboard cannot cross onto the asphalt. */
  const BANDS = [
    { lo: 0.32, hi: 1.05, per: 0.75, median: true },   // median, against the rail
    { lo: 1.05, hi: 1.92, per: 0.50, median: true },
    { lo: 12.85, hi: 13.95, per: 1.80, median: false }, // verge, at the rail foot
    { lo: 13.95, hi: 16.60, per: 0.95, median: false },
  ];

  for (let s = 4; s < LENGTH - 4; s += 1) {
    const b = Math.min(nBuckets - 1, Math.floor(s / GRASS_BUCKET));
    const tint = GRASS_TINT[sectionAt(s).biome] || GRASS_TINT[BIOME.FARM];
    for (let bi = 0; bi < BANDS.length; bi++) {
      const band = BANDS[bi];
      for (const side of [1, -1]) {
        /* Clump the density rather than spreading it evenly. Grass on a verge
           grows in tussocks with bare ground between them; an even scatter at
           the same instance count reads as individual sprigs stuck onto flat
           green. This costs nothing — it only moves the same tufts around. */
        const seed = bi * 7.3 + (side > 0 ? 0 : 41.5);
        /* Two octaves: the slow one (~20 m) thins the verge out in stretches,
           the fast one (~7 m) breaks what is left into individual tussocks.
           Both are deliberately short-period — at a 45 m wavelength the gaps
           come out longer than the visible verge, and whether there is any
           grass beside the car at all becomes a coin toss. */
        const cl = vnoise(s * 0.30, seed) * 0.5 + vnoise(s * 0.95, seed + 3.1) * 0.5;
        const dens = band.per * Math.max(0, cl - 0.30) * 3.3;
        const n = Math.floor(dens) + (rand() < dens % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          /* tight lateral spread within a tussock, not across the whole band */
          const u = side * (band.lo + rand() ** 0.8 * (band.hi - band.lo));
          const ss = s + rand();
          if (blocked(ss, u)) continue;
          const w = toWorld(ss, u, p);
          const y = band.median ? w.y + MEDIAN_DY : vergeY(ss, u, p);
          /* Wide and low. A tuft taller than it is broad is a shrub. */
          const wide = 0.36 + rand() * 0.28;
          q.setFromAxisAngle(UP, rand() * 6.283);
          sc.set(wide, 0.16 + rand() ** 1.5 * 0.22, wide);
          m4.compose({ x: w.x, y, z: w.z }, q, sc);
          const v = 0.88 + rand() * 0.22;
          c3.setRGB(tint[0] * v, tint[1] * v, tint[2] * v);
          bins[b].push([m4.clone(), c3.clone()]);
        }
      }
    }
  }

  const buckets = [];
  let total = 0;
  for (const arr of bins) {
    if (!arr.length) continue;
    total += arr.length;
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach(([m, c], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    /* Off until update() says otherwise. Without this every bucket draws on
       the first frame, which is the whole set in one go. */
    im.visible = false;
    im.name = 'vergeGrass';
    const c = im.boundingSphere.center;
    buckets.push({ mesh: im, x: c.x, y: c.y, z: c.z });
    group.add(im);
  }
  group.userData.buckets = buckets;
  group.userData.tufts = total;
  return group;
}

export { hillHeight };
