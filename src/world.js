/* ==========================================================================
   world.js — the built road: carriageways, markings, barriers, signage,
   the Engelbergtunnel, overbridges, the Baustelle at Empfingen and the
   Raststätte Neckarburg.

   Everything is generated in 512 m chunks so the frustum can throw most of it
   away, and merged down to a handful of meshes per chunk.
   ========================================================================== */
import * as THREE from 'three';
import {
  SEG, LENGTH, SECTIONS, GEO, BIOME, sample, sectionAt, rng,
  ENTRY_LEN, entryRamp, outerBarrier,
} from './track.js';
import {
  asphaltTex, asphaltNormalTex, asphaltRoughTex,
  markingTex, markingNormalTex, markingRoughTex,
  railTex, railNormalTex, W_BEAM, BEAM_V, POST_V,
  grassTex, grassNormalTex, concreteTex, concreteNormalTex,
  noiseWallTex, noiseWallNormalTex, tunnelLiningTex,
  skyTex, facadeTex, signLimit, signEndAll, signAdvice,
  signAusfahrt, signGantry, signRast, signBaustelle, signKm, signTunnel,
} from './textures.js';
import {
  buildTerrain, buildVegetation, buildLandmarks, buildVergeGrass,
  GRASS_VIS, MEDIAN_DY,
} from './scenery.js';

const CHUNK = 512;                    // metres per road chunk
/** True where the entry slip road still has usable width. */
const rampAt = (s) => { const e = entryRamp(s); return !!e && e.width > 0.5; };
/* Where the sun sits relative to the car. Late-afternoon, over your shoulder. */
const SUN_OFFSET = new THREE.Vector3(-165, 225, 250);
const CROSSFALL = 0.025;              // 2.5 %, drains to the outside
/** Overbridges, as fractions of the route. Shared with the verge blocker. */
const BRIDGE_AT = [0.176, 0.312, 0.419, 0.533, 0.643, 0.774, 0.910];

/* ------------------------------------------------------------- mesh helper */
class Mesher {
  constructor() { this.p = []; this.uv = []; this.idx = []; this.col = null; this.n = 0; }
  /** a,b,c,d are [x,y,z] in winding order; uv is [u0,v0,u1,v1] corners */
  quad(a, b, c, d, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    const i = this.n;
    this.p.push(...a, ...b, ...c, ...d);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.n += 4;
  }
  /**
   * As quad(), plus one rgb triple per corner. The first call switches the
   * mesh to vertex colours; geo() back-fills white for anything emitted
   * without them, so the two calls can be mixed on one mesher.
   */
  quadC(a, b, c, d, u0, v0, u1, v1, ca, cb, cc, cd) {
    if (!this.col) this.col = [];
    while (this.col.length < this.n * 3) this.col.push(1);
    this.quad(a, b, c, d, u0, v0, u1, v1);
    this.col.push(...ca, ...cb, ...cc, ...cd);
  }
  get empty() { return this.n === 0; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) {
      while (this.col.length < this.n * 3) this.col.push(1);
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    }
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/* Integer hash for the spatial variation baked into vertex colours. Kept in
   int32 with Math.imul — a plain `*` overflows and collapses the range. */
function hash1(i, j) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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

/**
 * ribbon() with a per-corner tint from `tint(s,u)`. The colours have to follow
 * the winding flip, not the argument order, or the shading mirrors itself on
 * the oncoming carriageway.
 */
function ribbonC(m, s, s2, u1, u2, dy, vScale, uRep, tint) {
  const a = lift(roadPt(s, u1), dy), b = lift(roadPt(s, u2), dy);
  const c = lift(roadPt(s2, u2), dy), d = lift(roadPt(s2, u1), dy);
  const ca = tint(s, u1), cb = tint(s, u2), cc = tint(s2, u2), cd = tint(s2, u1);
  if (u2 > u1) m.quadC(a, b, c, d, 0, s * vScale, uRep, s2 * vScale, ca, cb, cc, cd);
  else m.quadC(b, a, d, c, 0, s * vScale, uRep, s2 * vScale, cb, ca, cd, cc);
}

/**
 * The four vertical sides of a prism through the horizontal corners `pts`
 * (each [x,y,z]), from `yBot` to `yTop` relative to each corner's own y — so
 * a post standing on the crossfall stays planted. The loop is re-wound to
 * counter-clockwise in xz so the normals come out facing outward whichever
 * order the corners arrived in.
 */
function prismSides(m, pts, yBot, yTop, u0, v0, u1, v1) {
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a2 += p[0] * q[2] - q[0] * p[2];
  }
  const loop = a2 > 0 ? pts : pts.slice().reverse();
  for (let i = 0; i < loop.length; i++) {
    const A = loop[i], B = loop[(i + 1) % loop.length];
    m.quad([A[0], A[1] + yTop, A[2]], [B[0], B[1] + yTop, B[2]],
      [B[0], B[1] + yBot, B[2]], [A[0], A[1] + yBot, A[2]], u0, v0, u1, v1);
  }
}

/* ------------------------------------------------------- carriageway tints
   Lateral cut lines across one carriageway. The extra lines bracket the four
   wheel tracks; everything else just gives the vertex colours somewhere to
   land. They exist because the asphalt UV repeats 2.7× across the width, so
   anything lateral drawn into the tiling texture would come out 2.7 times
   over — the wheel tracks, the repairs and the pale hard shoulder have to be
   geometry and vertex colour, not texture. */
const LANE_CUTS = [
  2.00, 2.50, 3.26, 3.60, 3.94, 4.81, 5.15, 5.49,
  6.25, 7.01, 7.35, 7.69, 8.56, 8.90, 9.24, 10.00, 11.25, 12.50,
];
const TRACKS = [3.60, 5.15, 7.35, 8.90];   // wheel-track centres
const isTrack = (mid) => TRACKS.some(t => Math.abs(mid - t) < 0.30);

function asphaltTone(s, u) {
  const au = Math.abs(u);
  let k = 1;
  let dmin = 9;
  for (const t of TRACKS) dmin = Math.min(dmin, Math.abs(au - t));
  const pol = Math.max(0, 1 - dmin / 0.52);           // polished, so darker
  k *= 1 - 0.155 * pol * pol * (3 - 2 * pol);
  if (au > 10) k *= 1 + 0.14 * Math.min(1, (au - 10) / 1.7);   // dusty shoulder
  k *= 0.93 + 0.14 * hash1(Math.floor(s / 41), Math.floor(au / 2.7));
  k *= 0.975 + 0.05 * hash1(Math.floor(s / 13) + 601, Math.floor(au * 1.7));
  return [k, k, k * 1.01];
}

/* V scale for the lane markings: one tile of markingTex per 2 m, which is what
   the bead grain and the chipped edges in that texture were drawn for. The old
   call sites left vScale at its default of 0, which made V degenerate — the
   marking then sampled a single stretched row of the texture. */
const MARK_V = 1 / 2;
/* Tar-band seams and machine-laid patches share mats.asphaltDark and are told
   apart purely by vertex tint, so both are one draw call per chunk. A seam is
   near-black bitumen; a patch is newer, slightly finer asphalt, so it is only a
   little darker than the surface around it and very slightly bluer. */
const SEAM_TINT = (s, u) => {
  const k = 0.28 + 0.06 * hash1(Math.floor(s / 3), Math.floor(u * 2));
  return [k, k, k * 1.04];
};
const PATCH_TINT = (s, u) => {
  const k = 0.80 + 0.10 * hash1(Math.floor(s / 5) + 91, Math.floor(u));
  return [k, k, k * 1.03];
};

/* =============================================================== materials */
function makeMaterials(env) {
  const asph = asphaltTex([1, 1]);
  const asphN = asphaltNormalTex([3, 3]);
  const asphR = asphaltRoughTex([3, 3]);
  const surface = (extra) => new THREE.MeshStandardMaterial({
    map: asph, normalMap: asphN, roughnessMap: asphR,
    roughness: 1, metalness: 0.02, envMap: env, envMapIntensity: 0.3, ...extra,
  });
  const markMaps = {
    map: markingTex(), normalMap: markingNormalTex(), roughnessMap: markingRoughTex(),
    normalScale: new THREE.Vector2(0.7, 0.7),
  };
  const grass = grassTex([1, 1]);
  return {
    asphalt: surface({ vertexColors: true }),
    /* Same surface without vertex colours, for the slip roads and the rest-area
       apron. Those are built with plain quad() and so carry no colour
       attribute; on a `vertexColors: true` material WebGL then supplies the
       default attribute (0,0,0) and the whole surface renders black. */
    asphaltPlain: surface({}),
    /* The wheel tracks are their own material: 25 years of tyres polish the
       binder, so they are darker *and* glossier than the surface either side.
       Costs one extra draw call per chunk and does most of the work of making
       the road look like it has been used. */
    asphaltPolished: surface({ vertexColors: true, roughness: 0.72, envMapIntensity: 0.55 }),
    /** Tar-band seams and machine-laid repairs, tinted by vertex colour. */
    asphaltDark: surface({
      vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    concrete: new THREE.MeshStandardMaterial({
      map: concreteTex([2, 1]), normalMap: concreteNormalTex([2, 1]), roughness: 0.92,
    }),
    tunnelLining: new THREE.MeshStandardMaterial({
      map: tunnelLiningTex(), normalMap: concreteNormalTex([9, 3]),
      color: 0xa8a5a0, roughness: 0.9, side: THREE.DoubleSide,
    }),
    concreteBoth: new THREE.MeshStandardMaterial({
      map: concreteTex([3, 3]), normalMap: concreteNormalTex([3, 3]),
      color: 0xb8b4ac, roughness: 0.9, side: THREE.DoubleSide,
    }),
    barrier: new THREE.MeshStandardMaterial({
      map: concreteTex([1, 2]), normalMap: concreteNormalTex([2, 4]), roughness: 0.92,
    }),
    median: new THREE.MeshStandardMaterial({
      color: 0x5f7245, map: grass, normalMap: grassNormalTex([3, 3]),
      vertexColors: true, roughness: 0.96, metalness: 0,
    }),
    markWhite: new THREE.MeshStandardMaterial({
      ...markMaps, color: 0xf6f5ef, roughness: 0.62, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    markYellow: new THREE.MeshStandardMaterial({
      ...markMaps, color: 0xf2c419, roughness: 0.6, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    /** Stahlschutzplanke: beam and post share one atlas, so one draw call. */
    rail: new THREE.MeshStandardMaterial({
      map: railTex(), normalMap: railNormalTex(),
      roughness: 0.52, metalness: 0.42, envMap: env, envMapIntensity: 1.0,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0xaeb4b9, roughness: 0.58, metalness: 0.32,
      envMap: env, envMapIntensity: 0.9, side: THREE.DoubleSide,
    }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.8 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    noiseWall: new THREE.MeshStandardMaterial({
      map: noiseWallTex(), normalMap: noiseWallNormalTex(),
      roughness: 0.93, side: THREE.DoubleSide,
    }),
    wallPost: new THREE.MeshStandardMaterial({
      color: 0x74797d, roughness: 0.62, metalness: 0.35, envMap: env, envMapIntensity: 0.7,
    }),
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
  const gaps = [[-20, ENTRY_LEN + 50]];      // the Auffahrt at Zuffenhausen
  for (const sec of SECTIONS) {
    if (sec.exit) gaps.push([sec.km * 1000 - 80, sec.km * 1000 + 260]);
    if (sec.rest) gaps.push([sec.km * 1000 - 140, sec.km * 1000 + 320]);
  }
  return gaps;
}

/**
 * Where verge grass must not grow. Rectangles of [s0, s1, u0, u1] on *signed*
 * u, because almost everything that paves the verge — slip roads, the rest
 * area, the Baustelle, the tunnel bore — is on our side only.
 *
 * Grass poking up through paving is the failure mode to watch: the entry ramp
 * is lifted only 7 cm while the flat mown verge sits 3.75 cm below the road
 * edge, so at u ~ 14 a 30 cm tuft rooted on the verge would stand 23 cm
 * through the tarmac. Hence the generous first rectangle.
 */
function vergeBlocker() {
  const r = [[-10, ENTRY_LEN + 120, 9, 60]];              // the Auffahrt
  for (const sec of SECTIONS) {
    const i = SECTIONS.indexOf(sec);
    const s = sec.km * 1000;
    const next = SECTIONS[i + 1] ? SECTIONS[i + 1].km * 1000 : LENGTH;
    if (sec.exit && i > 0) r.push([s - 90, s + 330, 9, 60]);
    if (sec.rest) r.push([s - 170, s + 340, 9, 70]);
    if (sec.works) r.push([s - 40, next - 20, 8.5, 22]);
    /* The bore covers u 1.8..14.4 — our carriageway only — so this kills the
       median and the right verge inside it and deliberately leaves the
       oncoming carriageway's outer verge, which is out in open ground. */
    if (sec.tunnel) r.push([s - 12, next - 120 + 12, -2.5, 20]);
  }
  for (const f of BRIDGE_AT) {
    const s = LENGTH * f;
    r.push([s - 8, s + 8, -60, 60]);
  }
  return (s, u) => r.some(([a, b, c, d]) => s >= a && s <= b && u >= c && u <= d);
}

/* ------------------------------------------------------- Stahlschutzplanke
   Profil A W-beam on Sigma posts. The old barrier was two flat 0.20 m
   DoubleSide quads, which from the driver's seat projected as three enormous
   pale ribbons across the left half of the screen — the single worst thing in
   the frame. This is the real pressed section instead: nine quads round a
   closed profile, with the bolts, the galvanising and the grime in the
   texture rather than in geometry. */
const BEAM_MID = 0.1555;              // beam centre below the top of the rail
const POST_PITCH = 4;                 // Sigma posts every 4 m, as built

/**
 * One segment of beam. `face` is the lateral direction the pressing bulges
 * in — toward the traffic it protects.
 *
 * W_BEAM traverses the (depth, height) plane clockwise, so with
 * T × R = −up and T × up = R the natural corner order comes out facing
 * outward only for face = −1; for face = +1 the quad has to be reversed,
 * which also swaps the V pair because quad() maps corners to UVs by position.
 */
function railRun(m, s, s2, u, top, face) {
  const cy = top - BEAM_MID;
  const pt = (ss, k, depth) => {
    const p = roadPt(ss, u + face * (depth ?? W_BEAM[k][0]));
    return [p[0], p[1] + cy + W_BEAM[k][1], p[2]];
  };
  const U0 = s / POST_PITCH, U1 = s2 / POST_PITCH;
  const emit = (k0, k1, d0, d1, v0, v1) => {
    const a = pt(s, k0, d0), b = pt(s2, k0, d0), c = pt(s2, k1, d1), d = pt(s, k1, d1);
    if (face > 0) m.quad(d, c, b, a, U0, v1, U1, v0);
    else m.quad(a, b, c, d, U0, v0, U1, v1);
  };
  for (let k = 0; k < W_BEAM.length - 1; k++) emit(k, k + 1, null, null, BEAM_V[k], BEAM_V[k + 1]);
  // closing back plate: bottom lip straight up to the top lip, at depth 0
  emit(W_BEAM.length - 1, 0, 0, 0, BEAM_V[W_BEAM.length - 1], BEAM_V[W_BEAM.length]);
}

/** The post under the beam, sitting 12 mm behind the back plate. */
function railPost(m, s, u, top, face) {
  const cy = top - BEAM_MID;
  const HW = 0.062, D_F = -0.012, D_B = -0.105;
  const pts = [
    roadPt(s - HW, u + face * D_F), roadPt(s + HW, u + face * D_F),
    roadPt(s + HW, u + face * D_B), roadPt(s - HW, u + face * D_B),
  ];
  prismSides(m, pts, -0.17, cy + 0.10, 0, POST_V[0], 1, POST_V[1]);
}

function buildRoadChunks(mats) {
  const group = new THREE.Group();
  group.name = 'road';
  const gaps = barrierGaps();
  const gapped = (s) => gaps.some(([a, b]) => s >= a && s <= b);
  const OUT = GEO.pavedOut;
  /** [lateral, top of beam, direction the pressing faces] */
  const railsAt = (s) => {
    const r = [[-1.62, 0.75, -1], [1.62, 0.75, 1], [-(OUT + 0.45), 0.78, 1]];
    if (!gapped(s)) r.push([OUT + 0.45, 0.78, -1]);
    return r;
  };
  // Mittelstreifen cuts: a strip either side of each barrier line so the
  // vertex tint can put the barriers' own shade into the grass.
  const MED_CUTS = [-2.0, -1.62, -0.8, 0, 0.8, 1.62, 2.0];
  const medianTone = (s, u) => {
    const d = Math.min(Math.abs(Math.abs(u) - 1.62), 1);
    let k = (0.80 + 0.20 * d) * (0.90 + 0.2 * hash1(Math.floor(s / 17), Math.floor(u * 2) + 40));
    return [k, k * 1.02, k * 0.96];
  };

  for (let c0 = 0; c0 < LENGTH; c0 += CHUNK) {
    const c1 = Math.min(LENGTH, c0 + CHUNK);
    const asph = new Mesher(), pol = new Mesher(), med = new Mesher();
    const markW = new Mesher(), markY = new Mesher();
    const rail = new Mesher(), seam = new Mesher();

    for (let s = c0; s < c1; s += SEG) {
      const s2 = Math.min(LENGTH - 0.01, s + SEG);
      const sec = sectionAt(s);
      const works = !!sec.works;
      const IN = GEO.pavedIn;

      // ---- the two carriageways, cut laterally so the wheel tracks, the
      //      repairs and the pale hard shoulder can be vertex colours
      for (let i = 0; i < LANE_CUTS.length - 1; i++) {
        const a = LANE_CUTS[i], b = LANE_CUTS[i + 1];
        const m = isTrack((a + b) / 2) ? pol : asph;
        const ua = (a - IN) / (OUT - IN) * 2.7, ub = (b - IN) / (OUT - IN) * 2.7;
        for (const sign of [1, -1]) {
          const lo = lift(roadPt(s, sign * a), 0), hi = lift(roadPt(s, sign * b), 0);
          const hi2 = lift(roadPt(s2, sign * b), 0), lo2 = lift(roadPt(s2, sign * a), 0);
          const ca = asphaltTone(s, a), cb = asphaltTone(s, b);
          const cc = asphaltTone(s2, b), cd = asphaltTone(s2, a);
          if (sign > 0) m.quadC(lo, hi, hi2, lo2, ua, s / 7, ub, s2 / 7, ca, cb, cc, cd);
          else m.quadC(hi, lo, lo2, hi2, ua, s / 7, ub, s2 / 7, cb, ca, cd, cc);
        }
      }
      // ---- Mittelstreifen, a shade lower than the carriageway
      for (let i = 0; i < MED_CUTS.length - 1; i++) {
        ribbonC(med, s, s2, MED_CUTS[i], MED_CUTS[i + 1], MEDIAN_DY, 1 / 4, 0.25, medianTone);
      }

      // ---- markings. Solid lines follow the curve segment by segment.
      const lines = works
        ? [[2.4, 0.25, false], [5.6, 0.15, true], [8.8, 0.30, false]]
        : [[GEO.pavedIn + 0.5, 0.25, false], [GEO.pavedIn + 0.5 + GEO.laneWidth, 0.15, true], [GEO.kerbOut, 0.30, false]];
      const mesher = works ? markY : markW;
      for (const [off, w, dashed] of lines) {
        if (dashed) continue;
        for (const sign of [1, -1]) {
          // alongside the acceleration lane this boundary must be crossable,
          // so it is drawn as a broken wide line further down instead
          if (sign > 0 && off === GEO.kerbOut && rampAt(s)) continue;
          const u = sign * off;
          ribbon(mesher, s, s2, u - w / 2, u + w / 2, 0.015, MARK_V, 1);
        }
      }

      // ---- longitudinal paving joint between the two lanes
      for (const sign of [1, -1]) {
        ribbonC(seam, s, s2, sign * 6.25 - 0.035, sign * 6.25 + 0.035, 0.005, 1 / 7, 0.05, SEAM_TINT);
      }

      // ---- Stahlschutzplanke: two in the median, one on each outer verge
      for (const [u, h, face] of railsAt(s)) {
        railRun(rail, s, s2, u, h, face);
        for (let ps = Math.ceil(s / POST_PITCH) * POST_PITCH; ps < s2; ps += POST_PITCH) {
          railPost(rail, ps, u, h, face);
        }
      }
    }

    // ---- dashed Leitlinie: 6 m stroke, 12 m gap (German Autobahn standard)
    for (let s = Math.ceil(c0 / 18) * 18; s < c1; s += 18) {
      const sec = sectionAt(s);
      const off = sec.works ? 5.6 : GEO.pavedIn + 0.5 + GEO.laneWidth;
      const w = sec.works ? 0.15 : 0.15;
      const mesher = sec.works ? markY : markW;
      const e = Math.min(s + 6, LENGTH - 0.01);
      for (const sign of [1, -1]) ribbon(mesher, s, e, sign * off - w / 2, sign * off + w / 2, 0.015, MARK_V, 1);
    }

    // broken wide line between the acceleration lane and the through lanes
    for (let s = Math.ceil(c0 / 12) * 12; s < Math.min(c1, ENTRY_LEN); s += 12) {
      if (!rampAt(s)) continue;
      const e = Math.min(s + 6, ENTRY_LEN, c1);
      if (e <= s) continue;
      ribbon(markW, s, e, GEO.kerbOut - 0.15, GEO.kerbOut + 0.15, 0.022, MARK_V, 1);
    }

    /* ---- day-work joints and machine-laid repairs. Both ride on one dark
       material and are told apart by vertex tint, so the whole lot is a
       single draw call per chunk. */
    for (let s = Math.ceil(c0 / 57) * 57; s < c1; s += 57) {
      if (hash1(Math.floor(s / 57), 7) > 0.45) continue;
      const e = Math.min(s + 0.07, LENGTH - 0.01);
      for (const sign of [1, -1]) {
        ribbonC(seam, s, e, sign * 2.4, sign * 10.1, 0.005, 1 / 7, 2, SEAM_TINT);
      }
    }
    for (let s = Math.ceil(c0 / 61) * 61; s < c1; s += 61) {
      const r = hash1(Math.floor(s / 61) + 13, 29);
      if (r > 0.34) continue;
      const sign = r < 0.17 ? 1 : -1;
      const u0 = 2.9 + hash1(Math.floor(s / 61), 3) * 5.6;
      const w = 1.1 + hash1(Math.floor(s / 61), 5) * 2.2;
      const len = 2.2 + hash1(Math.floor(s / 61), 9) * 5;
      const e = Math.min(s + len, LENGTH - 0.01, c1);
      if (e <= s) continue;
      ribbonC(seam, s, e, sign * u0, sign * Math.min(u0 + w, 9.9), 0.004, 1 / 7, 0.6, PATCH_TINT);
    }

    const add = (m, mat, name) => {
      if (m.empty) return;
      const mesh = new THREE.Mesh(m.geo(), mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = name === 'asphalt' || name === 'median' || name === 'polished';
      group.add(mesh);
    };
    add(asph, mats.asphalt, 'asphalt');
    add(pol, mats.asphaltPolished, 'polished');
    add(seam, mats.asphaltDark, 'seam');
    add(med, mats.median, 'median');
    add(markW, mats.markWhite, 'markW');
    add(markY, mats.markYellow, 'markY');
    add(rail, mats.rail, 'rail');
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
      // on the right the posts sit outside the barrier line, which is pushed
      // out around the Auffahrt — otherwise the ramp runs straight over them
      const u = sign > 0 ? outerBarrier(s) + 0.7 : -(GEO.pavedOut + 1.15);
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
        k / (RIB - 1), s / 9, (k + 1) / (RIB - 1), s2 / 9);
    }
  }
  const inner = new THREE.Mesh(shell.geo(), mats.tunnelLining);
  inner.name = 'tunnelShell';
  group.add(inner);

  /* Concrete verge either side of the carriageway, inside the bore.
     The wall bases sit at uA = 1.8 and uB = 14.4, but the road is only paved
     from 2.0 to 12.5 — so without this you see the median's grass at the foot
     of the left wall and the mown verge at the foot of the right one, inside
     a tunnel. It shows up as soon as the lining is bright enough to see the
     wall base at all.

     The outer edge cannot simply follow roadPt(): the 2.5 % crossfall puts
     u = 14.4 at 31 cm below the centreline, which is *under* the flat verge
     terrain at −30 cm. So the outer edge is lifted to rise away from the road
     the way a real tunnel walkway does, which also keeps the terrain hidden
     along its whole width.

     Corner order follows ribbon(): (s,u1), (s,u2), (s2,u2), (s2,u1) with
     u2 > u1. Written the other way round the face normal points at the ground
     and the strip is simply never drawn — which is what happened first time,
     and is exactly the trap the ribbon() helper exists to centralise. */
  const verge = new Mesher();
  for (let s = s0; s < s1; s += SEG) {
    const s2 = Math.min(s1, s + SEG);
    // right-hand walkway, from the paved edge up to the wall base
    verge.quad(
      roadPt(s, GEO.pavedOut - 0.05), lift(roadPt(s, uB), 0.15),
      lift(roadPt(s2, uB), 0.15), roadPt(s2, GEO.pavedOut - 0.05),
      0, s / 6, 1, s2 / 6);
    // left-hand strip, covering the sliver of median inside the bore
    verge.quad(
      roadPt(s, uA), roadPt(s, GEO.pavedIn + 0.05),
      roadPt(s2, GEO.pavedIn + 0.05), roadPt(s2, uA),
      0, s / 6, 0.3, s2 / 6);
  }
  const vm = new THREE.Mesh(verge.geo(), mats.concrete);
  vm.name = 'tunnelVerge';
  vm.matrixAutoUpdate = false;
  group.add(vm);

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

  /* Concrete portal collars. These used to be a solid slab across the road
     with no hole in it: you drove through a grey wall going in, and on the way
     out it stood between the chase camera and the car. Now each portal is a
     ring following the arch outline, so the mouth is actually open. */
  const collar = new Mesher();
  const CY = HT * 0.42, THICK = 2.3;
  const outward = (s, k) => {
    const t = k / (RIB - 1);
    let u, rise;
    if (t < WALL_F) { u = uA; rise = (t / WALL_F) * WALL_H - 0.25; }
    else if (t > 1 - WALL_F) { u = uB; rise = ((1 - t) / WALL_F) * WALL_H - 0.25; }
    else {
      const ang = Math.PI * ((t - WALL_F) / (1 - 2 * WALL_F));
      u = mid - Math.cos(ang) * halfW;
      rise = WALL_H + Math.sin(ang) * (HT - WALL_H);
    }
    const du = u - mid, dy = rise - CY;
    const len = Math.hypot(du, dy) || 1;
    const p = roadPt(s, u + (du / len) * THICK);
    return [p[0], p[1] + rise + (dy / len) * THICK, p[2]];
  };
  for (const [sp, flip] of [[s0, false], [s1, true]]) {
    for (let k = 0; k < RIB - 1; k++) {
      const a = arcPt(sp, k), b = arcPt(sp, k + 1);
      const oa = outward(sp, k), ob = outward(sp, k + 1);
      if (flip) collar.quad(a, b, ob, oa, 0, 0, 1, 1);
      else collar.quad(a, oa, ob, b, 0, 0, 1, 1);
    }
  }
  const collarMesh = new THREE.Mesh(collar.geo(), mats.concreteBoth);
  collarMesh.matrixAutoUpdate = false;
  group.add(collarMesh);

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
    const s0 = Math.max(sec.km * 1000 + 60, sec === SECTIONS[0] ? ENTRY_LEN + 25 : 0);
    const s1 = (SECTIONS[i + 1] ? SECTIONS[i + 1].km * 1000 : LENGTH) - 60;
    if (sec.tunnel) continue;
    const m = new Mesher(), posts = new Mesher();
    /* U runs at one texture tile per 4 m because that is the bay the precast
       panels, the coping and the weathering streaks were drawn at. At the old
       s/5 the bay joints in the texture did not line up with the posts. */
    const BAY = 4;
    for (let s = s0; s < s1; s += SEG) {
      const s2 = Math.min(s1, s + SEG);
      for (const sign of [1, -1]) {
        const u = sign * (GEO.pavedOut + 4.2);
        const a = roadPt(s, u), b = roadPt(s2, u);
        m.quad(lift(a, 3.8), lift(b, 3.8), lift(b, -0.2), lift(a, -0.2), s / BAY, 0, s2 / BAY, 1);
      }
    }
    /* The H-section steel posts the panels drop into, one per bay joint. They
       stand a little proud of the panel face on both sides, which is what
       gives the wall its rhythm when you drive past it. */
    for (let s = Math.ceil(s0 / BAY) * BAY; s < s1; s += BAY) {
      for (const sign of [1, -1]) {
        const u = sign * (GEO.pavedOut + 4.2);
        const pts = [
          roadPt(s - 0.075, u - 0.10), roadPt(s + 0.075, u - 0.10),
          roadPt(s + 0.075, u + 0.10), roadPt(s - 0.075, u + 0.10),
        ];
        prismSides(posts, pts, -0.2, 3.95, 0, 0, 1, 1);
      }
    }
    if (!m.empty) {
      const mesh = new THREE.Mesh(m.geo(), mats.noiseWall);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    if (!posts.empty) {
      const pm = new THREE.Mesh(posts.geo(), mats.wallPost);
      pm.matrixAutoUpdate = false;
      group.add(pm);
    }
  }
  return group;
}

/** The roadworks at Empfingen: beacons, barrier, works plant. */
function buildRoadworks(mats) {
  const group = new THREE.Group();
  group.name = 'roadworks';
  const sec = SECTIONS.find(x => x.works);
  if (!sec) return group;
  const i = SECTIONS.indexOf(sec);
  const s0 = sec.km * 1000, s1 = SECTIONS[i + 1].km * 1000 - 60;

  // Leitbaken — red/white striped boards along the closed shoulder. These
  // used to be five individual meshes per beacon: about 575 drawables in one
  // short section, enough to cut frame rate to the teens as the roadworks
  // entered view. Three instanced batches render the same geometry.
  const stripGeo = new THREE.PlaneGeometry(0.55, 0.18);
  const legGeo = new THREE.BoxGeometry(0.09, 0.45, 0.09);
  const redMatrices = [], whiteMatrices = [], legMatrices = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = s0; s < s1; s += 14) {
    const p = roadPt(s, 9.9);
    const c = sample(s);
    q.setFromAxisAngle(up, c.head + Math.PI);
    for (let b = 0; b < 4; b++) {
      pos.set(p[0], p[1] + 0.42 + b * 0.19, p[2]);
      m4.compose(pos, q, one);
      (b % 2 ? redMatrices : whiteMatrices).push(m4.clone());
    }
    pos.set(p[0], p[1] + 0.22, p[2]);
    m4.compose(pos, q, one); legMatrices.push(m4.clone());
  }
  const batch = (geo, mat, matrices) => {
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  batch(stripGeo, mats.bakenRed, redMatrices);
  batch(stripGeo, mats.baken, whiteMatrices);
  batch(legGeo, mats.dark, legMatrices);

  // concrete separator down the closed lane edge
  const barr = new Mesher();
  for (let s = s0; s < s1; s += SEG) {
    const s2 = Math.min(s1, s + SEG);
    const u = 10.6;
    const a = roadPt(s, u), b = roadPt(s2, u);
    barr.quad(lift(a, 0.95), lift(b, 0.95), lift(b, -0.1), lift(a, -0.1), s / 4, 0, s2 / 4, 1);
    barr.quad(lift(b, 0.95), lift(a, 0.95), lift(a, -0.1), lift(b, -0.1), s / 4, 0, s2 / 4, 1);
  }
  const bm = new THREE.Mesh(barr.geo(), mats.barrier);
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
  const am = new THREE.Mesh(apron.geo(), mats.asphaltPlain);
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
    if (sec === SECTIONS[0]) continue;        // km 0 is the entry slip road
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
    const mesh = new THREE.Mesh(m.geo(), mats.asphaltPlain);
    mesh.matrixAutoUpdate = false; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** The Auffahrt you start on: a slip road tapering into the right-hand lane. */
function buildEntryRamp(mats) {
  const group = new THREE.Group();
  const road = new Mesher(), mark = new Mesher();
  /* The carriageway drains outwards at 2.5 %, so out at the slip road the road
     surface has fallen ~31 cm while the flat mown verge sits at a fixed −30 cm.
     That leaves the ramp about a centimetre *under* the grass and the terrain
     pokes through it. Lift the ramp clear of the verge. */
  const LIFT = 0.07;
  for (let s = 0; s < ENTRY_LEN; s += SEG) {
    const s2 = Math.min(ENTRY_LEN, s + SEG);
    const a = entryRamp(s), b = entryRamp(s2);
    if (!a || !b) continue;
    road.quad(lift(roadPt(s, a.inner), LIFT), lift(roadPt(s, a.outer), LIFT),
      lift(roadPt(s2, b.outer), LIFT), lift(roadPt(s2, b.inner), LIFT),
      0, s / 7, 1.4, s2 / 7);
    // solid edge line down the outer side of the ramp
    if (a.width > 0.5) {
      const w0 = 0.28;
      mark.quad(lift(roadPt(s, a.outer - w0), LIFT + 0.015), lift(roadPt(s, a.outer), LIFT + 0.015),
        lift(roadPt(s2, b.outer), LIFT + 0.015), lift(roadPt(s2, b.outer - w0), LIFT + 0.015));
    }
  }
  const rm = new THREE.Mesh(road.geo(), mats.asphaltPlain);
  rm.matrixAutoUpdate = false; rm.receiveShadow = true;
  group.add(rm);
  if (!mark.empty) {
    const mm = new THREE.Mesh(mark.geo(), mats.markWhite);
    mm.matrixAutoUpdate = false;
    group.add(mm);
  }
  // Leitbaken-free verge: just a couple of delineators along the ramp edge
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
  /* Shadow frustum. The sun is parked SUN_OFFSET away from the car each frame,
     so near/far have to bracket that distance — with far shorter than the
     offset the car sits outside the frustum, no shadow is ever cast, and every
     receiver past the far plane clamps to fully shadowed, which paints huge
     black slabs across the fields. */
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  /* An orthographic shadow camera has linear depth, so a generous near/far
     costs no precision — and a tight near plane is actively harmful: three.js
     bounds-checks the shadow coord in x and y but not for z < 0, so anything
     closer to the light than `near` compares as occluded and paints solid
     black slabs across the landscape. */
  const sunDist = SUN_OFFSET.length();
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = sunDist + 400;
  const sc = sun.shadow.camera;
  sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.045;
  sun.shadow.camera.updateProjectionMatrix();
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
  scene.add(buildEntryRamp(mats));
  onProgress('Gelände');
  scene.add(buildTerrain());
  onProgress('Schwarzwald');
  scene.add(buildVegetation(rng));
  const grass = buildVergeGrass(rng, vergeBlocker());
  scene.add(grass);
  const grassBuckets = grass.userData.buckets;
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
      sun.position.copy(playerPos).add(SUN_OFFSET);
      for (const t of lm.turbines) t.userData.hub.rotation.z += dt * 0.55;
      /* Verge grass: only the two or three 200 m buckets around the player are
         switched on. A world-space distance test against each bucket centre is
         all this needs, which is why game.js does not have to change — it
         already passes the player's position in. */
      for (const b of grassBuckets) {
        const dx = b.x - playerPos.x, dz = b.z - playerPos.z;
        b.mesh.visible = dx * dx + dz * dz < GRASS_VIS * GRASS_VIS;
      }
    },
    inTunnel(s) { return s > tunnelRange[0] && s < tunnelRange[1]; },
  };
}
