/* ==========================================================================
   world.js — the built road: carriageways, markings, barriers, signage,
   the Engelbergtunnel, overbridges, the Baustelle at Empfingen and the
   Raststätte Neckarburg.

   Everything is generated in 512 m chunks so the frustum can throw most of it
   away, and merged down to a handful of meshes per chunk.
   ========================================================================== */
import * as THREE from 'three';
import { SEG, LENGTH, SECTIONS, GEO, BIOME, sample, sectionAt, rng } from './track.js';
import {
  asphaltTex, skyTex, facadeTex, signLimit, signEndAll, signAdvice,
  signAusfahrt, signGantry, signRast, signBaustelle, signKm, signTunnel,
} from './textures.js';
import { buildTerrain, buildVegetation, buildLandmarks } from './scenery.js';

const CHUNK = 512;                    // metres per road chunk
const CROSSFALL = 0.025;              // 2.5 %, drains to the outside

/* ------------------------------------------------------------- mesh helper */
class Mesher {
  constructor() { this.p = []; this.uv = []; this.idx = []; this.n = 0; }
  /** a,b,c,d are [x,y,z] in winding order; uv is [u0,v0,u1,v1] corners */
  quad(a, b, c, d, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    const i = this.n;
    this.p.push(...a, ...b, ...c, ...d);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.n += 4;
  }
  get empty() { return this.n === 0; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** Point on the road surface at (s,u), including crossfall. */
function roadPt(s, u) {
  const c = sample(s);
  const rx = -Math.cos(c.head), rz = Math.sin(c.head);
  const cross = -Math.max(0, Math.abs(u) - GEO.medianHalf) * CROSSFALL;
  return [c.x + rx * u, c.y + cross, c.z + rz * u];
}
function lift(p, dy) { return [p[0], p[1] + dy, p[2]]; }

/**
 * Emit one horizontal ribbon quad between arc lengths s..s2 and lateral
 * u1..u2, always wound so the face normal points up. Getting this wrong
 * silently swallows the lane markings, so it lives in exactly one place.
 */
function ribbon(m, s, s2, u1, u2, dy = 0, vScale = 0, uRep = 1) {
  const a = lift(roadPt(s, u1), dy), b = lift(roadPt(s, u2), dy);
  const c = lift(roadPt(s2, u2), dy), d = lift(roadPt(s2, u1), dy);
  if (u2 > u1) m.quad(a, b, c, d, 0, s * vScale, uRep, s2 * vScale);
  else m.quad(b, a, d, c, 0, s * vScale, uRep, s2 * vScale);
}

/* =============================================================== materials */
function makeMaterials(env) {
  const asph = asphaltTex([1, 1]);
  return {
    asphalt: new THREE.MeshStandardMaterial({ map: asph, roughness: 0.93, metalness: 0.02, envMap: env, envMapIntensity: 0.25 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 }),
    concreteIn: new THREE.MeshStandardMaterial({ color: 0x9d9a95, roughness: 0.9, side: THREE.DoubleSide }),
    median: new THREE.MeshStandardMaterial({ color: 0x5f7245, roughness: 0.96 }),
    markWhite: new THREE.MeshStandardMaterial({
      color: 0xf0efe9, roughness: 0.62, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    markYellow: new THREE.MeshStandardMaterial({
      color: 0xf0c21a, roughness: 0.6, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0xaeb4b9, roughness: 0.58, metalness: 0.32,
      envMap: env, envMapIntensity: 0.9, side: THREE.DoubleSide,
    }),
    postDark: new THREE.MeshStandardMaterial({ color: 0x5a6066, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.8 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    noiseWall: new THREE.MeshStandardMaterial({ map: facadeTex('#9aa093', '#7d8478', 5, 3), roughness: 0.93, side: THREE.DoubleSide }),
    baken: new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.75, side: THREE.DoubleSide }),
    bakenRed: new THREE.MeshStandardMaterial({ color: 0xc41f1f, roughness: 0.75, side: THREE.DoubleSide }),
  };
}

/* ============================================================ sign making */
function signPanel(texObj, widthM) {
  const h = widthM / texObj.aspect;
  const g = new THREE.PlaneGeometry(widthM, h);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: texObj.tex, roughness: 0.55, metalness: 0.0, transparent: true, alphaTest: 0.35,
  }));
  m.userData.h = h;
  return m;
}

/**
 * A verge-mounted sign on one or two galvanised posts.
 * `s` metres along the route, `u` lateral, faces the approaching driver.
 */
function vergeSign(mats, texObj, widthM, s, u, bottom = 1.55) {
  const g = new THREE.Group();
  const panel = signPanel(texObj, widthM);
  panel.position.y = bottom + panel.userData.h / 2;
  g.add(panel);
  const nPosts = widthM > 1.4 ? 2 : 1;
  for (let i = 0; i < nPosts; i++) {
    const x = nPosts === 1 ? 0 : (i - 0.5) * widthM * 0.62;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, bottom + 0.12, 8), mats.steel);
    post.position.set(x, (bottom + 0.12) / 2, -0.05);
    g.add(post);
  }
  const p = roadPt(s, u);
  const c = sample(s);
  g.position.set(p[0], p[1], p[2]);
  g.rotation.y = c.head + Math.PI;
  return g;
}

/** Overhead Vorwegweiser gantry spanning our carriageway. */
function gantry(mats, texObj, widthM, s) {
  const g = new THREE.Group();
  const H = 6.4;
  const panel = signPanel(texObj, widthM);
  panel.position.set(GEO.laneR - 1.0, H - panel.userData.h / 2 - 0.35, 0);
  g.add(panel);
  const span = new THREE.Mesh(new THREE.BoxGeometry(GEO.pavedOut - GEO.pavedIn + 1.4, 0.42, 0.42), mats.steel);
  span.position.set((GEO.pavedIn + GEO.pavedOut) / 2, H, 0);
  g.add(span);
  for (const u of [GEO.pavedIn - 0.3, GEO.pavedOut + 0.6]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, H, 10), mats.steel);
    leg.position.set(u, H / 2, 0);
    g.add(leg);
  }
  const p = roadPt(s, 0);
  const c = sample(s);
  g.position.set(p[0], p[1], p[2]);
  g.rotation.y = c.head + Math.PI;
  // the gantry's local +X must point to the driver's right after the flip
  g.scale.x = -1;
  return g;
}

/* ====================================================== road chunk builder */
/** Stretches of the right-hand verge where the barrier must be left out. */
function barrierGaps() {
  const gaps = [];
  for (const sec of SECTIONS) {
    if (sec.exit) gaps.push([sec.km * 1000 - 80, sec.km * 1000 + 260]);
    if (sec.rest) gaps.push([sec.km * 1000 - 140, sec.km * 1000 + 320]);
  }
  return gaps;
}

function buildRoadChunks(mats) {
  const group = new THREE.Group();
  group.name = 'road';
  const gaps = barrierGaps();
  const gapped = (s) => gaps.some(([a, b]) => s >= a && s <= b);

  for (let c0 = 0; c0 < LENGTH; c0 += CHUNK) {
    const c1 = Math.min(LENGTH, c0 + CHUNK);
    const asph = new Mesher(), med = new Mesher(), markW = new Mesher(), markY = new Mesher();
    const steel = new Mesher(), posts = new Mesher();

    for (let s = c0; s < c1; s += SEG) {
      const s2 = Math.min(LENGTH - 0.01, s + SEG);
      const sec = sectionAt(s);
      const works = !!sec.works;
      const IN = GEO.pavedIn, OUT = GEO.pavedOut;

      // ---- the two carriageways
      ribbon(asph, s, s2, IN, OUT, 0, 1 / 7, 2.7);
      ribbon(asph, s, s2, -IN, -OUT, 0, 1 / 7, 2.7);
      // ---- Mittelstreifen, a shade lower than the carriageway
      ribbon(med, s, s2, -IN, IN, -0.13, 1 / 12, 1);

      // ---- markings. Solid lines follow the curve segment by segment.
      const lines = works
        ? [[2.4, 0.25, false], [5.6, 0.15, true], [8.8, 0.30, false]]
        : [[GEO.pavedIn + 0.5, 0.25, false], [GEO.pavedIn + 0.5 + GEO.laneWidth, 0.15, true], [GEO.kerbOut, 0.30, false]];
      const mesher = works ? markY : markW;
      for (const [off, w, dashed] of lines) {
        if (dashed) continue;
        for (const sign of [1, -1]) {
          const u = sign * off;
          ribbon(mesher, s, s2, u - w / 2, u + w / 2, 0.015);
        }
      }

      // ---- Stahlschutzplanke: two in the median, one on each outer verge
      const rails = [[-1.62, 0.74], [1.62, 0.74], [-(OUT + 0.45), 0.78]];
      if (!gapped(s)) rails.push([OUT + 0.45, 0.78]);
      for (const [u, h] of rails) {
        const a = roadPt(s, u), b = roadPt(s2, u);
        // upper and lower band of the W-beam
        for (const dy of [h, h - 0.30]) {
          steel.quad(lift(a, dy), lift(b, dy), lift(b, dy - 0.20), lift(a, dy - 0.20), 0, 0, 1, 1);
        }
        // post at the start of every segment
        const pw = 0.14;
        const pa = roadPt(s, u - pw / 2), pb = roadPt(s, u + pw / 2);
        posts.quad(lift(pa, h - 0.10), lift(pb, h - 0.10), lift(pb, -0.05), lift(pa, -0.05));
      }
    }

    // ---- dashed Leitlinie: 6 m stroke, 12 m gap (German Autobahn standard)
    for (let s = Math.ceil(c0 / 18) * 18; s < c1; s += 18) {
      const sec = sectionAt(s);
      const off = sec.works ? 5.6 : GEO.pavedIn + 0.5 + GEO.laneWidth;
      const w = sec.works ? 0.15 : 0.15;
      const mesher = sec.works ? markY : markW;
      const e = Math.min(s + 6, LENGTH - 0.01);
      for (const sign of [1, -1]) ribbon(mesher, s, e, sign * off - w / 2, sign * off + w / 2, 0.015);
    }

    const add = (m, mat, name) => {
      if (m.empty) return;
      const mesh = new THREE.Mesh(m.geo(), mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = name === 'asphalt' || name === 'median';
      group.add(mesh);
    };
    add(asph, mats.asphalt, 'asphalt');
    add(med, mats.median, 'median');
    add(markW, mats.markWhite, 'markW');
    add(markY, mats.markYellow, 'markY');
    add(steel, mats.steel, 'steel');
    add(posts, mats.postDark, 'posts');
  }
  return group;
}

/* =========================================================== Leitpfosten */
function buildDelineators(mats) {
  const group = new THREE.Group();
  const n = Math.floor(LENGTH / 50) * 2;
  const postGeo = new THREE.BoxGeometry(0.12, 1.0, 0.06);
  postGeo.translate(0, 0.5, 0);
  const bandGeo = new THREE.BoxGeometry(0.125, 0.16, 0.065);
  bandGeo.translate(0, 0.80, 0);
  const white = new THREE.InstancedMesh(postGeo, mats.white, n);
  const band = new THREE.InstancedMesh(bandGeo, mats.dark, n);
  white.frustumCulled = false; band.frustumCulled = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (let s = 25; s < LENGTH; s += 50) {
    for (const sign of [1, -1]) {
      const u = sign * (GEO.pavedOut + 1.15);
      const p = roadPt(s, u);
      const c = sample(s);
      q.setFromAxisAngle(up, c.head);
      m4.compose({ x: p[0], y: p[1], z: p[2] }, q, one);
      white.setMatrixAt(k, m4); band.setMatrixAt(k, m4);
      k++;
    }
  }
  white.count = k; band.count = k;
  white.instanceMatrix.needsUpdate = true; band.instanceMatrix.needsUpdate = true;
  group.add(white, band);
  return group;
}

/* ================================================================ signage */
function buildSigns(mats) {
  const group = new THREE.Group();
  group.name = 'signs';
  const RIGHT = GEO.pavedOut + 1.9;

  for (let i = 0; i < SECTIONS.length; i++) {
    const sec = SECTIONS[i];
    const s = sec.km * 1000;
    if (s < 120) continue;

    // --- the speed regime at the start of every section
    let tex = null, w = 0.90;
    if (sec.limit == null) tex = sec.advice ? signAdvice(130) : signEndAll();
    else tex = signLimit(sec.limit);
    group.add(vergeSign(mats, tex, w, s, RIGHT, 1.70));
    // repeater on the far carriageway, facing the other way
    const mirror = vergeSign(mats, tex, w, s + 30, -RIGHT, 1.70);
    mirror.rotation.y += Math.PI;
    group.add(mirror);

    // --- a Baustelle gets its warning triangle and a lane-narrowing board
    if (sec.works) {
      group.add(vergeSign(mats, signBaustelle(), 1.05, s - 320, RIGHT, 1.55));
      group.add(vergeSign(mats, signLimit(100), 0.90, s - 500, RIGHT, 1.70));
    }
    // --- exits: advance gantry then the Ausfahrt board
    if (sec.exit) {
      const dests = [sec.exit, i < SECTIONS.length - 2 ? SECTIONS[i + 2].name.split(' ')[0] : 'Singen'];
      group.add(gantry(mats, signGantry(dests, 'A 81'), 6.2, s - 900));
      group.add(vergeSign(mats, signAusfahrt(sec.exit), 3.6, s - 240, RIGHT + 0.3, 2.2));
    }
    if (sec.rest) group.add(vergeSign(mats, signRast('Neckarburg'), 3.2, s - 700, RIGHT + 0.3, 2.2));
    if (sec.tunnel) {
      const end = SECTIONS[i + 1] ? SECTIONS[i + 1].km * 1000 - 120 : s + 1200;
      const len = Math.round((end - s) / 10) * 10;
      group.add(vergeSign(mats, signTunnel('Engelbergtunnel', len), 3.4, s - 260, RIGHT + 0.3, 2.3));
    }
  }

  // --- kilometre plates every 1000 m
  for (let km = 1; km < LENGTH / 1000; km++) {
    group.add(vergeSign(mats, signKm(km), 0.44, km * 1000, GEO.pavedOut + 0.75, 0.85));
  }
  return group;
}

/* ============================================== Engelbergtunnel (one bore) */
function buildTunnel(mats) {
  const group = new THREE.Group();
  group.name = 'tunnel';
  const sec = SECTIONS.find(x => x.tunnel);
  if (!sec) return group;
  const s0 = sec.km * 1000;
  const s1 = SECTIONS[SECTIONS.indexOf(sec) + 1].km * 1000 - 120;

  const shell = new Mesher();
  const RIB = 15;
  const uA = GEO.pavedIn - 0.2, uB = GEO.pavedOut + 1.9;
  const mid = (uA + uB) / 2, halfW = (uB - uA) / 2;
  const HT = 7.6, WALL_H = 2.9, WALL_F = 0.20;
  /* Horseshoe section: near-vertical walls off the road, then the crown.
     A plain semi-ellipse springs at road level and you end up looking at
     daylight over the top of it from the driver's seat. */
  const arcPt = (s, k) => {
    const t = k / (RIB - 1);
    let u, rise;
    if (t < WALL_F) { u = uA; rise = (t / WALL_F) * WALL_H - 0.25; }
    else if (t > 1 - WALL_F) { u = uB; rise = ((1 - t) / WALL_F) * WALL_H - 0.25; }
    else {
      const ang = Math.PI * ((t - WALL_F) / (1 - 2 * WALL_F));
      u = mid - Math.cos(ang) * halfW;
      rise = WALL_H + Math.sin(ang) * (HT - WALL_H);
    }
    const p = roadPt(s, u);
    return [p[0], p[1] + rise, p[2]];
  };
  for (let s = s0; s < s1; s += SEG) {
    const s2 = Math.min(s1, s + SEG);
    for (let k = 0; k < RIB - 1; k++) {
      shell.quad(arcPt(s, k), arcPt(s2, k), arcPt(s2, k + 1), arcPt(s, k + 1),
        k / RIB, s / 9, (k + 1) / RIB, s2 / 9);
    }
  }
  const inner = new THREE.Mesh(shell.geo(), mats.concreteIn);
  inner.name = 'tunnelShell';
  group.add(inner);

  // sodium strip lighting down the crown
  const lampGeo = new THREE.BoxGeometry(0.30, 0.10, 2.2);
  const lamps = new THREE.InstancedMesh(lampGeo, mats.lamp, Math.ceil((s1 - s0) / 14) + 2);
  lamps.frustumCulled = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (let s = s0 + 6; s < s1; s += 14) {
    const p = roadPt(s, mid);
    const c = sample(s);
    q.setFromAxisAngle(up, c.head);
    m4.compose({ x: p[0], y: p[1] + HT - 0.55, z: p[2] }, q, one);
    lamps.setMatrixAt(k++, m4);
  }
  lamps.count = k;
  lamps.instanceMatrix.needsUpdate = true;
  group.add(lamps);

  // concrete portals
  for (const [s, flip] of [[s0, 0], [s1, Math.PI]]) {
    const portal = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry((uB - uA) + 3.4, HT + 3.2, 1.6), mats.concrete);
    frame.position.set(mid, (HT + 3.2) / 2 - 0.6, 0);
    portal.add(frame);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(halfW, halfW, 2.2, 22, 1, true, 0, Math.PI), mats.concreteIn);
    mouth.rotation.z = Math.PI / 2; mouth.rotation.y = Math.PI / 2;
    mouth.position.set(mid, 0, 0);
    mouth.scale.y = HT / halfW;
    portal.add(mouth);
    const p = roadPt(s, 0), c = sample(s);
    portal.position.set(p[0], p[1], p[2]);
    portal.rotation.y = c.head + flip;
    group.add(portal);
  }
  group.userData.range = [s0, s1];
  return group;
}

/* ====================================================== overbridges & misc */
function buildBridges(mats) {
  const group = new THREE.Group();
  for (const f of [0.176, 0.312, 0.419, 0.533, 0.643, 0.774, 0.910]) {
    const s = LENGTH * f;
    const g = new THREE.Group();
    const W = GEO.pavedOut * 2 + 22;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 1.3, 11), mats.concrete);
    deck.position.y = 7.2; g.add(deck);
    for (const dz of [-5.5, 5.5]) {
      const par = new THREE.Mesh(new THREE.BoxGeometry(W, 1.15, 0.4), mats.concrete);
      par.position.set(0, 8.4, dz); g.add(par);
    }
    for (const u of [0, -(GEO.pavedOut + 4.5), GEO.pavedOut + 4.5]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7.2, 3.4), mats.concrete);
      pier.position.set(u, 3.6, 0); g.add(pier);
    }
    const p = roadPt(s, 0), c = sample(s);
    g.position.set(p[0], p[1], p[2]);
    g.rotation.y = c.head;
    group.add(g);
  }
  return group;
}

/** Lärmschutzwand through the built-up sections. */
function buildNoiseWalls(mats) {
  const group = new THREE.Group();
  for (const sec of SECTIONS) {
    if (sec.biome !== BIOME.URBAN) continue;
    const i = SECTIONS.indexOf(sec);
    const s0 = sec.km * 1000 + 60;
    const s1 = (SECTIONS[i + 1] ? SECTIONS[i + 1].km * 1000 : LENGTH) - 60;
    if (sec.tunnel) continue;
    const m = new Mesher();
    for (let s = s0; s < s1; s += SEG) {
      const s2 = Math.min(s1, s + SEG);
      for (const sign of [1, -1]) {
        const u = sign * (GEO.pavedOut + 4.2);
        const a = roadPt(s, u), b = roadPt(s2, u);
        m.quad(lift(a, 3.8), lift(b, 3.8), lift(b, -0.2), lift(a, -0.2), s / 5, 0, s2 / 5, 1);
      }
    }
    if (!m.empty) {
      const mesh = new THREE.Mesh(m.geo(), mats.noiseWall);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}

/** The roadworks at Empfingen: beacons, barrier, works plant. */
function buildRoadworks(mats) {
  const group = new THREE.Group();
  const sec = SECTIONS.find(x => x.works);
  if (!sec) return group;
  const i = SECTIONS.indexOf(sec);
  const s0 = sec.km * 1000, s1 = SECTIONS[i + 1].km * 1000 - 60;

  // Leitbaken — red/white striped boards along the closed shoulder
  const bak = new THREE.Group();
  for (let s = s0; s < s1; s += 14) {
    const p = roadPt(s, 9.9);
    const c = sample(s);
    const g = new THREE.Group();
    for (let b = 0; b < 4; b++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.18), b % 2 ? mats.bakenRed : mats.baken);
      strip.position.set(0, 0.42 + b * 0.19, 0);
      g.add(strip);
    }
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 0.09), mats.dark);
    leg.position.y = 0.22; g.add(leg);
    g.position.set(p[0], p[1], p[2]);
    g.rotation.y = c.head + Math.PI;
    bak.add(g);
  }
  group.add(bak);

  // concrete separator down the closed lane edge
  const barr = new Mesher();
  for (let s = s0; s < s1; s += SEG) {
    const s2 = Math.min(s1, s + SEG);
    const u = 10.6;
    const a = roadPt(s, u), b = roadPt(s2, u);
    barr.quad(lift(a, 0.95), lift(b, 0.95), lift(b, -0.1), lift(a, -0.1), s / 4, 0, s2 / 4, 1);
    barr.quad(lift(b, 0.95), lift(a, 0.95), lift(a, -0.1), lift(b, -0.1), s / 4, 0, s2 / 4, 1);
  }
  const bm = new THREE.Mesh(barr.geo(), mats.concrete);
  bm.matrixAutoUpdate = false;
  group.add(bm);

  // a bit of plant parked behind the barrier
  const yellow = new THREE.MeshStandardMaterial({ color: 0xdca50f, roughness: 0.7, metalness: 0.25 });
  for (const [s, u] of [[s0 + 420, 15.5], [s0 + 900, 14.8], [s0 + 1500, 16.2]]) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 5.2), yellow);
    body.position.y = 1.5; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 1.9), mats.dark);
    cab.position.set(0, 3.1, 1.2); g.add(cab);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 5.0), yellow);
    arm.position.set(0, 3.2, -2.4); arm.rotation.x = -0.5; g.add(arm);
    for (const sx of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 5.4), mats.dark);
      tr.position.set(sx * 1.25, 0.55, 0); g.add(tr);
    }
    const p = roadPt(s, u), c = sample(s);
    g.position.set(p[0], p[1], p[2]);
    g.rotation.y = c.head + 0.2;
    group.add(g);
  }
  return group;
}

/** Raststätte Neckarburg: slip roads, parking apron, filling station, shop. */
function buildRestArea(mats) {
  const group = new THREE.Group();
  const sec = SECTIONS.find(x => x.rest);
  if (!sec) return group;
  const s0 = sec.km * 1000 - 120, s1 = s0 + 420;

  const apron = new Mesher();
  for (let s = s0; s < s1; s += SEG) {
    const s2 = Math.min(s1, s + SEG);
    const t0 = Math.min(1, Math.max(0, (s - s0) / 90)), t1 = Math.min(1, Math.max(0, (s2 - s0) / 90));
    const e0 = Math.min(1, Math.max(0, (s1 - s) / 90)), e1 = Math.min(1, Math.max(0, (s1 - s2) / 90));
    const w0 = 12.5 + 34 * Math.min(t0, e0), w1 = 12.5 + 34 * Math.min(t1, e1);
    const a = roadPt(s, 12.5), b = roadPt(s2, 12.5);
    const cc = roadPt(s2, w1), d = roadPt(s, w0);
    apron.quad(a, d, cc, b, 0, s / 8, 3, s2 / 8);
  }
  const am = new THREE.Mesh(apron.geo(), mats.asphalt);
  am.matrixAutoUpdate = false; am.receiveShadow = true;
  group.add(am);

  // shop + fuel canopy
  const shopWall = facadeTex('#e8e6e0', '#3a4a58', 1, 8);
  const shop = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(26, 6.5, 14), new THREE.MeshStandardMaterial({ map: shopWall, roughness: 0.8 }));
  b.position.y = 3.25; shop.add(b);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(27.5, 0.6, 15.5), mats.dark);
  roof.position.y = 6.8; shop.add(roof);
  {
    const p = roadPt(s0 + 250, 38), c = sample(s0 + 250);
    shop.position.set(p[0], p[1], p[2]); shop.rotation.y = c.head;
    group.add(shop);
  }
  const canopy = new THREE.Group();
  const cr = new THREE.Mesh(new THREE.BoxGeometry(24, 0.8, 12), mats.white);
  cr.position.y = 5.6; canopy.add(cr);
  for (const dx of [-10, 0, 10]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.6, 8), mats.white);
    col.position.set(dx, 2.8, 0); canopy.add(col);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 1.2), mats.dark);
    pump.position.set(dx, 0.85, 3.2); canopy.add(pump);
  }
  {
    const p = roadPt(s0 + 130, 30), c = sample(s0 + 130);
    canopy.position.set(p[0], p[1], p[2]); canopy.rotation.y = c.head;
    group.add(canopy);
  }
  group.userData.range = [s0, s1];
  return group;
}

/** Diverging slip road at every exit, so the Ausfahrt boards mean something. */
function buildRamps(mats) {
  const group = new THREE.Group();
  for (const sec of SECTIONS) {
    if (!sec.exit) continue;
    const s0 = sec.km * 1000 - 60, s1 = s0 + 300;
    const m = new Mesher();
    for (let s = s0; s < s1; s += SEG) {
      const s2 = Math.min(s1, s + SEG);
      const t0 = (s - s0) / (s1 - s0), t1 = (s2 - s0) / (s1 - s0);
      const o0 = 12.5 + t0 * t0 * 30, o1 = 12.5 + t1 * t1 * 30;
      const w = 5.2;
      const a = roadPt(s, o0 - w), b = roadPt(s2, o1 - w);
      const cc = roadPt(s2, o1), d = roadPt(s, o0);
      m.quad(a, d, cc, b, 0, s / 8, 1.4, s2 / 8);
    }
    const mesh = new THREE.Mesh(m.geo(), mats.asphalt);
    mesh.matrixAutoUpdate = false; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/* ============================================================ entry point */
export function buildWorld(scene, renderer, onProgress = () => {}) {
  // ---- sky, environment and haze
  const sky = skyTex();
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(sky).texture;
  pmrem.dispose();
  scene.background = sky;
  scene.environment = env;
  scene.fog = new THREE.Fog(0xc3d5e2, 500, 3100);

  const hemi = new THREE.HemisphereLight(0xdcecff, 0x5d6247, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.position.set(-520, 640, 780);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const mats = makeMaterials(env);

  onProgress('Fahrbahn');
  const road = buildRoadChunks(mats); scene.add(road);
  onProgress('Leitplanken');
  scene.add(buildDelineators(mats));
  onProgress('Beschilderung');
  const signs = buildSigns(mats); scene.add(signs);
  onProgress('Engelbergtunnel');
  const tunnel = buildTunnel(mats); scene.add(tunnel);
  scene.add(buildBridges(mats));
  scene.add(buildNoiseWalls(mats));
  onProgress('Baustelle Empfingen');
  scene.add(buildRoadworks(mats));
  scene.add(buildRestArea(mats));
  scene.add(buildRamps(mats));
  onProgress('Gelände');
  scene.add(buildTerrain());
  onProgress('Schwarzwald');
  scene.add(buildVegetation(rng));
  onProgress('Wahrzeichen');
  const lm = buildLandmarks(rng, facadeTex);
  scene.add(lm.group);

  const tunnelRange = tunnel.userData.range || [-1, -1];

  return {
    env, sun, mats,
    tunnelRange,
    /** call each frame with the player's arc length */
    update(dt, playerPos) {
      // keep the shadow frustum on the car
      sun.target.position.copy(playerPos);
      sun.position.set(playerPos.x - 260, playerPos.y + 320, playerPos.z + 390);
      for (const t of lm.turbines) t.userData.hub.rotation.z += dt * 0.55;
    },
    inTunnel(s) { return s > tunnelRange[0] && s < tunnelRange[1]; },
  };
}
