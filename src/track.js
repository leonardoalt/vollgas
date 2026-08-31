/* ==========================================================================
   track.js — the Bundesautobahn 81, Stuttgart → Singen (Bodensee)
   --------------------------------------------------------------------------
   The real A81 runs ~165 km from the Autobahnkreuz Stuttgart down through the
   Neckar valley, over the eastern edge of the Schwarzwald / onto the Baar
   plateau at Rottweil, and out into the Hegau with its volcanic cones before
   reaching Singen and the Swiss border. We compress that into a 42 km stage
   but keep the running order, the place names, the real speed regime (long
   unrestricted stretches broken by 120/100 zones, the Engelbergtunnel, and a
   Baustelle near Empfingen) and the landmarks you can actually see from the
   car — Porsche in Zuffenhausen, the Mercedes plant at Sindelfingen, the
   Neckarburg services, the thyssenkrupp test tower at Rottweil.

   The whole world is parameterised by arc length `s` (metres from the
   Autobahnkreuz) and a signed lateral offset `u` (metres, +u = right of the
   direction of travel, u = 0 is the middle of the Mittelstreifen). Every
   vehicle, sign and tree lives in (s, u) and is projected to world XYZ, which
   makes the AI, the traffic lanes and the collision tests one-dimensional
   while the road still bends and rolls like the real thing.
   ========================================================================== */

export const SEG = 8;                    // sampling step along the centreline

/* Stage length. The real A81 is ~165 km; the section table below is written
   on a 42 km scale and then squeezed into STAGE_KM so a run is a sensible
   length to sit through. Raise it for a longer stage — everything (sections,
   elevation profile, signage, landmarks, speed cameras) scales with it. */
export const STAGE_KM = 26;
const TABLE_KM = 42;
const KSCALE = STAGE_KM / TABLE_KM;

export const LENGTH = STAGE_KM * 1000;
export const N = Math.floor(LENGTH / SEG) + 1;

/* ---------------------------------------------------------- cross section
   German Autobahn (RAA, RQ 31): 2 x 2 lanes with hard shoulders.
   u:  0.0 .. 2.0   Mittelstreifen (double steel barrier down the middle)
       2.0 .. 2.5   Randstreifen (inner edge strip)
       2.5 .. 6.25  linker Fahrstreifen  (the fast lane)
       6.25.. 10.0  rechter Fahrstreifen (trucks live here)
      10.0 .. 12.5  Seitenstreifen (hard shoulder — where the Blitzer parks)
   Negative u mirrors it for the oncoming carriageway.                      */
export const GEO = {
  medianHalf:   2.0,
  edgeStrip:    0.5,
  laneWidth:    3.75,
  shoulder:     2.5,
  get pavedIn()  { return this.medianHalf; },
  get pavedOut() { return this.medianHalf + this.edgeStrip + 2 * this.laneWidth + this.shoulder; }, // 12.5
  get laneL()    { return this.medianHalf + this.edgeStrip + this.laneWidth * 0.5; },  // 4.375
  get laneR()    { return this.laneL + this.laneWidth; },                              // 8.125
  get kerbOut()  { return this.medianHalf + this.edgeStrip + 2 * this.laneWidth; },     // 10.0
};
export const LANES = [GEO.laneL, GEO.laneR];  // [0] = left/fast, [1] = right

/* ------------------------------------------------------------------ biomes */
export const BIOME = {
  URBAN:    'urban',      // Stuttgart basin: noise walls, industry, halls
  VINEYARD: 'vineyard',   // Neckar slopes above Zuffenhausen / Rottenburg
  FOREST:   'forest',     // eastern Schwarzwald spruce
  FARM:     'farm',        // Gäu wheat and rapeseed
  ALB:      'alb',        // Baar plateau: open, wind turbines, limestone
  HEGAU:    'hegau',      // volcanic cones before Singen
};

/* ------------------------------------------------------- section programme
   limit: number = posted Streckenverbot (km/h)
          null   = "Ende aller Streckenverbote" — unrestricted
   advice: true  = blue Richtgeschwindigkeit 130 sign instead of a red one  */
export const SECTIONS = [
  { km:  0.0, name:'Stuttgart-Zuffenhausen',   sub:'Porsche-Werk · Autobahnkreuz', subEn:'Porsche works · motorway interchange', limit:100, biome:BIOME.URBAN,    curve:0.9, exit:'Zuffenhausen' },
  { km:  2.2, name:'Stuttgart-Feuerbach',      sub:'Ausfahrt 21', subEn:'Exit 21',                  limit:120, biome:BIOME.URBAN,    curve:1.0 },
  { km:  3.8, name:'Engelbergbasistunnel',     sub:'Leonberg · Tunnelstrecke', subEn:'Leonberg · tunnel',     limit:100, biome:BIOME.URBAN,    curve:0.25, tunnel:true },
  { km:  6.0, name:'Leonberg',                 sub:'Ausfahrt 20', subEn:'Exit 20',                  limit:120, biome:BIOME.VINEYARD, curve:1.1, exit:'Leonberg' },
  { km:  8.2, name:'Sindelfingen-Ost',         sub:'Mercedes-Benz Werk', subEn:'Mercedes-Benz plant',           limit:120, biome:BIOME.URBAN,    curve:0.8, exit:'Sindelfingen' },
  { km: 10.6, name:'Böblingen-Hulb',           sub:'Ende aller Streckenverbote', subEn:'All restrictions end',   limit:null, biome:BIOME.FARM,    curve:0.6 },
  { km: 14.0, name:'Herrenberg',               sub:'Freie Fahrt · Gäu', subEn:'No limit · the Gäu',            limit:null, biome:BIOME.FARM,    curve:0.5, exit:'Herrenberg' },
  { km: 18.2, name:'Rottenburg · Neckartal',   sub:'Richtgeschwindigkeit 130', subEn:'Advisory 130',     limit:null, advice:true, biome:BIOME.VINEYARD, curve:1.4 },
  { km: 21.2, name:'Horb am Neckar',           sub:'Kurvige Talstrecke', subEn:'Winding valley section',           limit:120, biome:BIOME.FOREST,   curve:1.9, exit:'Horb' },
  { km: 23.6, name:'Empfingen',                sub:'Baustelle · verengte Fahrbahn', subEn:'Roadworks · narrow lanes',limit: 80, biome:BIOME.FOREST,   curve:0.7, works:true },
  { km: 26.2, name:'Oberndorf am Neckar',      sub:'Ende aller Streckenverbote', subEn:'All restrictions end',   limit:null, biome:BIOME.FOREST,  curve:1.2, exit:'Oberndorf' },
  { km: 28.6, name:'Raststätte Neckarburg',    sub:'Tank & Rast · Neckartalbrücke', subEn:'Services · Neckar viaduct',limit:null, biome:BIOME.FOREST,  curve:0.8, rest:true },
  { km: 31.0, name:'Rottweil',                 sub:'thyssenkrupp Testturm', subEn:'thyssenkrupp test tower',        limit:null, biome:BIOME.ALB,     curve:0.7, tower:true, exit:'Rottweil' },
  { km: 34.0, name:'Villingen-Schwenningen',   sub:'Baar-Hochfläche', subEn:'The Baar plateau',              limit:120, biome:BIOME.ALB,      curve:1.0, exit:'VS-Mitte' },
  { km: 36.4, name:'Geisingen',                sub:'Ende aller Streckenverbote', subEn:'All restrictions end',   limit:null, biome:BIOME.ALB,     curve:0.9 },
  { km: 39.2, name:'Engen · Hegau',            sub:'Vulkankegel', subEn:'Volcanic cones',                  limit:120, biome:BIOME.HEGAU,    curve:1.3, exit:'Engen' },
  { km: 41.0, name:'Singen (Bodensee)',        sub:'Zielgerade', subEn:'Final run to the finish',                   limit:100, biome:BIOME.HEGAU,    curve:0.8 },
];

/* Squeeze the table onto the actual stage length. */
for (const sec of SECTIONS) sec.km = +(sec.km * KSCALE).toFixed(4);

/* ------------------------------------------------------ elevation skeleton
   metres above sea level at the given km — Stuttgart basin ~300 m, up onto
   the Baar at ~700 m, then the drop into the Hegau.                        */
const PROFILE = [
  [0, 300], [3, 340], [6, 420], [9, 460], [13, 470], [17, 430],
  [21, 400], [25, 470], [29, 560], [32, 620], [35, 700], [38, 655],
  [40, 560], [42, 470],
];

/* ------------------------------------------------------------------ random */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = mulberry32(0x81A81);

/** smooth 1-D value noise, wavelength in metres */
function noiseField(seed, wavelength, count) {
  const r = mulberry32(seed);
  const knots = new Float32Array(count + 4);
  for (let i = 0; i < knots.length; i++) knots[i] = r() * 2 - 1;
  return (s) => {
    const t = s / wavelength;
    const i = Math.floor(t);
    const f = t - i;
    const a = knots[(i + 1) % count], b = knots[(i + 2) % count];
    const h = f * f * (3 - 2 * f);              // smoothstep
    return a + (b - a) * h;
  };
}

function lerpProfile(stageKm) {
  const km = stageKm / KSCALE;              // PROFILE is on the table scale
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [k0, y0] = PROFILE[i], [k1, y1] = PROFILE[i + 1];
    if (km <= k1) {
      const t = Math.max(0, Math.min(1, (km - k0) / (k1 - k0)));
      return y0 + (y1 - y0) * (t * t * (3 - 2 * t));
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/* ==========================================================================
   Build the centreline. Curvature is integrated into a heading, the heading
   into a position — exactly how a real alignment is staked out.
   ========================================================================== */
export const track = {
  x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N),
  head: new Float32Array(N), curv: new Float32Array(N), grade: new Float32Array(N),
  sectionIdx: new Uint8Array(N),
};

export function sectionAtKm(km) {
  let idx = 0;
  for (let i = 0; i < SECTIONS.length; i++) if (km >= SECTIONS[i].km) idx = i;
  return idx;
}

/** in-place box blur of a Float32Array, radius in samples */
function blur(arr, radius, passes = 2) {
  const n = arr.length, tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let j = i - radius; j <= i + radius; j++) {
        const k = j < 0 ? 0 : j >= n ? n - 1 : j;
        sum += arr[k]; cnt++;
      }
      tmp[i] = sum / cnt;
    }
    arr.set(tmp);
  }
}

(function buildTrack() {
  const nBig  = noiseField(11, 1500, 512);   // long sweeping bends
  const nMid  = noiseField(23,  520, 512);   // valley wiggles
  const nHill = noiseField(37,  430, 512);   // rolling terrain over the profile

  // --- per-sample section index, curviness and "flat" (tunnel/works) factors
  const cf = new Float32Array(N);
  const flat = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const km = (i * SEG) / 1000;
    const si = sectionAtKm(km);
    track.sectionIdx[i] = si;
    cf[i] = SECTIONS[si].curve;
    flat[i] = SECTIONS[si].tunnel ? 0.12 : 1;   // a bored tunnel is nearly level
  }
  blur(cf, 45, 2);      // ~360 m crossfade between sections, no kinks
  blur(flat, 40, 2);

  // --- alignment: integrate curvature -> heading -> position
  let theta = 0, x = 0, z = 0;
  for (let i = 0; i < N; i++) {
    const s = i * SEG;
    // ~800 m minimum radius: a real Autobahn figure, and enough that a
    // 300 km/h sweep genuinely asks something of the tyres
    const k = (nBig(s) * 0.85 + nMid(s) * 0.42) * 0.00152 * Math.max(0.18, cf[i]);
    track.curv[i] = k;
    track.head[i] = theta;
    track.x[i] = x; track.z[i] = z;
    track.y[i] = (lerpProfile(s / 1000) - 300) + nHill(s) * 7.5 * flat[i];
    theta += k * SEG;
    x += Math.sin(theta) * SEG;
    z += Math.cos(theta) * SEG;
  }

  // --- keep every grade drivable (German Autobahn: 4 % is already a lot)
  const MAXG = 0.042, step = MAXG * SEG;
  for (let p = 0; p < 4; p++) {
    for (let i = 1; i < N; i++) {
      const d = track.y[i] - track.y[i - 1];
      if (Math.abs(d) > step) track.y[i] = track.y[i - 1] + Math.sign(d) * step;
    }
    for (let i = N - 2; i >= 0; i--) {
      const d = track.y[i] - track.y[i + 1];
      if (Math.abs(d) > step) track.y[i] = track.y[i + 1] + Math.sign(d) * step;
    }
  }
  blur(track.y, 4, 2);   // round off the crests the clamp left behind

  // --- finite-difference grade (drives engine load and the car's pitch)
  for (let i = 0; i < N; i++) {
    const a = track.y[Math.max(0, i - 1)], b = track.y[Math.min(N - 1, i + 1)];
    track.grade[i] = (b - a) / (2 * SEG);
  }
})();

/* --------------------------------------------------------------- accessors */
const _tmp = { x: 0, y: 0, z: 0, head: 0, curv: 0, grade: 0 };

/** Interpolated centreline sample at arc length s (metres). */
export function sample(s, out = _tmp) {
  const t = Math.max(0, Math.min(LENGTH - 0.001, s)) / SEG;
  const i = Math.min(N - 2, Math.floor(t));
  const f = t - i;
  out.x = track.x[i] + (track.x[i + 1] - track.x[i]) * f;
  out.y = track.y[i] + (track.y[i + 1] - track.y[i]) * f;
  out.z = track.z[i] + (track.z[i + 1] - track.z[i]) * f;
  out.head = track.head[i] + (track.head[i + 1] - track.head[i]) * f;
  out.curv = track.curv[i] + (track.curv[i + 1] - track.curv[i]) * f;
  out.grade = track.grade[i] + (track.grade[i + 1] - track.grade[i]) * f;
  return out;
}

/** Unit vector pointing right of travel (screen-right when driving). */
export function rightOf(head, out = { x: 0, z: 0 }) {
  out.x = -Math.cos(head); out.z = Math.sin(head);
  return out;
}
export function forwardOf(head, out = { x: 0, z: 0 }) {
  out.x = Math.sin(head); out.z = Math.cos(head);
  return out;
}

/** (s,u) → world position. Writes into `out` {x,y,z}. */
export function toWorld(s, u, out = { x: 0, y: 0, z: 0 }) {
  const c = sample(s);
  const rx = -Math.cos(c.head), rz = Math.sin(c.head);
  out.x = c.x + rx * u;
  out.y = c.y;
  out.z = c.z + rz * u;
  return out;
}

export function sectionAt(s) { return SECTIONS[track.sectionIdx[Math.max(0, Math.min(N - 1, Math.round(s / SEG)))]]; }

/** The legally binding limit at s, in km/h; Infinity where unrestricted. */
export function limitAt(s) {
  const sec = sectionAt(s);
  return sec.limit == null ? Infinity : sec.limit;
}

/* ------------------------------------------------------------- Auffahrt
   You join the A81 from the slip road at Zuffenhausen rather than being
   dropped into a running lane. The ramp runs beside the carriageway and its
   taper closes onto the edge line, so the merge is yours to make. */
export const ENTRY_LEN = 340;

/** Edges and centre of the entry slip road at s, or null once it has merged. */
export function entryRamp(s) {
  if (s < -20 || s > ENTRY_LEN) return null;
  const p = Math.min(1, Math.max(0, s) / ENTRY_LEN);
  const inner = GEO.kerbOut + (GEO.pavedOut - GEO.kerbOut) * (1 - p);   // 12.5 → 10.0
  const width = 4.9 * Math.pow(1 - p, 0.75);
  return { inner, outer: inner + width, centre: inner + width * 0.5, width };
}

/** Drivable half-width of our carriageway including the shoulder and any ramp. */
export function pavedRange(s) {
  const sec = sectionAt(s);
  // A Baustelle narrows the lanes and takes the shoulder away
  const r = sec.works ? { inner: GEO.pavedIn + 0.4, outer: GEO.kerbOut - 0.9 }
                      : { inner: GEO.pavedIn, outer: GEO.pavedOut };
  const e = entryRamp(s);
  if (e && e.width > 0.2) r.outer = Math.max(r.outer, e.outer);
  return r;
}

/** Lateral position of the outer crash barrier — pushed out around the ramp. */
export function outerBarrier(s) {
  const e = entryRamp(s);
  return (e && e.width > 0.2 ? e.outer + 1.3 : GEO.pavedOut) + 0.45;
}

export const totalKm = LENGTH / 1000;
