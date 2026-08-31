/* ==========================================================================
   carEnv.js — procedural HDR environments for the cars.

   Paint only looks like paint when there is something worth reflecting. The
   game used to reflect a PMREM of a flat vertical gradient, which carries no
   information at all: every panel came back the same value regardless of which
   way it faced, so a car read as a flat-shaded solid.

   Here we synthesise a real *high dynamic range* equirectangular sky — sun
   disc at the world sun's direction, aureole, cloud banding, a crisp horizon
   line and a dark ground half — into a half-float DataTexture and run it
   through PMREMGenerator. Two things matter:

     * HDR. A canvas texture clamps at 1.0, so the sun cannot be brighter than
       the sky and clearcoat has nothing to glint off. Here the sun disc is
       ~200x the sky, which is what produces a hard specular highlight.
     * A sharp horizon. The single strongest cue that a surface is glossy is a
       horizon line bending across it. A gradient has no horizon.

   `studioEnv` is the same machinery pointed at a photographic studio instead:
   dark surround, three softboxes and a long overhead strip, which is what
   draws the long highlight down the shoulder line on the menu turntable.

   No network, no assets: it is a few hundred lines of arithmetic run once.
   ========================================================================== */
import * as THREE from 'three';

/* The world sun lives at SUN_OFFSET in world.js: late afternoon, over your
   left shoulder. Reflections are world-space, so the env has to agree. */
const SUN_DIR = new THREE.Vector3(-165, 225, 250).normalize();

/* ------------------------------------------------------------ tiny noise */
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.07; }
  return s;
}
const sstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/* --------------------------------------------------- equirect HDR builder
   Rows run bottom (nadir) to top (zenith) because DataTexture does not flip,
   and three's equirectUv() is u = atan2(z,x)/2pi + 0.5, v = asin(y)/pi + 0.5. */
function equirectHDR(W, H, shade) {
  const data = new Uint16Array(W * H * 4);
  const c = new Float32Array(3);
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const elev = (v - 0.5) * Math.PI;
    const sy = Math.sin(elev), cy = Math.cos(elev);
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const th = (u - 0.5) * Math.PI * 2;
      shade(cy * Math.cos(th), sy, cy * Math.sin(th), c);
      const o = (j * W + i) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(Math.min(c[0], 65000));
      data[o + 1] = THREE.DataUtils.toHalfFloat(Math.min(c[1], 65000));
      data[o + 2] = THREE.DataUtils.toHalfFloat(Math.min(c[2], 65000));
      data[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function prefilter(renderer, equirect) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(equirect);
  pmrem.dispose();
  equirect.dispose();
  return rt.texture;
}

/* ============================================================ road sky ==
   Values are tuned so the *average* radiance lands close to the old flat
   gradient's — swapping the env in must not silently re-expose the game. */
function skyShade(x, y, z, out) {
  const sd = SUN_DIR;
  const cosG = x * sd.x + y * sd.y + z * sd.z;

  if (y >= 0) {
    // vertical gradient: deep zenith blue down to a hazy horizon
    const t = Math.pow(Math.min(1, y), 0.58);
    let r = 0.72 * (1 - t) + 0.058 * t;
    let g = 0.78 * (1 - t) + 0.150 * t;
    let b = 0.86 * (1 - t) + 0.400 * t;

    // Mie aureole: the sky brightens and warms towards the sun
    const fw = Math.max(0, cosG);
    const aur = Math.pow(fw, 7) * 0.42 + Math.pow(fw, 48) * 0.95;
    r += aur * 1.15; g += aur * 1.02; b += aur * 0.80;

    /* Cloud banding, projected onto a plane above the camera. Kept deliberately
       weak: the visible sky is a plain gradient (world.js owns it) and loud
       clouds in the reflection would contradict it. Streaks read as
       "something is up there", which is all a reflection needs. */
    if (y > 0.02) {
      const k = 1 / (y + 0.30);
      const n = fbm(x * k * 1.9 + 11.3, z * k * 0.62 + 4.7, 4);
      const cov = sstep(0.50, 0.86, n) * sstep(0.02, 0.20, y);
      const lit = 0.55 + 0.75 * Math.max(0, cosG);
      r += cov * lit * 0.55; g += cov * lit * 0.57; b += cov * lit * 0.58;
    }

    // the sun itself — soft-edged, ~1.4 deg, and two orders up on the sky
    const disc = 1 - sstep(0.99955, 0.99992, cosG);
    if (disc > 0) {
      const s = (1 - disc) * 210;
      r += s * 1.00; g += s * 0.955; b += s * 0.855;
    }
    out[0] = r; out[1] = g; out[2] = b;
  } else {
    /* Ground half. A dark, slightly green-grey lower hemisphere is what stops
       a car being lit from below like a display model, and it is what puts a
       visible horizon in the flanks. */
    const d = Math.pow(Math.min(1, -y), 0.42);
    let r = 0.40 * (1 - d) + 0.052 * d;
    let g = 0.42 * (1 - d) + 0.058 * d;
    let b = 0.37 * (1 - d) + 0.052 * d;
    // patchy fields / asphalt, and a warm wash where the sun hits the ground
    const k = 1 / (-y + 0.22);
    const n = fbm(x * k * 3.1 + 51.7, z * k * 3.1 + 23.1, 3);
    const m = 0.82 + 0.36 * n;
    const warm = Math.max(0, cosG) * 0.16;
    out[0] = r * m + warm; out[1] = g * m + warm * 0.92; out[2] = b * m + warm * 0.74;
  }

  // haze band straight across the horizon: crisp, bright, and the whole point
  const band = 1 - sstep(0.0, 0.030, Math.abs(y));
  if (band > 0) {
    const w = band * 0.55;
    out[0] = out[0] * (1 - w) + 0.92 * w;
    out[1] = out[1] * (1 - w) + 0.95 * w;
    out[2] = out[2] * (1 - w) + 0.99 * w;
  }
}

/** Outdoor HDR environment for the cars in the world. */
export function roadEnv(renderer) {
  return prefilter(renderer, equirectHDR(1024, 512, skyShade));
}

/* ============================================================== studio ==
   Softboxes as angular rectangles. `panel` returns 0..1 coverage with soft
   edges, which is exactly the shape of a real diffusion panel and gives the
   long, straight highlight streak that says "car photograph". */
function basis(dir) {
  const f = dir.clone().normalize();
  const up = Math.abs(f.y) > 0.94 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(up, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return { f, r, u };
}
/* Panel brightness is the whole balancing act. A softbox has to be bright
   enough to blow out where the reflection is narrow — a grazing shoulder line,
   the lip of a rim — and dim enough that a broad flat surface like a bonnet
   does not go to paper white. Big and dim beats small and fierce, so these are
   narrower and far weaker than the first attempt, which turned the roof into a
   light source. */
const PANELS = [
  // key: high front-left three-quarter, warm
  { b: basis(new THREE.Vector3(-0.62, 0.58, 0.53)), ha: 0.46, hb: 0.19, i: [5.6, 5.3, 4.8], soft: 0.55 },
  // overhead strip running the length of the car: the shoulder-line highlight
  { b: basis(new THREE.Vector3(0.04, 1.0, 0.06)), ha: 1.10, hb: 0.068, i: [7.6, 7.6, 7.9], soft: 0.40 },
  // cool rim from behind the right rear quarter, separates the car from black
  { b: basis(new THREE.Vector3(0.74, 0.40, -0.55)), ha: 0.34, hb: 0.18, i: [2.4, 2.8, 3.7], soft: 0.55 },
  // low broad fill in front so the nose is not a silhouette
  { b: basis(new THREE.Vector3(0.10, 0.16, 0.98)), ha: 0.95, hb: 0.42, i: [0.85, 0.88, 0.97], soft: 0.75 },
];
function studioShade(x, y, z, out) {
  // surround: near-black, lifting very slightly towards the top
  let r = 0.034 + 0.042 * Math.max(0, y);
  let g = 0.036 + 0.045 * Math.max(0, y);
  let b = 0.042 + 0.052 * Math.max(0, y);
  if (y < 0) {
    // sweep floor: mid grey close to the horizon, falling away underneath
    const d = Math.pow(-y, 0.55);
    const f = 0.105 * (1 - d) + 0.018 * d;
    r += f * 1.00; g += f * 1.02; b += f * 1.06;
  }
  for (const p of PANELS) {
    const df = x * p.b.f.x + y * p.b.f.y + z * p.b.f.z;
    if (df <= 0.05) continue;
    const a = Math.atan2(x * p.b.r.x + y * p.b.r.y + z * p.b.r.z, df);
    const e = Math.asin(Math.min(1, Math.max(-1, x * p.b.u.x + y * p.b.u.y + z * p.b.u.z)));
    const ca = 1 - sstep(p.ha * (1 - p.soft * 0.5), p.ha * (1 + p.soft), Math.abs(a));
    const cb = 1 - sstep(p.hb * (1 - p.soft * 0.5), p.hb * (1 + p.soft), Math.abs(e));
    const w = ca * cb;
    if (w > 0) { r += p.i[0] * w; g += p.i[1] * w; b += p.i[2] * w; }
  }
  out[0] = r; out[1] = g; out[2] = b;
}

/** Photo-studio HDR environment for the menu turntable. */
export function studioEnv(renderer) {
  return prefilter(renderer, equirectHDR(768, 384, studioShade));
}
