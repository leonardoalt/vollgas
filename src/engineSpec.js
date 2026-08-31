/* ==========================================================================
   engineSpec.js — what makes a flat-six not a V8.

   A four-stroke fires every cylinder once per two crank revolutions, so the
   engine cycle is 720° long and repeats at

       f_cycle = rpm / 120     Hz          (the "half order")

   and the mean firing rate is

       f_fire  = rpm / 60 * cylinders / 2  Hz  = f_cycle * cylinders.

   The interesting part is not the mean rate, it is *which* pulses come out of
   *which* pipe. Exhaust is collected per bank, so each bank radiates its own
   pulse train, and the spacing of that train is what your ear reads as engine
   character:

     flat-six (911)        even 120° overall; each bank fires evenly every 240°.
                           Both trains are periodic at 3·f_cycle → a clean
                           harmonic series on the third order. Smooth, hard,
                           slightly nasal.

     cross-plane V8        even 90° overall — but the 90° crank throws mean each
     (M5, RS6, AMG)        bank fires at 90-180-270-180° intervals. An uneven
                           train is *not* periodic at 4·f_cycle, so each bank's
                           spectrum contains half-order and 1.5-order partials
                           (0.5, 1, 1.5, 2 … × f_cycle). Two pipes each full of
                           odd half-orders, slightly detuned by unequal pipe
                           length, is exactly the American burble. This is the
                           whole reason a cross-plane V8 sounds lumpy.

     flat-plane V8         180° crank: each bank fires evenly every 180°, so the
                           half-orders vanish and you get a pure 4th-order
                           scream. (Not used by any car here — kept because it
                           is the control case that proves the model.)

     inline-4              one bank, even 180°: second order, thin and buzzy.

     inline-6 diesel       even 120°, one bank, long pipe, hard short pulses.

   Bank firing angles below are derived from real firing orders:
     flat-six  1-6-2-4-3-5   banks {1,2,3} and {4,5,6}
     X-plane   1-8-7-2-6-5-4-3   banks {1,3,5,7} and {2,4,6,8}
     flat-pl.  1-8-7-3-6-5-4-2   same banks
   ========================================================================== */

/** Firing angles per bank, in crank degrees over the 720° cycle. */
const BANKS = {
  flat6: [[0, 240, 480], [120, 360, 600]],
  // 90-180-270-180 on each bank: the lumpy one
  v8cross: [[0, 180, 450, 630], [90, 270, 360, 540]],
  v8flat: [[0, 180, 360, 540], [90, 270, 450, 630]],
  inline4: [[0, 180, 360, 540]],
  inline6: [[0, 240, 480], [120, 360, 600]],
  inline3: [[0, 240, 480]],
};

/**
 * An engine voice.
 *   banks     firing angles per bank (crank degrees, 0..720)
 *   pipe      exhaust length per bank in metres. A quarter-wave resonator of
 *             length L peaks at (2n-1)·c/4L, c = 343 m/s — so 2.2 m gives
 *             39/117/195 Hz, which is the body of the note. Unequal lengths
 *             between banks put a slow beat in the burble.
 *   damp      loop damping of the pipe (0..1, higher = duller pipe)
 *   refl      tailpipe reflection magnitude (0..0.75). Open end inverts.
 *   tau       combustion pulse decay in ms at 3000 rpm; scales with 1/rpm.
 *   rasp      waveshaper drive: how hard the note breaks up under load.
 *   intake    level of the intake path (induction honk, bandpassed and
 *             throttle-gated — an airbox is only loud with the throttle open).
 *   intakeF   intake resonance in Hz (plenum Helmholtz, ~120-260 Hz).
 *   turbo     0 = naturally aspirated, else level of spool whistle.
 *   crackle   probability that an overrun cycle lights off in the exhaust.
 *   idle      idle rpm.
 *   jitter    cycle-to-cycle amplitude scatter, 0..1. Real engines are never
 *             twice the same; without this it sounds like an organ.
 *   body      overall level trim.
 */
export const ENGINES = {
  /* ------------------------------------------------- the four you can drive */
  flat6tt: {
    banks: BANKS.flat6, cyl: 6,
    pipe: [1.62, 1.55], damp: 0.44, refl: 0.55,
    tau: 1.05, rasp: 1.7, intake: 0.80, intakeF: 220,
    turbo: 0.85, boostF: [1100, 5200], crackle: 0.22,
    idle: 820, jitter: 0.13, body: 1.0,
    formants: [[190, 6.5, 3.5], [780, 2.2, 2.5], [2350, 1.6, 3.0]],
    notch: 330,
  },
  v8tt44: {                                   // 4.4 twin-turbo, cross-plane
    banks: BANKS.v8cross, cyl: 8,
    pipe: [2.35, 2.18], damp: 0.52, refl: 0.62,
    tau: 1.45, rasp: 1.35, intake: 0.42, intakeF: 150,
    turbo: 0.62, boostF: [900, 4200], crackle: 0.26,
    idle: 700, jitter: 0.16, body: 1.06,
    formants: [[118, 7.5, 5.0], [520, 2.0, 2.2], [1750, 1.4, 1.8]],
    notch: 245,
  },
  v8tt40: {                                   // 4.0 hot-V twin-turbo, estate
    banks: BANKS.v8cross, cyl: 8,
    pipe: [2.55, 2.42], damp: 0.60, refl: 0.58,
    tau: 1.55, rasp: 1.15, intake: 0.34, intakeF: 138,
    turbo: 0.74, boostF: [850, 3900], crackle: 0.18,
    idle: 700, jitter: 0.15, body: 0.98,
    formants: [[105, 7.0, 4.6], [470, 1.9, 1.9], [1500, 1.3, 1.4]],
    notch: 210,
  },
  v8na40: {                                   // 4.0 V8, no turbo: the loud one
    banks: BANKS.v8cross, cyl: 8,
    pipe: [2.05, 1.92], damp: 0.34, refl: 0.70,
    tau: 1.15, rasp: 2.15, intake: 0.72, intakeF: 168,
    turbo: 0, boostF: [0, 0], crackle: 0.52,
    idle: 660, jitter: 0.18, body: 1.14,
    formants: [[132, 8.0, 5.6], [610, 2.4, 3.2], [2050, 1.7, 2.8]],
    notch: 275,
  },

  /* ------------------------------------------------------------ everyone else */
  diesel6: {                                  // Sattelzug: inline-six, 2200 rpm
    banks: BANKS.inline6, cyl: 6,
    pipe: [3.4], damp: 0.72, refl: 0.45,
    tau: 0.55, rasp: 1.05, intake: 0.20, intakeF: 95,
    turbo: 0.55, boostF: [400, 1500], crackle: 0,
    idle: 560, jitter: 0.24, body: 1.2,
    formants: [[78, 6.0, 5.0], [340, 2.0, 2.4], [1250, 2.6, 2.2]],
    notch: 160,
  },
  diesel4: {                                  // taxis, vans, the Messwagen
    banks: BANKS.inline4, cyl: 4,
    pipe: [3.1], damp: 0.74, refl: 0.40,
    tau: 0.5, rasp: 1.0, intake: 0.14, intakeF: 110,
    turbo: 0.5, boostF: [600, 2400], crackle: 0,
    idle: 720, jitter: 0.26, body: 0.9,
    formants: [[112, 5.0, 4.0], [420, 2.2, 2.0], [1450, 2.8, 2.4]],
    notch: 210,
  },
  four: {                                     // ordinary traffic
    banks: BANKS.inline4, cyl: 4,
    pipe: [2.9], damp: 0.66, refl: 0.42,
    tau: 1.10, rasp: 1.0, intake: 0.30, intakeF: 175,
    turbo: 0.22, boostF: [1200, 3600], crackle: 0,
    idle: 780, jitter: 0.14, body: 0.72,
    formants: [[165, 4.0, 2.6], [640, 1.8, 1.6], [1900, 1.5, 1.2]],
    notch: 300,
  },
  six: {                                      // patrol cars, bigger saloons
    banks: BANKS.inline6, cyl: 6,
    pipe: [2.6], damp: 0.56, refl: 0.50,
    tau: 1.20, rasp: 1.2, intake: 0.40, intakeF: 165,
    turbo: 0.45, boostF: [1000, 4000], crackle: 0.10,
    idle: 720, jitter: 0.14, body: 0.88,
    formants: [[150, 5.0, 3.2], [600, 1.9, 1.9], [1850, 1.4, 1.5]],
    notch: 280,
  },
};

/** Which engine sits in which car. Keys are `CARS` ids from carFactory.js. */
export const CAR_ENGINE = {
  // the four you drive
  turbo: 'flat6tt',
  m5: 'v8tt44',
  rs6: 'v8tt40',
  amg: 'v8na40',
  // traffic
  kombi: 'four',
  hatch: 'four',
  taxi: 'diesel4',            // 9-speed, 145 kW: an oil-burning E-Klasse
  van: 'diesel4',
  truck: 'diesel6',
  // enforcement
  zivi_limo: 'six',
  zivi_touring: 'six',
  zivi_avant: 'six',
  zivi_kompakt: 'six',
  messwagen: 'diesel4',
};

/** Fallback for any car id not named above (traffic gets a plain four). */
export function engineFor(carId) {
  return ENGINES[CAR_ENGINE[carId] || 'four'] || ENGINES.four;
}

/**
 * Mean firing frequency in Hz for a four-stroke.
 * rpm/60 revolutions per second, one firing per cylinder per two revolutions.
 */
export function fireHz(rpm, cyl) { return (rpm / 60) * (cyl / 2); }

/** Engine-cycle (half-order) frequency in Hz: one full 720° cycle. */
export function cycleHz(rpm) { return rpm / 120; }

/**
 * One 720° cycle of a bank's exhaust pressure, sampled at `m` points.
 * Each firing contributes a pulse that rises in ~8% of its decay time and then
 * decays exponentially — a blowdown spike, not a delta, so the series is
 * naturally band-limited.
 *
 * `tauDeg` is the decay constant expressed in crank degrees, which is how the
 * pulse width ends up shrinking with rpm all on its own.
 */
export function bankCycle(fire, m, tauDeg, out) {
  const w = out && out.length === m ? out : new Float32Array(m);
  w.fill(0);
  const step = 720 / m;
  const rise = Math.max(step, tauDeg * 0.11);
  for (let i = 0; i < fire.length; i++) {
    const a = fire[i];
    for (let j = 0; j < m; j++) {
      // distance forward from the firing angle, wrapped into [0,720)
      let d = j * step - a;
      if (d < 0) d += 720;
      if (d > 520) continue;                   // far side of the cycle: skip
      const env = d < rise ? d / rise : Math.exp(-(d - rise) / tauDeg);
      w[j] += env;
    }
  }
  // remove DC: an exhaust pipe cannot radiate a constant pressure
  let dc = 0;
  for (let j = 0; j < m; j++) dc += w[j];
  dc /= m;
  for (let j = 0; j < m; j++) w[j] -= dc;
  return w;
}
