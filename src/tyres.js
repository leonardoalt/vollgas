/* ==========================================================================
   tyres.js — chassis geometry and the lateral tyre model.

   The longitudinal model in vehicles.js is a power-limited point mass and it
   stays that way: every 0-100, top speed and braking figure in dev/phys.mjs
   comes out of stepLong() and nothing here touches it.

   What lives here is everything the *lateral* model needs to stop being a
   kinematic slide and start being a car: where the mass sits, how much of it
   each axle carries, how much the body resists rotating, and how much side
   force a tyre makes for a given slip angle once you have already spent part
   of its grip going forwards or stopping.
   ========================================================================== */

const G = 9.81;

/* --------------------------------------------------------------- the table
   Per-car handling character. Only the four cars you drive have entries:
   traffic and patrol cars run the cheap kinematic lateral model (they are
   seen from outside, at distance, and their AI is tuned around it), so they
   fall through to the derived defaults and never actually use them.

     wdF       fraction of kerb weight on the front axle
     hCog      centre-of-gravity height, m
     di        dynamic index, Iz / (m·a·b) — how reluctant the car is to rotate
     rearDrive fraction of drive torque going to the rear axle
     csF/csR   cornering stiffness per axle, normalised: Cα = cs · Fz  [1/rad]
               the front/rear difference *is* the understeer gradient,
               K = (1/csF - 1/csR)/g
     rollF     share of the roll couple carried by the front axle; more front
               means more front lateral load transfer, means more understeer

   Figures are the reference cars' published weight distributions where they
   exist (911 Turbo S 39/61, C 63 S 53/47, RS6 Avant 56/44, M5 CS 52/48) and
   plausible for the rest.
   -------------------------------------------------------------------------- */
const TUNE = {
  /* Rear-engined, rear-biased AWD. Very little steady-state understeer, huge
     rear traction, and a front axle that goes light the moment you get on the
     power — the classic 911 trade. */
  turbo: { wdF: 0.39, hCog: 0.46, di: 0.90, rearDrive: 0.80, csF: 10.6, csR: 12.3, rollF: 0.51 },
  /* Rear-biased M xDrive saloon: neutral-ish, tidy, mild understeer. */
  m5:    { wdF: 0.52, hCog: 0.52, di: 1.02, rearDrive: 0.74, csF:  9.3, csR: 12.4, rollF: 0.57 },
  /* 2.1 t nose-heavy estate on 40:60 quattro. Runs wide, and the README says
     so: the most understeer of the four, and the most to lose from it. */
  rs6:   { wdF: 0.56, hCog: 0.57, di: 1.09, rearDrive: 0.60, csF:  8.4, csR: 12.6, rollF: 0.63 },
  /* The outlier: rear-wheel drive. Every newton of traction is spent out of
     the rear tyres' grip budget, so the back steps out on the throttle and
     you catch it with opposite lock. */
  amg:   { wdF: 0.53, hCog: 0.51, di: 1.00, rearDrive: 1.00, csF:  9.6, csR: 11.1, rollF: 0.54 },
};

/* How much peak grip a tyre loses as vertical load is transferred onto it.
   Small on purpose: this is a balance knob, not a grip nerf. At full lateral
   it costs about 4 % of cornering grip. */
const LOAD_SENS = 0.13;

/* Locked rear axle. stepLong() already provides the ~0.5 g of retardation and
   is not touched; this is the lateral half of the handbrake, applied to the
   rear axle only, because that is the axle that is locked. Together with the
   rear friction circle eating the handbrake's own longitudinal force it lands
   near the documented ~42 % loss of cornering grip — but delivered as a car
   that pivots rather than one that uniformly slides. */
export const HAND_LAT_CUT = 0.20;

const X_PEAK = 0.71;
const CURVE_C = 1.45;
const CURVE_B = 2.6;

const cache = new WeakMap();

/** Geometry, inertia and tyre parameters for a car. Memoised per spec. */
export function chassis(spec, id) {
  let byId = cache.get(spec);
  if (byId && byId[id || '-']) return byId[id || '-'];
  if (!byId) { byId = {}; cache.set(spec, byId); }

  const p = spec.perf;
  const t = TUNE[id] || {};
  const axF = spec.axleF ?? 1.4, axR = spec.axleR ?? -1.4;
  const L = Math.max(1.6, axF - axR);
  const wdF = t.wdF ?? (p.awd ? 0.55 : 0.56);
  const b = L * wdF;                 // CoG -> rear axle
  const a = L - b;                   // CoG -> front axle
  const hCog = t.hCog ?? 0.52 * ((spec.dims?.height ?? 1.45) / 1.45);
  const track = ((spec.trackF ?? 1.6) + (spec.trackR ?? 1.6)) / 2;
  const csF = t.csF ?? 9.4, csR = t.csR ?? 11.6;

  const out = {
    L, a, b, hCog, track,
    mass: p.mass,
    iz: (t.di ?? 1.0) * p.mass * a * b,
    staticF: p.mass * G * wdF,
    staticR: p.mass * G * (1 - wdF),
    mu: p.grip,
    csF, csR,
    rollF: t.rollF ?? 0.58,
    rearDrive: t.rearDrive ?? (p.awd ? 0.60 : 1.0),
    /* understeer gradient, rad per m/s² — used by the lane-keeping assist to
       work out how much lock a given lateral acceleration actually needs */
    kus: (1 / csF - 1 / csR) / G,
    ayMax: p.grip * G,
    /* Steering lock available, see steerLock(). */
    dPark: 0.52,
    dOver: 1.15,
    dCatch: 0.030,
    /* slip angle at which each axle makes peak force, for the tyre-noise cue */
    peakF: X_PEAK * p.grip / csF,
    peakR: X_PEAK * p.grip / csR,
  };
  byId[id || '-'] = out;
  return out;
}

/* -------------------------------------------------------------- tyre curve
   A saturating slip-angle curve of the sin(C·atan(B·x)) family, i.e. the
   shape of a Pacejka lateral fit with the load and camber terms thrown away.
   x is slip normalised by the grip available, so the *shape* is load
   independent and only the peak scales — which is what lets combined slip
   fall out of a single scalar mu.

     rises to the peak at x = 0.71   (≈ 4.5-6.5° depending on the axle)
     settles at 0.76 of peak far out (a tyre past its best, not a cliff)
   -------------------------------------------------------------------------- */
/** Normalised lateral force fraction (0..1) for a normalised slip x. */
export function curve(x) {
  return Math.sin(CURVE_C * Math.atan(CURVE_B * x));
}

/**
 * Lateral force for one axle.
 * @param alpha slip angle, rad (positive = velocity to the right of the wheel)
 * @param fz    vertical load on the axle, N
 * @param mu    peak friction available *after* combined slip and load effects
 * @param cs    normalised cornering stiffness, 1/rad
 * @returns force in N, positive to the right of the car
 */
export function axleFy(alpha, fz, mu, cs) {
  if (fz <= 1 || mu <= 0.01) return 0;
  return -mu * fz * curve(cs * alpha / mu);
}

/**
 * Friction circle for one axle: what is left for cornering once `fx` newtons
 * of the axle's grip are already spent driving or braking.
 */
export function muLeft(mu, fx, fz) {
  if (fz <= 1) return 0;
  const used = fx / fz;
  return Math.sqrt(Math.max(0.0025, mu * mu - used * used));
}

/* ------------------------------------------------------------ steering lock
   How much road-wheel angle the driver has at a given speed.

   The old model let the rack ask for anything and then hard-clamped the steer
   angle to whatever the friction circle allowed. That is why full lock always
   produced exactly maximum cornering, instantly, at any speed above about
   100 km/h — the single biggest reason the car felt like it was being pushed
   sideways by a script rather than steered.

   Nothing is clamped now; the tyres decide. Instead the lock available is
   scaled to the lock the car actually *needs*, from its own wheelbase, grip
   and understeer gradient:

     delta_limit(v) = L·ayMax/v² + kus·ayMax     lock for maximum cornering

   Full lock is dOver times that, plus dCatch of authority that is always
   there for corrections, so:

     · full lock over-drives the front axle by roughly two to one, which means
       greed is punished with understeer instead of rewarded with grip;
     · there is always enough lock left to catch the back end;
     · an understeering car (the estate) gets more lock than a neutral one
       (the 911), because it genuinely needs more for the same corner;
     · with a binary keyboard, a short tap lands somewhere useful rather than
       either nothing or everything.
   -------------------------------------------------------------------------- */
export function steerLock(ch, v) {
  const vv = Math.max(4, v);
  const need = ch.L * ch.ayMax / (vv * vv) + ch.kus * ch.ayMax;
  return Math.min(ch.dPark, ch.dOver * need + ch.dCatch);
}

/**
 * Peak-grip loss from lateral load transfer on one axle. `share` is that
 * axle's share of the roll couple.
 */
export function loadMul(ay, fz, mass, hCog, track, share) {
  if (fz <= 1) return 1;
  const dFz = mass * ay * hCog / Math.max(0.8, track) * share;
  const ratio = Math.min(1, Math.abs(2 * dFz / fz));
  return 1 - LOAD_SENS * ratio * ratio;
}
