/* ==========================================================================
   police.js — Zivilstreifen, ProViDa and mobile Blitzer.

   Two enforcement systems, both real:

   * Unmarked patrol cars (Zivilstreifen) run in the normal traffic stream in
     ordinary colours. When you go past one well over the limit it drops in
     behind you and starts a **ProViDa** measurement — a calibrated video
     distance/speed measurement taken while following you. It needs to hold
     you for a few seconds. Brake, or pull far enough clear, and the
     measurement is void. Let it complete and you have an Anzeige, at which
     point the blue lights come out from behind the grille and the rear window
     lights up STOP POLIZEI.

   * Mobile speed cameras sit in unmarked vans on the hard shoulder. No
     warning from the car — radar detectors are illegal in Germany — so the
     only warning you get is other drivers' headlights (Lichthupe).

   Fines follow the real Bußgeldkatalog for outside built-up areas.
   ========================================================================== */
import { LENGTH, LANES, GEO, SECTIONS, limitAt, sectionAt, sample, toWorld } from './track.js';
import { buildCar, CARS, randomPlate } from './carFactory.js';
import { TrafficCar } from './vehicles.js';

const KMH = 3.6;

/* --------------------------------------------------- Bußgeldkatalog (BKat)
   Speeding outside built-up areas, cars, post-2021 rates.
   [excess km/h over, fine €, Punkte, Fahrverbot months]

   Note the ceiling: two points and 700 € is as bad as a *speeding*
   Ordnungswidrigkeit ever gets, no matter how far over you were. 180 km/h over
   the limit is the same entry as 71. That is genuinely how the catalogue works
   — see assessSpeeding() for where it stops being a mere fine.               */
const BKAT = [
  [10, 20, 0, 0], [15, 40, 0, 0], [20, 60, 0, 0], [25, 100, 1, 0],
  [30, 150, 1, 0], [40, 200, 1, 0], [50, 320, 2, 1], [60, 480, 2, 1],
  [70, 600, 2, 2], [Infinity, 700, 2, 3],
];
export function penaltyFor(excessKmh) {
  const e = Math.max(0, Math.round(excessKmh));
  for (const [cap, fine, pts, ban] of BKAT) {
    if (e <= cap) return { excess: e, fine, points: pts, ban };
  }
  return { excess: e, fine: 700, points: 2, ban: 3 };
}

/* ------------------------------------------- § 315d StGB, Alleinrennen
   Above roughly twice the posted limit you are no longer committing an
   administrative offence at all. Since October 2017, § 315d Abs. 1 Nr. 3 StGB
   covers a driver alone who travels "mit nicht angepasster Geschwindigkeit und
   grob verkehrswidrig und rücksichtslos ... um eine höchstmögliche
   Geschwindigkeit zu erreichen" — a criminal offence carrying up to two years,
   THREE points, revocation of the licence under § 69 StGB (not a temporary
   Fahrverbot) and confiscation of the car under § 315f.

   There is no statutory km/h figure — it is a judicial assessment — but German
   courts have found it at around double the limit, so that is the rule here.  */
export const RACING_MULTIPLE = 2.0;

/**
 * What the offence actually is. Returns null if you were legal.
 * `criminal` entries end the run: your licence is gone, not suspended.
 */
export function assessSpeeding(kmh, limit) {
  if (limit === Infinity || !(kmh > limit)) return null;
  const excess = Math.round(kmh - limit);
  if (kmh >= limit * RACING_MULTIPLE) {
    // Geldstrafe is set in Tagessätze (daily units), not a fixed sum
    const over = kmh - limit * RACING_MULTIPLE;
    const days = Math.min(90, 40 + Math.floor(over / 15) * 5);
    return {
      criminal: true, excess, days, fine: days * 50,
      points: 3, ban: 0, revoked: true, seized: true,
    };
  }
  const b = penaltyFor(excess);
  return { criminal: false, ...b, revoked: false, seized: false };
}

/* Measurement ranges.
   The bar only *fills* while the patrol car is close enough to see, so the
   mechanic is always legible. But opening a gap does not void the measurement
   outright — it pauses it, and they keep coming. Only a sustained gap loses
   them, which means flooring it buys you time rather than an escape. */
const MEASURE_FILL_GAP = 130;    // bar accumulates only inside this
const MEASURE_LOSE_GAP = 300;    // beyond this you are getting away
const MEASURE_LOSE_TIME = 3.5;   // ...but you have to hold it this long
const PURSUE_MAX_GAP = 520;      // they do not give up on a pursuit easily

const ZIVI_TYPES = ['zivi_touring', 'zivi_limo', 'zivi_kompakt', 'zivi_avant'];
/* Deliberately dull fleet colours — the whole point is that you don't spot
   them until they are already behind you. */
const ZIVI_PAINTS = [0x9aa0a5, 0xb6babd, 0x5c6268, 0x232a35, 0x2c3138, 0xd8dadb];
const ZIVI_KREIS = ['S', 'BB', 'TÜ', 'RW', 'VS', 'TUT', 'KN'];

export const COP_STATE = {
  CRUISE: 'cruise',      // blending in
  MEASURE: 'measure',    // ProViDa running
  PURSUE: 'pursue',      // blue lights, STOP POLIZEI
  STOP: 'stop',          // both of you pulling onto the hard shoulder
  DONE: 'done',          // gave up / handled
};

export class Zivi extends TrafficCar {
  constructor(mesh, spec, opts) {
    super(mesh, spec, opts);
    this.kind = 'police';
    this.state = COP_STATE.CRUISE;
    this.measure = 0;              // 0..1 ProViDa progress
    this.measurePeak = 0;          // highest speed seen during the measurement
    this.pursueClose = 0;          // seconds held within stopping distance
    this.cooldown = 0;
    this.lightPhase = 0;
    this.lane = 1;
    this.suspicion = 0;
  }

  setLights(on) {
    for (const b of this.mesh.userData.blues) b.material.emissiveIntensity = on ? 3.5 : 0;
    const led = this.mesh.userData.led;
    if (led) led.material.map = on ? led.userData.on : led.userData.off;
  }

  /** blue LEDs strobe in an alternating two-bank pattern */
  strobe(dt) {
    this.lightPhase += dt * 9;
    const blues = this.mesh.userData.blues;
    const bank = Math.floor(this.lightPhase) % 2;
    const flick = (Math.sin(this.lightPhase * 7) > -0.3) ? 1 : 0.15;
    blues.forEach((b, i) => {
      b.material.emissiveIntensity = ((i % 2) === bank ? 4.5 : 0.3) * flick;
    });
  }
}

export class Enforcement {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.cops = [];
    this.cameras = [];          // parked Messfahrzeuge
    this.events = [];           // things the HUD should shout about
    this.activeCop = null;
    this.camFlashT = 0;     // Blitzer flash effect, unrelated to headlight flashing
  }

  /* --------------------------------------------------------------- setup */
  build(playerS, count = 4) {
    for (let i = 0; i < count; i++) {
      const id = ZIVI_TYPES[i % ZIVI_TYPES.length];
      const spec = CARS[id];
      const kreis = ZIVI_KREIS[Math.floor(this.rand() * ZIVI_KREIS.length)];
      const mesh = buildCar(id, {
        police: true,
        paint: ZIVI_PAINTS[Math.floor(this.rand() * ZIVI_PAINTS.length)],
        plate: `${kreis} ${'ABCDEFGHKLMNPRSTVWXZ'[Math.floor(this.rand() * 20)]}${'ABCDEFGHKLMNPRSTVWXZ'[Math.floor(this.rand() * 20)]} ${100 + Math.floor(this.rand() * 899)}`,
      });
      const z = new Zivi(mesh, spec, { dir: 1, kind: 'police', name: 'Zivilstreife' });
      z.setLights(false);
      this.cops.push(z);
      this.scene.add(mesh);
      this._park(z, playerS, true);
    }

    /* Mobile Blitzer. Real ones cluster where the limit changes and where
       people think nobody is watching: after a restriction starts, in the
       roadworks, and on the run down into Singen. */
    const spots = [];
    for (const sec of SECTIONS) {
      if (sec.limit == null) continue;
      const s0 = sec.km * 1000;
      spots.push(s0 + 420 + this.rand() * 700);
      if (sec.works) spots.push(s0 + 1500 + this.rand() * 400);
    }
    for (const s of spots) {
      if (s > LENGTH - 400) continue;
      const mesh = buildCar('messwagen', {
        police: true,
        paint: this.rand() < 0.5 ? 0xb9bcbe : 0x7e848a,
        plate: randomPlate(this.rand),
      });
      const u = GEO.pavedOut - 1.35;
      const w = toWorld(s, u);
      const c = sample(s);
      mesh.position.set(w.x, w.y, w.z);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = c.head + 0.05;
      for (const b of mesh.userData.blues) b.material.emissiveIntensity = 0;
      if (mesh.userData.led) mesh.userData.led.material.map = mesh.userData.led.userData.off;
      this.scene.add(mesh);
      this.cameras.push({
        s, u, mesh, fired: false, warned: false, cooldown: 0,
        // the van is a physical object, not scenery
        halfLen: CARS.messwagen.dims.length / 2, halfWid: CARS.messwagen.dims.width / 2,
      });
    }
  }

  /** Reduce the random enforcement field to the two actors used by the lesson. */
  prepareTutorial(cameraS) {
    const camera = this.cameras[0];
    for (const extra of this.cameras.slice(1)) this.scene.remove(extra.mesh);
    this.cameras = camera ? [camera] : [];
    if (camera) {
      camera.s = cameraS;
      camera.fired = false; camera.warned = false; camera.cooldown = 0;
      const w = toWorld(camera.s, camera.u);
      const c = sample(camera.s);
      camera.mesh.position.set(w.x, w.y, w.z);
      camera.mesh.rotation.y = c.head + 0.05;
      camera.mesh.updateMatrixWorld(true);
    }
    this.tutorialCamera = camera || null;
    this.tutorialCop = this.cops[0] || null;
    this.tutorialWarningsArmed = false;
    if (this.tutorialCop) {
      this.tutorialCop.state = COP_STATE.DONE;
      this.tutorialCop.cooldown = 9999;
      this.tutorialCop.setLights(false);
    }
  }

  /** Put the lesson's unmarked car visibly behind the player and start ProViDa. */
  startTutorialMeasure(player) {
    const z = this.tutorialCop;
    if (!z) return;
    z.s = player.s - 46;
    z.u = player.u;
    z.lane = Math.abs(player.u - LANES[0]) < Math.abs(player.u - LANES[1]) ? 0 : 1;
    z.v = Math.max(18, player.v);
    z.cruise = z.v;
    z.psi = 0;
    z.state = COP_STATE.MEASURE;
    z.measure = 0.06;
    z.measurePeak = player.v * KMH;
    z.grace = 1.5;
    z.lostT = 0;
    z.cooldown = 9999;
    z.headlights = true;
    z.setLights(false);
    z.resetSweep();
    z.sync(0);
    this.activeCop = z;
    this.events.push({ type: 'measure-start', cop: z });
  }

  dismissTutorialCop() {
    const z = this.tutorialCop;
    if (!z) return;
    z.state = COP_STATE.DONE;
    z.cooldown = 9999;
    z.measure = 0;
    z.setLights(false);
    if (this.activeCop === z) this.activeCop = null;
  }

  _park(z, playerS, initial) {
    // drop a patrol car into the stream well ahead of the player
    const ahead = initial ? 600 + this.rand() * 2200 : 1100 + this.rand() * 2400;
    const spawnS = playerS + ahead;
    if (spawnS > LENGTH - 200) {
      z.active = false; z.mesh.visible = false;
      z.s = LENGTH + 1000; z.state = COP_STATE.DONE;
      z.resetSweep();
      return;
    }
    z.active = true; z.mesh.visible = true;
    z.s = spawnS;
    z.lane = this.rand() < 0.72 ? 1 : 0;
    z.u = LANES[z.lane];
    const lim = limitAt(z.s);
    z.cruise = (lim === Infinity ? 36 : lim / KMH + 1.2);
    z.v = z.cruise;
    z.psi = 0;
    z.state = COP_STATE.CRUISE;
    z.warned = false;
    z.measure = 0; z.measurePeak = 0; z.pursueClose = 0; z.cooldown = 0; z.grace = 0; z.lostT = 0;
    z.setLights(false);
    z.resetSweep();
  }

  /* ---------------------------------------------------------------- logic */
  update(dt, player, traffic, ctx) {
    this.camFlashT = Math.max(0, this.camFlashT - dt);
    this._checkRivals(traffic);
    const lim = limitAt(player.s);
    const pKmh = player.v * KMH;
    const over = lim === Infinity ? 0 : pKmh - lim;

    /* ---- mobile speed cameras -------------------------------------- */
    for (const cam of this.cameras) {
      cam.cooldown = Math.max(0, cam.cooldown - dt);
      const rel = cam.s - player.s;
      if (rel < -30 && rel > -80 && !cam.fired && cam.cooldown === 0) {
        const camLim = limitAt(cam.s);
        if (camLim !== Infinity && pKmh > camLim + 4) {
          cam.fired = true;
          const a = assessSpeeding(pKmh, camLim);
          this._ticket(player, a, a.criminal ? 'racing' : 'blitzer', sectionAt(cam.s).name, camLim, pKmh);
          this.camFlashT = 0.45;
          this.events.push({
            type: a.criminal ? 'criminal' : 'flash',
            penalty: a, limit: camLim, speed: pKmh, source: 'blitzer',
          });
        } else {
          cam.fired = true;
          this.events.push({ type: 'camera-pass-clean' });
        }
      }
      if (rel > 200) cam.fired = false;
    }

    /* ---- unmarked patrol cars -------------------------------------- */
    let active = null;
    for (const z of this.cops) {
      if (!z.active) continue;
      const rel = z.s - player.s;

      if (z.state === COP_STATE.DONE) {
        z.cooldown -= dt;
        if (z !== this.tutorialCop && (z.cooldown <= 0 || rel < -500)) this._park(z, player.s, false);
      }

      if (z.state === COP_STATE.CRUISE) {
        // recycle patrol cars we have left far behind or never met
        if (rel < -450 || rel > 3400) { this._park(z, player.s, false); }
        /* Engage only once the player is genuinely past — rel is the car's
           position relative to us, so it has to be negative. Starting while
           still ahead meant the MEASURE block, which runs in this same frame
           and needs us behind, voided the measurement instantly. */
        const passed = rel < -6 && rel > -95;
        const zLim = limitAt(player.s);
        const excess = zLim === Infinity ? 0 : pKmh - zLim;
        if (passed && excess > 21 && player.v > z.v + 2) {
          z.state = COP_STATE.MEASURE;
          z.measure = 0;
          z.grace = 2.2;                 // time to pull out and settle in behind
          z.lostT = 0;
          z.measurePeak = pKmh;
          this.events.push({ type: 'measure-start', cop: z });
        }
      }

      if (z.state === COP_STATE.MEASURE) {
        // the offence happens where the player is, not where the patrol car is
        const zLim = limitAt(player.s);
        const gap = player.s - z.s;
        z.grace = Math.max(0, (z.grace || 0) - dt);
        z.measurePeak = Math.max(z.measurePeak, pKmh);
        const restricted = zLim !== Infinity;
        const stillOver = restricted && pKmh > zLim + 11;
        const tooFar = gap > MEASURE_LOSE_GAP || gap < -25;
        z.lostT = Math.max(0, (z.lostT || 0) + (tooFar ? dt : -dt * 0.6));
        const canFill = gap > -25 && gap < MEASURE_FILL_GAP;
        if (z.lostT > MEASURE_LOSE_TIME && z.grace <= 0) {
          // held a big gap long enough: they cannot make the measurement stand
          z.state = COP_STATE.DONE; z.cooldown = 6;
          z.measure = 0;
          this.events.push({ type: 'measure-lost', cop: z });
        } else if (!restricted) {
          // you reached the end of the restriction — there is nothing to measure
          z.state = COP_STATE.DONE; z.cooldown = 10;
          z.measure = 0;
          this.events.push({ type: 'measure-freed', cop: z });
        } else if (!stillOver) {
          z.measure = Math.max(0, z.measure - dt * 0.55);
          if (z.measure <= 0 && z.grace <= 0) {
            z.state = COP_STATE.DONE; z.cooldown = 8;
            this.events.push({ type: 'measure-abort', cop: z });
          }
        } else if (z.grace <= 0 && canFill) {
          // a valid ProViDa measurement needs a sustained follow, up close
          z.measure += dt / 4.2;
          if (z.measure >= 1) {
            const a = assessSpeeding(z.measurePeak, zLim);
            this._ticket(player, a, a.criminal ? 'racing' : 'provida', sectionAt(player.s).name, zLim, z.measurePeak);
            z.state = COP_STATE.PURSUE;
            z.pursueClose = 0;
            z.setLights(true);
            this.events.push({
              type: a.criminal ? 'criminal' : 'measure-done',
              cop: z, penalty: a, limit: zLim, speed: z.measurePeak, source: 'provida',
            });
          }
        }
        active = z;
      }

      if (z.state === COP_STATE.PURSUE) {
        const gap = player.s - z.s;
        z.strobe(dt);
        if (gap > PURSUE_MAX_GAP || gap < -160) {
          z.state = COP_STATE.DONE; z.cooldown = 14;
          z.setLights(false);
          this.events.push({ type: 'escaped', cop: z });
        } else if (gap < 34 && player.v < z.v + 3) {
          z.pursueClose += dt;
          if (z.pursueClose > 4.5 || player.v * KMH < 25) {
            // they do not just drive off — they pull in behind you and stop
            z.state = COP_STATE.STOP;
            player.stoppedT = 999;                 // held until the run ends
            this.events.push({ type: 'stopped', cop: z });
          }
        } else {
          z.pursueClose = Math.max(0, z.pursueClose - dt * 0.5);
        }
        active = z;
      }

      // --- driving behaviour by state
      if (z.state === COP_STATE.STOP) {
        z.strobe(dt);
        this._pullOver(dt, z, player, ctx);
        active = z;
      } else if (z.state === COP_STATE.MEASURE || z.state === COP_STATE.PURSUE) {
        this._chase(dt, z, player, ctx);
      } else {
        const lim2 = limitAt(z.s);
        z.cruise = lim2 === Infinity ? 34 : lim2 / KMH + 1.2;
        z.drive(dt, ctx);
      }
      z.sync(dt);
    }
    this.activeCop = active;

    /* ---- Lichthupe: oncoming drivers warn you about what's ahead ---- */
    this._warn(dt, player, traffic);
    return { over, limit: lim };
  }

  /** Follow the player: sit behind at measuring distance, or close in. */
  _chase(dt, z, player, ctx) {
    const gap = player.s - z.s;
    const wantGap = z.state === COP_STATE.MEASURE ? 38 : 24;
    let targetV = player.v + (gap - wantGap) * 0.10 + (z.state === COP_STATE.PURSUE ? 6 : 2);
    // never drive into the car being followed
    if (gap < wantGap * 0.75) targetV = Math.min(targetV, player.v - 1.5);
    if (gap < 12) targetV = Math.min(targetV, player.v - 5);
    const want = Math.max(6, Math.min(z.d.vmax, targetV));

    let thr = 0, brake = 0;
    if (z.v < want - 0.4) thr = 1;
    else if (z.v > want + 0.4) brake = Math.min(0.85, (z.v - want) * 0.10);
    else thr = 0.4;

    // tuck in behind the player, dodging traffic in the way
    let targetU = player.u;
    const ahead = ctx.nearestAhead(z, Math.abs(targetU - LANES[0]) < 1.9 ? 0 : 1);
    if (ahead && ahead.gap < 40 && ahead.v !== player) {
      targetU = targetU > (LANES[0] + LANES[1]) / 2 ? LANES[0] : LANES[1];
    }
    const err = targetU - z.u;
    const steer = Math.max(-0.6, Math.min(0.6, err * 0.32));
    z.stepLong(dt, thr, brake, ctx);
    z.stepLat(dt, steer, ctx);
    z.headlights = true;
  }

  /**
   * Follow the player onto the hard shoulder and stop right behind them. They
   * park close — a patrol car that comes to rest 25 m back is out of the
   * mirror, so you never actually see who stopped you.
   */
  _pullOver(dt, z, player, ctx) {
    const gap = player.s - z.s;
    const targetU = GEO.kerbOut + GEO.shoulder * 0.5;
    const err = targetU - z.u;
    const arrived = Math.abs(err) < 1.0;
    const playerStopped = player.v < 1.2;
    // Dynamic body lengths matter now that patrol types have different shells.
    const STOP_GAP = player.halfLen + z.halfLen + 1.5;

    let wantV;
    if (!arrived) {
      // still getting onto the shoulder — keep rolling, you cannot steer at 0
      wantV = 8;
    } else if (gap > STOP_GAP + 1.2) {
      /* On the shoulder but hanging back. Close at a rate proportional to the
         gap — a fixed creep cannot make up 40 m in any reasonable time. */
      const closing = Math.min(12, 1.2 + (gap - STOP_GAP) * 0.45);
      wantV = playerStopped ? closing : Math.max(closing, player.v);
    } else {
      wantV = playerStopped ? 0 : Math.max(0, player.v - 1);
    }
    if (gap < STOP_GAP - 1.2) wantV = 0;   // close enough; do not nudge them

    let thr = 0, brake = 0;
    if (z.v > wantV + 0.3) brake = Math.min(1, 0.2 + (z.v - wantV) * 0.10);
    else if (z.v < wantV - 0.3) thr = 0.30;
    z.stepLong(dt, thr, brake, ctx);
    z.stepLat(dt, Math.max(-0.6, Math.min(0.6, err * 0.28)), ctx);
    // Braking alone is not a collision constraint: a cop summoned at speed can
    // cover several metres in one low-FPS frame. Enforce contact-free spacing
    // after integration so it can never tunnel into the stopped player.
    if (player.s - z.s < STOP_GAP) {
      z.s = player.s - STOP_GAP;
      z.v = Math.min(z.v, player.v);
    }
    if (z.v < 0.25) z.v = 0;
    z.headlights = true;
  }

  /**
   * The only legal early-warning system on a German motorway: someone coming
   * the other way flicks their headlights at you.
   */
  /**
   * The only legal early-warning system on a German motorway: someone coming
   * the other way flicks their headlights at you.
   *
   * Only mobile cameras get warned about. Nobody flashes you about an unmarked
   * patrol car, for the simple reason that oncoming drivers cannot spot one
   * either — that is the whole point of a Zivilstreife.
   */
  _warn(dt, player, traffic) {
    if (this.tutorialWarningsArmed === false) return;
    this._warnT = (this._warnT || 0) - dt;
    if (this._warnT > 0) return;
    this._warnT = 0.6;
    // inside a tunnel bore there is no oncoming carriageway to flash at you
    if (sectionAt(player.s).tunnel) return;

    let threat = null;
    for (const cam of this.cameras) {
      const rel = cam.s - player.s;
      if (rel < -60) { cam.warned = false; continue; }
      /* The lesson stages its own oncoming car, so it can teach the connection
         with a shorter, more memorable gap. In a race the wider window still
         gives naturally occurring traffic time to provide a warning. */
      const near = cam === this.tutorialCamera ? 350 : 550;
      const far = cam === this.tutorialCamera ? 500 : 1700;
      if (rel > near && rel < far && !cam.warned) { threat = { kind: 'blitzer', rel, obj: cam }; break; }
    }
    if (!threat) return;

    const flashers = traffic.oncomingFlashers(player.s, 40, 320);
    // nobody coming the other way right now — keep the warning pending
    if (!flashers.length) return;
    threat.obj.warned = true;
    // they keep flashing until you are past them, not for a fixed moment
    for (const f of flashers) {
      f.warnFlash = true;
      f.flashPhase = 0;
      /* Make the first pulse visible in this very frame. The tutorial freezes
         as soon as it receives the event, so waiting for the next AI update
         would spotlight a car whose lamps had not lit yet. */
      f.flashHold = 0.25;
      f.flashOn = true;
      f.headlights = true;
      f.sync(0);
    }
    this.events.push({ type: 'lichthupe', threat, flashers });
  }

  /** The rivals run the same gauntlet; a van doesn't care who you are. */
  _checkRivals(traffic) {
    if (!traffic || !traffic.rivals) return;
    for (const r of traffic.rivals) {
      for (const cam of this.cameras) {
        const rel = cam.s - r.s;
        const key = '_seen' + this.cameras.indexOf(cam);
        if (rel < -30 && rel > -90 && !r[key]) {
          r[key] = true;
          const camLim = limitAt(cam.s);
          const kmh = r.v * KMH;
          if (camLim !== Infinity && kmh > camLim + 4) {
            const p = penaltyFor(kmh - camLim);
            r.fines += p.fine; r.points += p.points;
            r.lawAbiding = Math.min(1, r.lawAbiding + 0.12);   // they learn
          }
        }
        if (rel > 220) r[key] = false;
      }
    }
  }

  /** src is a key ('blitzer' | 'provida'); the label is formatted at render
      time so switching language relabels tickets already issued. */
  _ticket(player, p, src, place, limit, speed) {
    player.fines += p.fine;
    player.points += p.points;
    player.tickets.push({
      src, place, limit: Math.round(limit), speed: Math.round(speed),
      excess: p.excess, fine: p.fine, points: p.points, ban: p.ban,
      days: p.days, criminal: !!p.criminal, revoked: !!p.revoked, seized: !!p.seized,
    });
  }

  /**
   * Summon a stop. Used when the run ends for a reason the police would act on
   * (eight points) but no patrol car happens to be on you — one closes in,
   * lights on, and the normal pull-over plays out.
   */
  forceStop(player) {
    if (this.cops.some(z => z.state === COP_STATE.STOP)) return;
    let best = null, bd = Infinity;
    for (const z of this.cops) {
      const d = Math.abs(player.s - z.s);
      if (d < bd) { bd = d; best = z; }
    }
    if (!best) return;
    /* A patrol retired near the finish can still be staged for a mandatory
       stop; make the selected actor visible again before repositioning it. */
    best.active = true; best.mesh.visible = true;
    const safeGap = player.halfLen + best.halfLen + 1.5;
    const behindGap = player.s - best.s;
    // The nearest available patrol may be beside or ahead of the player. A
    // patrol already 100-150 m behind is technically usable, but cannot reach
    // the shoulder before the ending timeout. Stage every forced stop close
    // enough to be visible, while still leaving ample braking room.
    if (behindGap < safeGap || behindGap > 50) {
      best.s = player.s - Math.max(38, safeGap + 8);
      best.u = player.u;
      best.v = Math.max(player.v, 30);
      best.psi = 0;
      best.resetSweep();
    }
    best.state = COP_STATE.STOP;
    best.pursueClose = 0;
    best.setLights(true);
    this.activeCop = best;
    player.stoppedT = 999;
  }

  /**
   * Did we just hit a parked measuring van? They sit in the hard shoulder and
   * used to be scenery you drove straight through.
   */
  hitCamera(player) {
    for (const cam of this.cameras) {
      if (Math.abs(cam.s - player.s) > player.halfLen + cam.halfLen) continue;
      if (Math.abs(cam.u - player.u) > player.halfWid + cam.halfWid) continue;
      return cam;
    }
    return null;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}
