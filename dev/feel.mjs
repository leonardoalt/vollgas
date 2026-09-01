/* ==========================================================================
   feel.mjs — measure the lateral response, because "feels robotic" has to
   become a number before it can be fixed.

   Everything here drives the real Player through the real input.js with real
   binary key presses, on the real A81 alignment, and logs the state at every
   step. Nothing is reimplemented.

     1  step steer      rise time, overshoot, settling time, and what happens
                        on release — a car that snaps back to parallel shows up
                        as a settle time near zero and a yaw rate that just
                        stops instead of decaying
     2  lane change     a keyboard lane change: does the path settle, and does
                        it settle *once* rather than weaving
     3  skidpad         peak steady lateral g per car, which is the number the
                        corner-speed balance depends on
     4  sweeper         the tightest corner on the route at 300 km/h: lateral
                        g, slip angles, and whether it is still flat out
     5  balance         throttle-on vs throttle-off mid-corner, per car —
                        the rear-drive AMG must go oversteer where the estate
                        goes understeer
     6  timestep        the same manoeuvre at dt = 1/20, 1/40, 1/60, 1/120;
                        the car must end up in the same place
     7  stability       release everything from a yaw disturbance and watch the
                        tyres damp it out on their own
     8  handbrake       a mild turn with the rear brake held must remain a
                        catchable slide rather than becoming a full spin
     9  reversal        left-to-right key reversal time at input and rack
    10  police stop     high-speed automatic stop must brake, merge and park
                        without spinning or touching a barrier

   Usage: node dev/feel.mjs [url] [--json]
   ========================================================================== */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5173/';
const JSON_OUT = process.argv.includes('--json');

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--window-size=800,600', '--hide-scrollbars',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[err] ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  const { sample, LANES } = await import('/src/track.js');
  const { laneAssist } = await import('/src/vehicles.js');
  const { PLAYER_CARS } = await import('/src/carFactory.js');
  const R2D = 180 / Math.PI;
  const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  /* ---------------------------------------------------------------- rigging */
  g.hud.drawTacho = () => {}; g.hud.drawRadar = () => {};
  g.hud.update = () => {};

  /** Pick the car, start a race, then take the player out of the world so
      nothing but the driving model is under test. */
  function useCar(id) {
    g.selected = PLAYER_CARS.indexOf(id);
    g.startRace();
    g.countdown = 0;
    return g.player;
  }

  /* Find a genuinely straight stretch, and the tightest corner. */
  function survey() {
    let straight = null, tightest = { s: 0, k: 0 };
    for (let s = 400; s < 24000; s += 20) {
      const k = Math.abs(sample(s).curv);
      if (k > tightest.k) tightest = { s, k };
      if (straight === null && k < 2e-6) {
        // needs to stay straight for a while
        let ok = true;
        for (let d = 0; d < 1600; d += 20) if (Math.abs(sample(s + d).curv) > 2e-6) { ok = false; break; }
        if (ok) straight = s;
      }
    }
    return { straight: straight ?? 8000, tight: tightest.s, tightK: tightest.k };
  }
  const SITE = survey();

  /** One physics step with a real keyboard key held, and a speed controller on
      the pedals so a lateral test is not also an acceleration test.

      `opts.pin` pins u to a fixed offset at the TOP of the step, which turns
      the road into an infinitely wide test track. That is legitimate: u is a
      pure *output* of the lateral state, and feeds back only through the
      offroad/barrier checks. Without it, an open-loop steer test at 200 km/h
      puts the car into a Stahlschutzplanke inside a second and you end up
      measuring a crash rather than a step response. Pinned before the step,
      never after, so the barrier clamp never runs at all. */
  function stepWith(p, dt, key, holdV, opts = {}) {
    if (opts.pin !== undefined) { p.u = opts.pin; p.offroad = false; p.scrape = 0; }
    g.input.keys.clear();
    if (key) g.input.keys.add(key);
    g.input.update(dt);
    let thr = 0, brk = 0;
    if (opts.throttle !== undefined) { thr = opts.throttle; brk = opts.brake || 0; }
    else if (holdV !== null) {
      const e = holdV - p.v;
      if (e > 0.15) thr = Math.min(1, e * 0.25);
      else if (e < -0.15) brk = Math.min(0.6, -e * 0.06);
    }
    const steer = opts.steer !== undefined ? opts.steer : g.input.steer;
    p.control(dt, { throttle: thr, brake: brk, steer, handbrake: !!opts.hand }, null);
    p.sync(dt);
  }

  function place(p, s, u, v) {
    p.s = s; p.u = u; p.v = v;
    p.psi = 0; p.vy = 0; p.r = 0; p.aLat = 0; p.aLong = 0;
    p.slip = 0; p.damage = 0;
    if (p.rack) p.rack.reset();
    p.sRoll.reset(); p.sPitch.reset(); if (p.sHeave) p.sHeave.reset();
  }

  /* Settle the car so the test starts from a genuinely steady state. */
  function settle(p, holdV, secs = 2.5, dt = 1 / 100, pin) {
    for (let i = 0; i < secs / dt; i++) stepWith(p, dt, null, holdV, { pin });
  }

  /* ================================================== 1. step steer response
     A sub-limit steer step — 0.28 of lock, about half of what the tyres will
     take — held for 3 s at 200 km/h on a straight, then released.

     Sub-limit on purpose. Full lock always over-drives the front axle (that is
     what steerLock() is tuned to do), so a full-lock test measures tyre
     saturation, not the yaw response. The classic rise/overshoot/settling
     numbers only mean anything in the responsive part of the range. The
     keyboard's actual full-lock behaviour is test 2. */
  function stepSteer(id) {
    const p = useCar(id);
    const dt = 1 / 100, V = 200 / 3.6;
    const AMP = 0.28;
    place(p, SITE.straight, LANES[0], V);
    settle(p, V, 2.5, dt, LANES[0]);

    const tr = [];
    const N = Math.round(3.0 / dt), M = Math.round(2.5 / dt);
    for (let i = 0; i < N + M; i++) {
      stepWith(p, dt, null, V, { pin: LANES[0], steer: i < N ? AMP : 0 });
      tr.push({
        t: +(i * dt).toFixed(3),
        cmd: +g.input.steer.toFixed(4),
        delta: +(p.steerAngle * R2D).toFixed(3),
        r: +(p.r * R2D).toFixed(3),
        ay: +(p.aLat / 9.81).toFixed(4),
        psi: +(p.psi * R2D).toFixed(3),
        af: +(p.slipF * R2D).toFixed(3),
        ar: +(p.slipR * R2D).toFixed(3),
        roll: +(p.roll * R2D).toFixed(3),
        vy: +p.vy.toFixed(3),
        /* psi is right-positive, rotation.y is left-positive. Compare the
           rendered nose with the actual velocity vector so a sign mismatch
           can never masquerade as "handling feel" again. */
        noseTravel: +(Math.abs(angle(
          angle(sample(p.s).head - p.mesh.rotation.y)
          - angle(p.psi + Math.atan2(p.vy, Math.max(0.1, p.v)))
        )) * R2D).toFixed(3),
      });
    }
    const on = tr.slice(0, N);
    // steady state = mean of the last half second of the hold
    const tail = on.slice(-Math.round(0.5 / dt));
    const ss = tail.reduce((a, x) => a + x.r, 0) / tail.length;
    const ssAy = tail.reduce((a, x) => a + x.ay, 0) / tail.length;
    const ssRoll = tail.reduce((a, x) => a + x.roll, 0) / tail.length;
    const ssNoseTravel = tail.reduce((a, x) => a + x.noseTravel, 0) / tail.length;

    const at = (frac) => {
      const want = ss * frac;
      for (const x of on) if (x.r >= want) return x.t;
      return null;
    };
    const peak = Math.max(...on.map(x => x.r));
    const peakRoll = Math.max(...on.map(x => x.roll));
    // settling: last time it is more than 5 % away from steady state
    let settleT = 0;
    for (const x of on) if (Math.abs(x.r - ss) > Math.abs(ss) * 0.05) settleT = x.t;

    // release: time for the yaw rate to fall to 10 % of steady state
    const off = tr.slice(N);
    let relT = null, relUnder = 0;
    for (const x of off) {
      if (relT === null && x.r <= ss * 0.10) relT = +(x.t - N * dt).toFixed(3);
      relUnder = Math.min(relUnder, x.r);
    }

    return {
      car: id,
      ss_yaw_deg_s: +ss.toFixed(3), ss_ay_g: +ssAy.toFixed(3),
      ss_roll_deg: +ssRoll.toFixed(3), ss_delta_deg: +tail[0].delta.toFixed(2),
      ss_nose_travel_error_deg: +ssNoseTravel.toFixed(2),
      rise10_90_s: at(0.1) !== null && at(0.9) !== null ? +(at(0.9) - at(0.1)).toFixed(3) : null,
      t90_s: at(0.9),
      overshoot_pct: +(((peak - ss) / Math.abs(ss)) * 100).toFixed(1),
      roll_overshoot_pct: +(((peakRoll - ssRoll) / Math.abs(ssRoll)) * 100).toFixed(1),
      settle_s: +settleT.toFixed(2),
      release_to_10pct_s: relT,
      release_counter_yaw_deg_s: +relUnder.toFixed(3),
      ss_slipF_deg: +tail[0].af.toFixed(2), ss_slipR_deg: +tail[0].ar.toFixed(2),
      trace: tr.filter((_, i) => i % 5 === 0),
    };
  }

  /* ========================================================= 2. lane change
     Right for 0.9 s, left for 0.9 s, then hands off — a keyboard lane change
     at 250 km/h. The path must arrive and stop, not weave. */
  function laneChange(id) {
    const p = useCar(id);
    const dt = 1 / 100, V = 250 / 3.6;
    place(p, SITE.straight, LANES[0], V);
    settle(p, V, 2.5, dt, LANES[0]);
    /* From here u runs free — a lane change is exactly a test of where the car
       ends up — but the straight is 1600 m of zero curvature and the car has
       the whole carriageway, so nothing touches a barrier. */
    const u0 = p.u;
    const tr = [];
    const seq = [['d', 0.9], ['a', 0.9], [null, 5.2]];
    let t = 0;
    for (const [key, dur] of seq) {
      for (let i = 0; i < dur / dt; i++, t += dt) {
        stepWith(p, dt, key, V);
        tr.push({ t: +t.toFixed(3), du: +(p.u - u0).toFixed(4),
                  r: +(p.r * R2D).toFixed(3), psi: +(p.psi * R2D).toFixed(3),
                  ay: +(p.aLat / 9.81).toFixed(4), cmd: +g.input.steer.toFixed(3) });
      }
    }
    const moved = tr[tr.length - 1].du;
    const peak = Math.max(...tr.map(x => x.du));
    // how much the path wanders after the hands come off
    const after = tr.filter(x => x.t > 1.8);
    const finals = after.slice(-Math.round(1.0 / dt)).map(x => x.du);
    const drift = Math.max(...finals) - Math.min(...finals);
    // sign reversals of the yaw rate after release = weaving
    let flips = 0, prev = 0;
    for (const x of after) {
      const sg = Math.abs(x.r) < 0.05 ? 0 : Math.sign(x.r);
      if (sg && prev && sg !== prev) flips++;
      if (sg) prev = sg;
    }
    return {
      car: id, moved_m: +moved.toFixed(2), peak_m: +peak.toFixed(2),
      overshoot_m: +(peak - moved).toFixed(3),
      residual_drift_m_per_s: +drift.toFixed(3),
      yaw_sign_flips_after_release: flips,
      peak_ay_g: +Math.max(...tr.map(x => Math.abs(x.ay))).toFixed(3),
      trace: tr.filter((_, i) => i % 10 === 0),
    };
  }

  /* ============================================================= 3. skidpad
     Wind lock on slowly at a fixed speed and record the peak lateral g the
     car will actually hold. This is the number corner speeds depend on. */
  function skidpad(id, kmh) {
    const p = useCar(id);
    const dt = 1 / 100, V = kmh / 3.6;
    place(p, SITE.straight, LANES[1], V);
    settle(p, V, 2.5, dt, LANES[1]);
    let peak = 0, peakAtF = 0, peakAtR = 0, bal = 0, lockAtPeak = 0, atFull = 0;
    for (let i = 0; i < 10 / dt; i++) {
      const steer = Math.min(1, i * dt / 6);        // 6 s to full lock
      stepWith(p, dt, null, V, { steer, pin: LANES[1] });
      if (Math.abs(p.aLat) > peak) {
        peak = Math.abs(p.aLat);
        peakAtF = Math.abs(p.slipF) * R2D; peakAtR = Math.abs(p.slipR) * R2D;
        bal = p.balance; lockAtPeak = steer;
      }
      if (steer >= 1) atFull = Math.abs(p.aLat);
    }
    return { car: id, kmh, peak_ay_g: +(peak / 9.81).toFixed(3),
             at_full_lock_g: +(atFull / 9.81).toFixed(3),
             lock_at_peak: +lockAtPeak.toFixed(2),
             mu_g: +(p.ch.mu).toFixed(2),
             slipF_deg: +peakAtF.toFixed(2), slipR_deg: +peakAtR.toFixed(2),
             balance: +bal.toFixed(3) };
  }

  /* ============================================================= 4. sweeper
     The tightest corner on the route, entered at 300 km/h with the damped
     lane assist holding the left-hand lane. Must stay on the road. */
  function sweeper(id) {
    const p = useCar(id);
    const dt = 1 / 100, V = 300 / 3.6;
    place(p, SITE.tight - 900, LANES[0], V);
    /* Settle with the assist working, not hands-off: 900 m before the apex the
       road is already turning, and a hands-off run-up just drifts off the
       carriageway before the test starts. */
    for (let i = 0; i < 1.5 / dt; i++) {
      stepWith(p, dt, null, V, { steer: laneAssist(p, LANES[0]) });
    }
    const tr = [];
    let maxAy = 0, maxOff = 0, dmg0 = p.damage, scrapes = 0;
    for (let i = 0; i < 26 / dt; i++) {
      const st = laneAssist(p, LANES[0]);
      stepWith(p, dt, null, V, { steer: st, throttle: 1 });
      const off = Math.abs(p.u - LANES[0]);
      maxAy = Math.max(maxAy, Math.abs(p.aLat));
      maxOff = Math.max(maxOff, off);
      if (p.scrape) scrapes++;
      if (i % 25 === 0) tr.push({ t: +(i * dt).toFixed(2), km: +(p.s / 1000).toFixed(3),
        kmh: Math.round(p.v * 3.6), du: +(p.u - LANES[0]).toFixed(2),
        ay: +(p.aLat / 9.81).toFixed(3), cmd: +st.toFixed(3),
        af: +(p.slipF * R2D).toFixed(2), ar: +(p.slipR * R2D).toFixed(2) });
    }
    return { car: id, tight_radius_m: Math.round(1 / SITE.tightK),
             max_ay_g: +(maxAy / 9.81).toFixed(3),
             max_lane_error_m: +maxOff.toFixed(2),
             exit_kmh: Math.round(p.v * 3.6),
             damage: +(p.damage - dmg0).toFixed(2), scrape_frames: scrapes,
             trace: tr };
  }

  /* ============================================================= 5. balance
     Mid-corner at ~0.75 g: what does the throttle do to the balance? */
  function balance(id) {
    const p = useCar(id);
    const dt = 1 / 100, V = 200 / 3.6;
    const probe = (thr, brk) => {
      place(p, SITE.straight, LANES[1], V);
      settle(p, V, 2.5, dt, LANES[1]);
      let steer = 0;
      // wind on until we are at about 0.75 g, holding speed
      for (let i = 0; i < 5 / dt; i++) {
        if (Math.abs(p.aLat) < 0.75 * 9.81) steer = Math.min(1, steer + dt * 0.30);
        stepWith(p, dt, null, V, { steer, pin: LANES[1] });
      }
      // now the probe input, same lock, for 1.2 s
      let bal = 0, ay = 0, ar = 0, af = 0;
      for (let i = 0; i < 1.2 / dt; i++) {
        stepWith(p, dt, null, null, { steer, throttle: thr, brake: brk, pin: LANES[1] });
        bal = p.balance; ay = p.aLat / 9.81; af = p.slipF * R2D; ar = p.slipR * R2D;
      }
      return { bal: +bal.toFixed(3), ay: +ay.toFixed(3),
               af: +af.toFixed(2), ar: +ar.toFixed(2), kmh: Math.round(p.v * 3.6) };
    };
    const power = probe(1, 0);
    const coast = probe(0, 0);
    const brake = probe(0, 0.45);
    return { car: id, power, coast, brake,
             throttle_shift: +(power.bal - coast.bal).toFixed(3),
             brake_shift: +(brake.bal - coast.bal).toFixed(3) };
  }

  /* ============================================================ 6. timestep
     The same lane change at four frame rates. The game clamps dt to 0.05 s,
     so 1/20 is the worst case it can ever see. */
  function timestep(id) {
    const rows = [];
    for (const dt of [1 / 120, 1 / 60, 1 / 40, 1 / 20]) {
      const p = useCar(id);
      const V = 250 / 3.6;
      place(p, SITE.straight, LANES[0], V);
      settle(p, V, 2.5, dt, LANES[0]);
      const u0 = p.u, s0 = p.s;
      let peakAy = 0, peakR = 0;
      const seq = [['d', 0.9], ['a', 0.9], [null, 3.2]];
      for (const [key, dur] of seq) {
        for (let i = 0; i < Math.round(dur / dt); i++) {
          stepWith(p, dt, key, V);
          peakAy = Math.max(peakAy, Math.abs(p.aLat));
          peakR = Math.max(peakR, Math.abs(p.r));
        }
      }
      rows.push({ dt: +dt.toFixed(5), fps: Math.round(1 / dt),
        moved_m: +(p.u - u0).toFixed(3), travelled_m: +(p.s - s0).toFixed(1),
        kmh: Math.round(p.v * 3.6),
        peak_ay_g: +(peakAy / 9.81).toFixed(3),
        peak_yaw_deg_s: +(peakR * R2D).toFixed(2),
        finite: Number.isFinite(p.u) && Number.isFinite(p.psi) && Number.isFinite(p.vy) });
    }
    const mv = rows.map(r => r.moved_m);
    const ay = rows.map(r => r.peak_ay_g);
    return { car: id, rows,
             moved_spread_m: +(Math.max(...mv) - Math.min(...mv)).toFixed(3),
             peak_ay_spread_g: +(Math.max(...ay) - Math.min(...ay)).toFixed(3),
             all_finite: rows.every(r => r.finite) };
  }

  /* =========================================================== 7. stability
     Kick the car into a yaw rate, take the hands off, and see whether the
     tyres put it straight. This is where the old model cheated: psi was
     multiplied down every frame, so the heading snapped back whatever the
     tyres were doing. */
  function stability(id) {
    const p = useCar(id);
    const dt = 1 / 100, V = 250 / 3.6;
    place(p, SITE.straight, LANES[0], V);
    settle(p, V, 2.5, dt, LANES[0]);
    p.r = 8 / R2D;                  // 8 deg/s of yaw, hands off
    p.vy = 0;
    const tr = [];
    /* u pinned: the point of the test is whether the TYRES damp the yaw, and a
       car left yawing at 8 deg/s reaches a barrier in about a second, where the
       scrape logic would damp it for them and fake a pass. */
    for (let i = 0; i < 5 / dt; i++) {
      stepWith(p, dt, null, V, { pin: LANES[0] });
      tr.push({ t: +(i * dt).toFixed(3), r: p.r * R2D, psi: p.psi * R2D, vy: p.vy });
    }
    const r0 = 8;
    let half = null, quarter = null;
    for (const x of tr) {
      if (half === null && Math.abs(x.r) <= r0 * 0.5) half = x.t;
      if (quarter === null && Math.abs(x.r) <= r0 * 0.25) quarter = x.t;
    }
    const end = tr[tr.length - 1];
    return { car: id, yaw_half_life_s: half, yaw_quarter_s: quarter,
             yaw_after_5s_deg_s: +end.r.toFixed(3),
             psi_after_5s_deg: +end.psi.toFixed(2),
             vy_after_5s: +end.vy.toFixed(3),
             /* the heading error must NOT vanish on its own: a real car keeps
                the heading it was left with until the driver steers it out */
             psi_retained: Math.abs(end.psi) > 0.5 };
  }

  /* ========================================================== 8. handbrake
     Hold substantial lock, then pull the handbrake. Pin u so a barrier
     cannot hide an unstable car by damping its yaw for us. */
  function handbrake(id) {
    const p = useCar(id);
    const dt = 1 / 100, V = 120 / 3.6;
    place(p, SITE.straight, LANES[0], V);
    let maxR = 0, maxVy = 0;
    for (let i = 0; i < 3 / dt; i++) {
      stepWith(p, dt, null, null, {
        pin: LANES[0], steer: 0.30, hand: i >= 0.8 / dt,
      });
      maxR = Math.max(maxR, Math.abs(p.r));
      maxVy = Math.max(maxVy, Math.abs(p.vy));
    }
    return { car: id, peak_yaw_deg_s: +(maxR * R2D).toFixed(1),
             peak_sideslip_ms: +maxVy.toFixed(2), exit_kmh: Math.round(p.v * 3.6) };
  }

  /* =========================================================== 9. reversal
     Binary steering is filtered once by Input and once by Rack. Measure the
     actual through-centre delay so making the rack weighty does not make a
     quick correction feel ignored. */
  function reversal() {
    const p = useCar('turbo');
    const dt = 1 / 100, V = 200 / 3.6;
    place(p, SITE.straight, LANES[0], V);
    for (let i = 0; i < 0.7 / dt; i++) stepWith(p, dt, 'a', V, { pin: LANES[0] });
    let inputT = null, rackT = null;
    for (let i = 0; i < 1.2 / dt; i++) {
      stepWith(p, dt, 'd', V, { pin: LANES[0] });
      if (inputT === null && g.input.steer >= 0) inputT = +(i * dt).toFixed(2);
      if (rackT === null && p.rack.pos >= 0) rackT = +(i * dt).toFixed(2);
    }
    return { input_cross_s: inputT, rack_cross_s: rackT };
  }

  /* ========================================================= 10. police stop
     A stop can trigger while the player is still above 200 km/h. Exercise the
     Player's real automatic control directly and retain the worst transient. */
  function policeStop() {
    const p = useCar('turbo');
    const dt = 1 / 40;
    place(p, SITE.straight, LANES[0], 62);
    p.stoppedT = 999;
    let maxR = 0, maxPsi = 0, scrapes = 0, parkedAt = null;
    for (let i = 0; i < 40 / dt; i++) {
      p.control(dt, { throttle: 0, brake: 0, steer: 0, handbrake: false }, null);
      p.sync(dt);
      maxR = Math.max(maxR, Math.abs(p.r));
      maxPsi = Math.max(maxPsi, Math.abs(p.psi));
      scrapes += p.scrape;
      if (parkedAt === null && p.pulledOver) parkedAt = +(i * dt).toFixed(2);
    }
    return { peak_yaw_deg_s: +(maxR * R2D).toFixed(1),
             peak_heading_deg: +(maxPsi * R2D).toFixed(1),
             scrape_frames: scrapes, damage: +p.damage.toFixed(2),
             parked_at_s: parkedAt, final_u: +p.u.toFixed(2) };
  }

  const cars = ['turbo', 'm5', 'rs6', 'amg'];
  return {
    site: { straight_s: SITE.straight, tight_s: SITE.tight,
            tight_radius_m: Math.round(1 / SITE.tightK) },
    stepSteer: cars.map(stepSteer),
    laneChange: cars.map(laneChange),
    skidpad: [].concat(...cars.map(c => [skidpad(c, 120), skidpad(c, 300)])),
    sweeper: cars.map(sweeper),
    balance: cars.map(balance),
    timestep: cars.map(timestep),
    stability: cars.map(stability),
    handbrake: cars.map(handbrake),
    reversal: reversal(),
    policeStop: policeStop(),
  };
});

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 1));
} else {
  const strip = (o) => { const { trace, ...rest } = o; return rest; };
  console.log('\nSITE', JSON.stringify(out.site));

  console.log('\n=== 1. STEP STEER  (28 % lock right, 200 km/h, straight road) ===');
  console.table(out.stepSteer.map(strip));
  console.log('\n=== 2. LANE CHANGE  (0.9 s right, 0.9 s left, hands off, 250 km/h) ===');
  console.table(out.laneChange.map(strip));
  console.log('\n=== 3. SKIDPAD  (peak steady lateral g) ===');
  console.table(out.skidpad);
  console.log('\n=== 4. TIGHTEST CORNER  (flat out, damped lane assist) ===');
  console.table(out.sweeper.map(strip));
  console.log('\n=== 5. BALANCE  (mid-corner, >0 = oversteer) ===');
  console.table(out.balance.map(b => ({
    car: b.car,
    coast_bal: b.coast.bal, power_bal: b.power.bal, brake_bal: b.brake.bal,
    throttle_shift: b.throttle_shift, brake_shift: b.brake_shift,
    coast_ay: b.coast.ay, power_ay: b.power.ay,
  })));
  console.log('\n=== 6. TIMESTEP  (same lane change, four frame rates) ===');
  for (const t of out.timestep) {
    console.log(`  ${t.car}: spread ${t.moved_spread_m} m over dt 1/120..1/20, ` +
      `peak ay spread ${t.peak_ay_spread_g} g, finite ${t.all_finite}`);
    console.table(t.rows);
  }
  console.log('\n=== 7. STABILITY  (8 deg/s yaw kick, hands off) ===');
  console.table(out.stability);
  console.log('\n=== 8. HANDBRAKE  (30 % steer, rear brake held) ===');
  console.table(out.handbrake);
  console.log('\n=== 9. STEERING REVERSAL  (full left to full right) ===');
  console.table([out.reversal]);
  console.log('\n=== 10. POLICE STOP  (223 km/h to parked shoulder) ===');
  console.table([out.policeStop]);

  /* -------------------------------------------------------------- verdicts */
  const fail = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail.push(msg); };
  console.log('\n=== VERDICT ===');
  for (const s of out.stepSteer) {
    ok(s.rise10_90_s !== null && s.rise10_90_s > 0.10 && s.rise10_90_s < 0.75,
      `${s.car}: yaw rise 10-90 % = ${s.rise10_90_s} s (want 0.10-0.75: a car has to take time to rotate)`);
    ok(s.overshoot_pct > 0.5 && s.overshoot_pct < 45,
      `${s.car}: yaw overshoot = ${s.overshoot_pct} % (want 0.5-45: settles, does not snap or ring)`);
    ok(s.release_to_10pct_s !== null && s.release_to_10pct_s > 0.12,
      `${s.car}: release decay to 10 % = ${s.release_to_10pct_s} s (want > 0.12: unwinds, does not snap)`);
    ok(s.roll_overshoot_pct > 1,
      `${s.car}: body roll overshoot = ${s.roll_overshoot_pct} % (want > 1: sprung, not algebraic)`);
    ok(s.ss_nose_travel_error_deg < 6,
      `${s.car}: rendered nose is ${s.ss_nose_travel_error_deg}° from travel (want < 6°: turns, not sideways drift)`);
  }
  for (const l of out.laneChange) {
    ok(l.yaw_sign_flips_after_release <= 3,
      `${l.car}: yaw sign flips after release = ${l.yaw_sign_flips_after_release} (want <= 3: settles, no weave)`);
    ok(l.residual_drift_m_per_s < 3.0,
      `${l.car}: residual drift = ${l.residual_drift_m_per_s} m in the last second (want < 3)`);
  }
  for (const s of out.skidpad.filter(x => x.kmh === 300)) {
    ok(s.peak_ay_g > 0.95,
      `${s.car}: peak lateral = ${s.peak_ay_g} g at 300 (want > 0.95; the tightest corner needs 0.87)`);
  }
  for (const s of out.sweeper) {
    ok(s.scrape_frames === 0 && s.damage < 0.5,
      `${s.car}: tightest corner flat out — ${s.scrape_frames} scrape frames, ${s.damage} damage (want clean)`);
    ok(s.max_lane_error_m < 2.2,
      `${s.car}: tightest corner lane error = ${s.max_lane_error_m} m (want < 2.2)`);
  }
  const bal = Object.fromEntries(out.balance.map(b => [b.car, b]));
  ok(bal.amg.throttle_shift > bal.rs6.throttle_shift,
    `throttle moves the RWD AMG further towards oversteer than the quattro estate ` +
    `(${bal.amg.throttle_shift} vs ${bal.rs6.throttle_shift})`);
  ok(bal.amg.throttle_shift > 0,
    `throttle-induced oversteer exists in the AMG (${bal.amg.throttle_shift} > 0)`);
  for (const b of out.balance) {
    ok(b.brake_shift < 0, `${b.car}: braking mid-corner shifts towards understeer (${b.brake_shift} < 0)`);
  }
  for (const t of out.timestep) {
    ok(t.all_finite, `${t.car}: no NaN/Inf at any frame rate`);
    ok(t.moved_spread_m < 0.60,
      `${t.car}: lane-change spread across dt 1/120..1/20 = ${t.moved_spread_m} m (want < 0.60)`);
    ok(t.peak_ay_spread_g < 0.15,
      `${t.car}: peak lateral g spread across frame rates = ${t.peak_ay_spread_g} (want < 0.15)`);
  }
  for (const s of out.stability) {
    ok(s.yaw_half_life_s !== null && s.yaw_half_life_s < 1.2,
      `${s.car}: yaw kick half-life = ${s.yaw_half_life_s} s (want < 1.2: the tyres damp it)`);
    ok(s.psi_retained,
      `${s.car}: heading error survives (psi = ${s.psi_after_5s_deg} deg after 5 s) — ` +
      `the car does NOT magically realign with the road`);
  }
  for (const h of out.handbrake) {
    ok(h.peak_yaw_deg_s < 35,
      `${h.car}: handbrake peak yaw = ${h.peak_yaw_deg_s} deg/s (want < 35: catchable, no spin)`);
  }
  ok(out.reversal.input_cross_s !== null && out.reversal.input_cross_s <= 0.17,
    `steering input crosses centre in ${out.reversal.input_cross_s} s (want <= 0.17)`);
  ok(out.reversal.rack_cross_s !== null && out.reversal.rack_cross_s <= 0.30,
    `actual rack crosses centre in ${out.reversal.rack_cross_s} s (want <= 0.30)`);
  ok(out.policeStop.peak_yaw_deg_s < 25,
    `police stop peak yaw = ${out.policeStop.peak_yaw_deg_s} deg/s (want < 25: no spin)`);
  ok(out.policeStop.scrape_frames === 0 && out.policeStop.damage === 0,
    `police stop has ${out.policeStop.scrape_frames} scrape frames and ${out.policeStop.damage} damage (want clean)`);
  ok(out.policeStop.parked_at_s !== null && out.policeStop.parked_at_s < 20,
    `police stop parks in ${out.policeStop.parked_at_s} s (want < 20)`);
  console.log(`\n${fail.length ? fail.length + ' FAILURES' : 'ALL CHECKS PASS'}`);
}
console.log(errs.length ? '\n' + errs.slice(0, 8).join('\n') : '\nno page errors');
await browser.close();
process.exit(0);
