/* ==========================================================================
   carFit.js — the geometry of getting somebody else's car model onto our rig.

   Pure functions over THREE.BufferGeometry. No assets, no DOM, no renderer,
   which is deliberate: every rule in here can be exercised from Node, and
   `dev/fleet-check.mjs` leans on that.

   Three things have to be decided about a downloaded body, and getting any of
   them wrong is instantly visible on the road:

     1. WHICH WAY IS IT POINTING.  A minimum-area box finds the long axis, but
        a car pointing backwards has exactly the same footprint as one pointing
        forwards, so the 180-degree half of the question needs a different
        argument entirely — see `noseSign`.
     2. WHERE ARE THE AXLES.  Scale has to come from the wheelbase. If the
        model brought its own wheels we measure them; if it did not, the arches
        are still cut into the bodywork and can be found — see `archAxles`.
     3. HOW WIDE IS IT AT THE ARCH.  Not the widest point of the car: mirrors
        and shoulders are wider than the sills, and a wheel tucked inside the
        mirrors still stands proud of the arch.
   ========================================================================== */
import * as THREE from 'three';

/* ------------------------------------------------------------ small tools */

export const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

export function bboxOf(geos) {
  const b = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    tmp.copy(g.boundingBox);
    b.union(tmp);
  }
  return b;
}

/* -------------------------------------------------------------- squaring up
   An asset pack does not lay its models out in a neat row facing one way. The
   generic pack arranges ten cars in a ring, each at its own yaw, so a node's
   axis-aligned bounding box is a diagonal smear — the estate measured 3.43 m
   across and 4.09 m long, and scale, wheel placement and plate position were
   all computed from that nonsense.

   The previous version sampled yaw at one-degree steps and took the smallest
   footprint, which is the right idea but not the right method: subsampled
   vertices miss the extreme points that define the box, and on the estate it
   settled 18 degrees out. The minimum-area rectangle enclosing a point set
   always has one side flush with an edge of the convex hull, so enumerating
   the hull edges gives the exact answer for the cost of a hull.            */

/** Convex hull of [x, z] pairs, monotone chain, counter-clockwise. */
export function hull2d(pts) {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/**
 * The yaw about Y that squares a body up and puts its long axis on Z.
 *
 * Sign convention matters and is easy to get backwards: Three's
 * `makeRotationY(t)` maps (x, z) to (x·cos t + z·sin t, −x·sin t + z·cos t).
 * The value returned here is meant to be handed straight to `makeRotationY`.
 */
export function squareYaw(geos) {
  const pts = [];
  for (const g of geos) {
    const pos = g.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 6000));   // hull only needs extremes
    for (let i = 0; i < pos.count; i += step) pts.push([pos.getX(i), pos.getZ(i)]);
  }
  const h = hull2d(pts);
  if (h.length < 3) return 0;
  let best = 0, bestArea = Infinity, longOnX = false;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
    for (const q of h) {
      const u = q[0] * c - q[1] * s, v = q[0] * s + q[1] * c;
      if (u < lo0) lo0 = u; if (u > hi0) hi0 = u;
      if (v < lo1) lo1 = v; if (v > hi1) hi1 = v;
    }
    const w = hi0 - lo0, l = hi1 - lo1, area = w * l;
    if (area < bestArea - 1e-9) { bestArea = area; best = ang; longOnX = w > l; }
  }
  return longOnX ? best + Math.PI / 2 : best;
}

/* ------------------------------------------------------------ which end is
   the nose

   No amount of footprint measuring answers this — the box is symmetric. What
   is not symmetric is the roofline. Every passenger car, from a 911 to a panel
   van, has more bodywork below the waist in front of the cabin than behind it:
   there is a bonnet, and whatever is at the other end (boot lid, tailgate,
   rear doors) is shorter, taller, or both.

   Three cues, each a signed number where positive means "nose is at +Z", and
   a vote. Individually any of them can be fooled; a one-box van has almost no
   bonnet, a pickup has an enormous flat bed that reads like one. Together
   they have been right on every model in the fleet, and where a model is
   genuinely ambiguous the recipe pins it by hand and this is only the check.
*/

/**
 * Walk every triangle of every geometry. Measuring by *vertex* is a trap: a
 * procedural box has eight corners and nothing in between, so a 13-metre
 * trailer contributes to two z-slices out of forty and the other thirty-eight
 * come back empty. Every profile below is therefore taken over triangles,
 * each one smeared across the slices it actually spans.
 */
export function forEachTriangle(geos, cb) {
  const v = new Float64Array(9);
  for (const g of geos) {
    const p = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v[k * 3] = p.getX(j); v[k * 3 + 1] = p.getY(j); v[k * 3 + 2] = p.getZ(j);
      }
      cb(v);
    }
  }
}

/**
 * How tall the vehicle is *as a vehicle*.
 *
 * The 930 wears a radio aerial on its left front wing that stands 43 cm above
 * its roof, so its bounding box is 1.77 m where the car is 1.53 m — a 15%
 * error in every proportion derived from it. An aerial is two centimetres
 * across and a roof is more than a metre, so walk down from the top and stop
 * at the first horizontal slice with real width. Width, not distance from the
 * centreline: the aerial sits 79 cm off centre and a `max |x|` test calls it
 * three quarters of a car wide.
 */
export function roofHeight(geos, slices = 80) {
  const box = bboxOf(geos);
  const y0 = box.min.y, span = (box.max.y - box.min.y) || 1;
  const lo = new Float64Array(slices).fill(Infinity);
  const hi = new Float64Array(slices).fill(-Infinity);
  forEachTriangle(geos, (v) => {
    let ylo = Infinity, yhi = -Infinity, xlo = Infinity, xhi = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = v[k * 3], y = v[k * 3 + 1];
      if (y < ylo) ylo = y; if (y > yhi) yhi = y;
      if (x < xlo) xlo = x; if (x > xhi) xhi = x;
    }
    const a = Math.min(slices - 1, Math.max(0, Math.floor(((ylo - y0) / span) * slices)));
    const b = Math.min(slices - 1, Math.max(0, Math.floor(((yhi - y0) / span) * slices)));
    for (let k = a; k <= b; k++) { if (xlo < lo[k]) lo[k] = xlo; if (xhi > hi[k]) hi[k] = xhi; }
  });
  let ref = 0;
  for (let k = 0; k < slices; k++) if (hi[k] > -Infinity) ref = Math.max(ref, hi[k] - lo[k]);
  if (ref <= 0) return span;
  for (let k = slices - 1; k >= 0; k--) {
    if (hi[k] > -Infinity && hi[k] - lo[k] >= ref * 0.30) return ((k + 1) / slices) * span;
  }
  return span;
}

/**
 * Per-z-slice silhouette: the highest the body reaches, and how wide it is
 * below the waist. Everything that needs to know the shape of a vehicle —
 * its size, which way it points — reads this.
 */
export function sliceProfile(geos, bins = 48) {
  const box = bboxOf(geos);
  const z0 = box.min.z, span = (box.max.z - box.min.z) || 1;
  const H = roofHeight(geos) || (box.max.y - box.min.y) || 1;
  const waist = box.min.y + H * 0.45;
  const top = new Float64Array(bins).fill(-Infinity);
  const low = new Float64Array(bins).fill(Infinity);
  const wide = new Float64Array(bins).fill(-Infinity);
  const binOf = (z) => Math.min(bins - 1, Math.max(0, Math.floor(((z - z0) / span) * bins)));
  forEachTriangle(geos, (v) => {
    let zlo = Infinity, zhi = -Infinity, ymax = -Infinity, ymin = Infinity, xsub = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = v[k * 3], y = v[k * 3 + 1], z = v[k * 3 + 2];
      if (z < zlo) zlo = z; if (z > zhi) zhi = z;
      if (y > ymax) ymax = y; if (y < ymin) ymin = y;
      if (y <= waist) { const a = Math.abs(x); if (a > xsub) xsub = a; }
    }
    const a = binOf(zlo), b = binOf(zhi);
    for (let k = a; k <= b; k++) {
      if (ymax > top[k]) top[k] = ymax;
      if (ymin < low[k]) low[k] = ymin;
      if (xsub > wide[k]) wide[k] = xsub;
    }
  });
  return { top, low, wide, z0, span, bins, box, waist, roof: H, binOf };
}

/**
 * +1 if the nose points at +Z, −1 if it points at −Z. `conf` is the margin;
 * below about 0.15 the model deserves a hand-written answer in the recipe.
 */
export function noseSign(geos, bins = 48) {
  const P = sliceProfile(geos, bins);
  const { top, wide, z0, span, box, waist } = P;
  const H = P.roof;
  const rel = Array.from(top, v => (v === -Infinity ? 0 : Math.min(1, (v - box.min.y) / H)));
  const mid = (box.min.z + box.max.z) / 2;
  const zAt = k => z0 + ((k + 0.5) / bins) * span;

  /* (a) bonnet run. Walk in from each end until the roofline rises past the
     waist. The bonnet is always the longer of the two runs: a boot lid is
     shorter than a bonnet, and a tailgate is not a run at all. */
  const T = 0.72;
  let runP = 0; while (runP < bins && rel[bins - 1 - runP] < T) runP++;
  let runM = 0; while (runM < bins && rel[runM] < T) runM++;
  const cueA = (runP - runM) / bins;

  /* (b) where the roof sits. The greenhouse of a saloon, estate, hatchback or
     coupe is behind the middle of the car; only a cab-forward van is neutral. */
  let sw = 0, sz = 0;
  for (let k = 0; k < bins; k++) {
    if (rel[k] < 0.9) continue;
    const w = rel[k] - 0.9;
    sw += w; sz += w * zAt(k);
  }
  const cueB = sw > 0 ? (mid - sz / sw) / (span * 0.5) : 0;

  /* (c) side-elevation area. Cue (a) integrated rather than thresholded, which
     is steadier where the bonnet blends into the screen. */
  let aw = 0, az = 0;
  for (let k = 0; k < bins; k++) { aw += rel[k]; az += rel[k] * zAt(k); }
  const cueC = aw > 0 ? (mid - az / aw) / (span * 0.5) : 0;

  /* (d) wing mirrors — the strongest of the four, and the only one that is
     right about a rear-engined car. Mirrors hang off the A-pillar or the door,
     always in the front half of the cabin, and they are the only part of a car
     that sticks out sideways above the waist. A 911's roofline is symmetric
     enough to fool (a) and its cabin sits *forward*, which makes (b) argue the
     wrong way; its mirrors are still at the front.

     "Sticks out" is measured against the bodywork beside it rather than
     against the widest point of the whole vehicle, because on an artic the
     fuel tanks are wider than the trailer and the mirrors are not. */
  let mw = 0, mz = 0, mn = 0;
  const eaves = box.min.y + H * 0.85;
  for (const g of geos) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < waist || y > eaves) continue;
      const z = p.getZ(i);
      const k = P.binOf(z);
      const ref = Number.isFinite(wide[k]) ? wide[k] : 0;
      if (ref <= 0) continue;
      const x = Math.abs(p.getX(i));
      if (x < ref * 1.02) continue;
      const w = x - ref * 1.02;
      mn++; mw += w; mz += w * z;
    }
  }
  const cueD = mw > 0 ? ((mz / mw) - mid) / (span * 0.5) : 0;

  const score = 1.0 * cueA + 0.8 * cueB + 1.6 * cueC + 3.0 * cueD;
  return {
    sign: score >= 0 ? 1 : -1, conf: Math.abs(score), score,
    cues: { a: +cueA.toFixed(3), b: +cueB.toFixed(3), c: +cueC.toFixed(3), d: +cueD.toFixed(3), mirrorPts: mn },
  };
}

/* -------------------------------------------------------------- the envelope

   "How big is this car" sounds like a bounding box and is not one. A 911 wears
   a radio aerial on its left front wing that stands 43 cm above its roof, so
   the box calls the car 1.67 m tall when it is 1.45 m tall; an artic carries
   fuel tanks reaching 20 cm wider than its own trailer. Forty vertices should
   not decide the size of a vehicle, so take a high quantile over the z-slices
   instead of a maximum over the points. */
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

export function envelopeOf(geos, bins = 48) {
  const P = sliceProfile(geos, bins);
  const box = P.box;
  const ws = Array.from(P.wide).filter(Number.isFinite).sort((a, b) => a - b);
  const half = quantile(ws, 0.85);
  const fallbackHalf = Math.max(box.max.x, -box.min.x);
  return {
    length: P.span,
    width: 2 * (Number.isFinite(half) ? half : fallbackHalf),
    height: P.roof,
    halfWidth: Number.isFinite(half) ? half : fallbackHalf,
    wideHalf: fallbackHalf,
    floor: box.min.y,
    top: box.max.y,
    nose: box.max.z,
    tail: box.min.z,
    waist: P.waist,
  };
}

/* ---------------------------------------------------------------- the axles

   Where a model brings its own wheels, they are the truth. Where it does not,
   the arches are still cut into the bodywork: run along the flanks and the
   underside of the car jumps from the sill up over each wheel. Two peaks in
   that profile are two axles.                                              */

/**
 * Find the axle z positions from the arch cut-outs in the body's flanks.
 * Returns null when the profile has no two convincing peaks.
 */
export function archAxles(geos) {
  const box = bboxOf(geos);
  const halfW = Math.max(box.max.x, -box.min.x);
  const z0 = box.min.z, span = (box.max.z - box.min.z) || 1;
  const bins = 60;
  const lo = new Float64Array(bins).fill(Infinity);
  for (const g of geos) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (Math.abs(x) < halfW * 0.55) continue;              // flanks only
      const k = Math.min(bins - 1, Math.max(0, Math.floor(((pos.getZ(i) - z0) / span) * bins)));
      const y = pos.getY(i);
      if (y < lo[k]) lo[k] = y;
    }
  }
  const zAt = k => z0 + ((k + 0.5) / bins) * span;
  const valid = [];
  for (let k = 0; k < bins; k++) if (lo[k] !== Infinity) valid.push(k);
  if (valid.length < 12) return null;
  const base = median(valid.map(k => lo[k]));

  /* Peaks: contiguous runs above the sill line, one per arch. The threshold is
     a fraction of the tallest excursion so it scales with the model. */
  let peak = 0;
  for (const k of valid) peak = Math.max(peak, lo[k] - base);
  if (peak < span * 0.02) return null;
  const T = base + peak * 0.45;
  const runs = [];
  let cur = null;
  for (let k = 0; k < bins; k++) {
    const up = lo[k] !== Infinity && lo[k] >= T;
    if (up) { if (!cur) cur = { a: k, b: k, w: 0, sz: 0 }; cur.b = k; const w = lo[k] - base; cur.w += w; cur.sz += w * zAt(k); }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  const good = runs.filter(r => r.w > 0).map(r => ({ z: r.sz / r.w, w: r.w }));
  if (good.length < 2) return null;
  good.sort((p, q) => q.w - p.w);
  const two = good.slice(0, 2).sort((p, q) => q.z - p.z);
  const [f, r] = two;
  if (f.z - r.z < span * 0.30) return null;                  // not two axles
  return { front: f.z, rear: r.z, wheelbase: f.z - r.z };
}

/**
 * Body half-width measured where a wheel actually sits, rather than at the
 * mirrors. Takes the widest point in a window around the axle, below the waist.
 */
export function halfWidthAt(geos, z, window, maxY) {
  let w = 0;
  forEachTriangle(geos, (v) => {
    let zlo = Infinity, zhi = -Infinity, x = 0, any = false;
    for (let k = 0; k < 3; k++) {
      const vz = v[k * 3 + 2];
      if (vz < zlo) zlo = vz; if (vz > zhi) zhi = vz;
      if (maxY === undefined || v[k * 3 + 1] <= maxY) { any = true; const a = Math.abs(v[k * 3]); if (a > x) x = a; }
    }
    if (!any) return;
    if (zhi < z - window || zlo > z + window) return;      // triangle spans the slice?
    if (x > w) w = x;
  });
  return w;
}

/**
 * Keep only the triangles of `geo` whose centroid falls inside a plan-view
 * rectangle. The generic pack merges every instance of a wheel design into one
 * mesh, so the estate's "wheel set" is eight wheels belonging to two different
 * cars; splitting that into quadrants produced a 1.48 m wheelbase on a 4.4 m
 * car, and everything scaled from it was wrong.
 */
export function clipToFootprint(geo, box, pad = 0.2) {
  const ni = geo.index ? geo.toNonIndexed() : geo;
  const src = ni.attributes;
  const p = src.position.array;
  const tri = Math.floor(p.length / 9);
  const keep = [];
  for (let t = 0; t < tri; t++) {
    const o = t * 9;
    const cx = (p[o] + p[o + 3] + p[o + 6]) / 3;
    const cz = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
    if (cx > box.min.x - pad && cx < box.max.x + pad && cz > box.min.z - pad && cz < box.max.z + pad) keep.push(t);
  }
  if (!keep.length) return null;
  if (keep.length === tri) return ni === geo ? geo.clone() : ni;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src)) {
    const a = src[name], k = a.itemSize;
    const dst = new Float32Array(keep.length * 3 * k);
    for (let i = 0; i < keep.length; i++) {
      const base = keep[i] * 3 * k;
      for (let c = 0; c < 3 * k; c++) dst[i * 3 * k + c] = a.array[base + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, k));
  }
  return out;
}

/**
 * Split a set of wheel triangles into four corners and report each corner's
 * hub. Unlike a plain quadrant split this clusters on the actual z values, so
 * a set whose corners are not symmetric about the origin still separates.
 */
export function wheelCorners(geo) {
  const ni = geo.index ? geo.toNonIndexed() : geo;
  const p = ni.attributes.position.array;
  const tri = Math.floor(p.length / 9);
  if (!tri) return null;
  let zmin = Infinity, zmax = -Infinity;
  const cz = new Float64Array(tri), cx = new Float64Array(tri);
  for (let t = 0; t < tri; t++) {
    const o = t * 9;
    cx[t] = (p[o] + p[o + 3] + p[o + 6]) / 3;
    cz[t] = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
    if (cz[t] < zmin) zmin = cz[t];
    if (cz[t] > zmax) zmax = cz[t];
  }
  const zmid = (zmin + zmax) / 2;
  const acc = {};
  for (const key of ['LF', 'RF', 'LR', 'RR']) {
    acc[key] = { n: 0, sx: 0, sy: 0, sz: 0, xlo: Infinity, xhi: -Infinity, ylo: Infinity, yhi: -Infinity, zlo: Infinity, zhi: -Infinity };
  }
  for (let t = 0; t < tri; t++) {
    const key = (cx[t] < 0 ? 'L' : 'R') + (cz[t] > zmid ? 'F' : 'R');
    const a = acc[key];
    a.n++; a.sx += cx[t]; a.sz += cz[t];
    const o = t * 9;
    for (let v = 0; v < 3; v++) {
      const x = p[o + v * 3], y = p[o + v * 3 + 1], z = p[o + v * 3 + 2];
      a.sy += y / 3;
      if (x < a.xlo) a.xlo = x; if (x > a.xhi) a.xhi = x;
      if (y < a.ylo) a.ylo = y; if (y > a.yhi) a.yhi = y;
      if (z < a.zlo) a.zlo = z; if (z > a.zhi) a.zhi = z;
    }
  }
  const res = {};
  for (const key of Object.keys(acc)) {
    const a = acc[key];
    if (a.n < 12) continue;
    res[key] = {
      n: a.n, x: a.sx / a.n, y: a.sy / a.n, z: a.sz / a.n,
      xlo: a.xlo, xhi: a.xhi, ylo: a.ylo, yhi: a.yhi, zlo: a.zlo, zhi: a.zhi,
    };
  }
  return Object.keys(res).length ? res : null;
}

/* ==========================================================================
   Wheels that a four-corner split cannot find.

   `wheelCorners` above assumes four wheels and splits them by the sign of a
   triangle's centroid. A lorry has eight wheel units on four axles, some of
   them twinned, and no quadrant split reaches them.

   The obvious next move — cluster wheel triangles by distance — does not work
   and it is worth writing down why, because it cost a previous attempt at this
   the whole job. On a lorry the tyres are about 1.39 m across and the trailer's
   axles about 1.5 m apart, so there is no radius that separates two axles
   without also cutting one tyre into pieces: at 0.5 m one wheel becomes three,
   at 0.8 m two axles become one.

   Distance is the wrong property. Connectivity is the right one: whatever else
   is true of two adjacent wheels, no triangle of one shares an edge with a
   triangle of the other. So:

     1. weld vertices by position — glTF duplicates them per face, and an
        unwelded index buffer has no connectivity in it at all;
     2. union-find over the index buffer;
     3. that gives ISLANDS, not wheels. A wheel is several islands: the tyre,
        the rim, the dish, the hub cap and ten wheel nuts are all modelled as
        separate closed shells. On the lorry, eighteen wheels come to eighty-two
        islands.
     4. but every island of one wheel is concentric with it, so their centroids
        sit within a hub's width of each other while two axles are a metre and
        a half apart. Clustering ISLAND CENTROIDS therefore has a threshold with
        two orders of separation instead of none, and — this is the point — it
        cannot fragment a wheel, because a wheel's islands are not spread out.

   `wheelIslands` does steps 1 to 3 and `groupWheels` does step 4.            */

/**
 * Label every vertex of `geo` with the connected component it belongs to.
 * Vertices are welded by quantised position first: an exported glTF routinely
 * carries one vertex per face-corner, and without welding every triangle is
 * its own island.
 *
 * @param tol  weld tolerance in metres. Well under a millimetre: it has to be
 *             loose enough to catch float noise and meshopt's quantisation,
 *             and tight enough never to bridge two surfaces that only touch.
 */
export function componentLabels(geo, tol = 2e-4) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const rep = new Int32Array(n);
  const weld = new Map();
  const q = 1 / tol;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    const r = weld.get(k);
    if (r === undefined) { weld.set(k, i); rep[i] = i; } else rep[i] = r;
  }
  const par = Int32Array.from(rep);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par[rb] = ra; };
  const idx = geo.index;
  const m = idx ? idx.count : n;
  for (let t = 0; t + 2 < m; t += 3) {
    const a = rep[idx ? idx.getX(t) : t];
    const b = rep[idx ? idx.getX(t + 1) : t + 1];
    const c = rep[idx ? idx.getX(t + 2) : t + 2];
    uni(a, b); uni(a, c);
  }
  const label = new Int32Array(n);
  const seen = new Map();
  let count = 0;
  for (let i = 0; i < n; i++) {
    const r = find(rep[i]);
    let l = seen.get(r);
    if (l === undefined) { l = count++; seen.set(r, l); }
    label[i] = l;
  }
  return { label, count };
}

/**
 * The connected components of `geo`, as triangle lists with their extents.
 * Every triangle lands in exactly one island — its three corners are welded
 * into the same component by construction.
 */
export function wheelIslands(geo, tol = 2e-4) {
  const { label, count } = componentLabels(geo, tol);
  const idx = geo.index;
  const pos = geo.attributes.position;
  const n = idx ? idx.count : pos.count;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ tris: [], box: new THREE.Box3(), centre: new THREE.Vector3(), verts: 0 });
  }
  const v = new THREE.Vector3();
  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t;
    const isl = out[label[i0]];
    isl.tris.push(t / 3);
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t + k) : t + k;
      v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      isl.box.expandByPoint(v);
      isl.centre.add(v);
      isl.verts++;
    }
  }
  const kept = [];
  for (const isl of out) {
    if (!isl.tris.length) continue;
    isl.centre.divideScalar(isl.verts);
    kept.push(isl);
  }
  return kept;
}

/**
 * Gather islands into wheel units.
 *
 * Left and right are split by the sign of the centroid's x — no road wheel
 * straddles the centreline — and then each side is clustered along z by single
 * linkage. `link` is the gap that separates two axles; the default is a
 * fraction of the tyre diameter, which is the only length in the problem that
 * scales with the vehicle. A twinned pair stays one unit, which is what we
 * want: it turns as one and it is drawn as one.
 *
 * Anything that is not round in side elevation is dropped. Axle beams,
 * driveshafts, landing legs and the spare lashed flat under the bed all share
 * the wheel materials on real models, and all of them fail this test.
 */
export function groupWheels(islands, opts = {}) {
  if (!islands.length) return [];
  const dia = opts.diameter || Math.max(...islands.map(i => {
    const s = i.box.getSize(new THREE.Vector3());
    return Math.min(s.y, s.z);
  }));
  const link = opts.link ?? dia * 0.42;
  const minSize = opts.minSize ?? dia * 0.35;

  const units = [];
  for (const side of [-1, 1]) {
    const mine = islands.filter(i => Math.sign(i.centre.x) === side)
      .sort((a, b) => a.centre.z - b.centre.z);
    let cur = null;
    for (const isl of mine) {
      if (cur && isl.centre.z - cur.lastZ <= link) {
        cur.islands.push(isl); cur.box.union(isl.box); cur.lastZ = isl.centre.z;
      } else {
        cur = { islands: [isl], box: isl.box.clone(), lastZ: isl.centre.z, side };
        units.push(cur);
      }
    }
  }

  const out = [];
  for (const u of units) {
    const s = u.box.getSize(new THREE.Vector3());
    const c = u.box.getCenter(new THREE.Vector3());
    /* Round in side elevation, and standing up rather than lying down. A wheel
       is as tall as it is long; a spare on its side is as wide as it is long. */
    const round = Math.min(s.y, s.z) > Math.max(s.y, s.z) * 0.82;
    if (!round || s.y < minSize || s.y < s.x * 0.9) continue;
    out.push({
      islands: u.islands, box: u.box, centre: c,
      radius: (s.y + s.z) / 4, width: s.x, side: u.side,
    });
  }
  out.sort((a, b) => b.centre.z - a.centre.z || a.centre.x - b.centre.x);
  return out;
}

/**
 * Build a geometry from a subset of another one's triangles, keeping every
 * attribute. `tris` is a list of triangle indices, as `wheelIslands` returns.
 */
export function trianglesToGeometry(geo, tris) {
  const idx = geo.index;
  const names = Object.keys(geo.attributes);
  const remap = new Map();
  const order = [];
  const out = new Uint32Array(tris.length * 3);
  let w = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      let n = remap.get(vi);
      if (n === undefined) { n = order.length; remap.set(vi, n); order.push(vi); }
      out[w++] = n;
    }
  }
  const g = new THREE.BufferGeometry();
  for (const name of names) {
    const a = geo.attributes[name];
    const k = a.itemSize;
    const arr = new Float32Array(order.length * k);
    for (let i = 0; i < order.length; i++) {
      const src = order[i];
      if (k > 0) arr[i * k] = a.getX(src);
      if (k > 1) arr[i * k + 1] = a.getY(src);
      if (k > 2) arr[i * k + 2] = a.getZ(src);
      if (k > 3) arr[i * k + 3] = a.getW(src);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  g.setIndex(new THREE.BufferAttribute(out, 1));
  return g;
}

/**
 * The yaw from `squareYaw`, snapped to a right angle when it is within
 * `tolDeg` of one.
 *
 * A minimum-area rectangle is exact but it is fitted to the whole silhouette,
 * so an asymmetric detail — a mirror arm, an exhaust stack, a spare slung on
 * one side — drags it a degree or two off true on a model that was in fact
 * exported axis-aligned.
 *
 * This used to say a degree did not matter on a car, and that was wrong. The
 * wheels sit square on the rig while the body carries the error, so the two
 * axles are displaced in *opposite* directions: at 3 degrees on a 2.9 m
 * wheelbase each moves about 7.6 cm, and the 15 cm of stagger reads
 * immediately as front wheels pushed one way and rear wheels the other. The
 * M5, the RS6 and the AMG all came in between 2.3 and 3.1 degrees off square
 * and all three showed it; the 930, at 0.1 degrees, did not.
 */
export function squaredYaw(geos, tolDeg = 3) {
  const raw = squareYaw(geos);
  const step = Math.PI / 2;
  const snapped = Math.round(raw / step) * step;
  return Math.abs(raw - snapped) <= tolDeg * Math.PI / 180 ? snapped : raw;
}
