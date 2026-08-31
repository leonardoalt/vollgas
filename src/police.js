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
   [excess km/h over, fine €, Punkte, Fahrverbot months]                    */
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

const ZIVI_TYPES = ['zivi_touring', 'zivi_limo', 'zivi_kompakt', 'zivi_avant'];
/* Deliberately dull fleet colours — the whole point is that you don't spot
   them until they are already behind you. */
const ZIVI_PAINTS = [0x9aa0a5, 0xb6babd, 0x5c6268, 0x232a35, 0x2c3138, 0xd8dadb];
const ZIVI_KREIS = ['S', 'BB', 'TÜ', 'RW', 'VS', 'TUT', 'KN'];

export const COP_STATE = {
  CRUISE: 'cruise',      // blending in
  MEASURE: 'measure',    // ProViDa running
  PURSUE: 'pursue',      // blue lights, STOP POLIZEI
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
    this.flashT = 0;
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
      this.cameras.push({ s, u, mesh, fired: false, warned: false, cooldown: 0 });
    }
  }

  _park(z, playerS, initial) {
    // drop a patrol car into the stream well ahead of the player
    const ahead = initial ? 600 + this.rand() * 2200 : 1100 + this.rand() * 2400;
    z.s = Math.min(LENGTH - 200, playerS + ahead);
    z.lane = this.rand() < 0.72 ? 1 : 0;
    z.u = LANES[z.lane];
    const lim = limitAt(z.s);
    z.cruise = (lim === Infinity ? 36 : lim / KMH + 1.2);
    z.v = z.cruise;
    z.psi = 0;
    z.state = COP_STATE.CRUISE;
    z.warned = false;
    z.measure = 0; z.measurePeak = 0; z.pursueClose = 0; z.cooldown = 0; z.grace = 0;
    z.setLights(false);
  }

  /* ---------------------------------------------------------------- logic */
  update(dt, player, traffic, ctx) {
    this.flashT = Math.max(0, this.flashT - dt);
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
          const p = penaltyFor(pKmh - camLim);
          this._ticket(player, p, 'blitzer', sectionAt(cam.s).name, camLim, pKmh);
          this.flashT = 0.45;
          this.events.push({ type: 'flash', penalty: p, limit: camLim, speed: pKmh });
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
      const rel = z.s - player.s;

      if (z.state === COP_STATE.DONE) {
        z.cooldown -= dt;
        if (z.cooldown <= 0 || rel < -500) this._park(z, player.s, false);
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
        const inRange = gap > -25 && gap < 340;
        if (!inRange && z.grace <= 0) {
          // out-measured: either you pulled clear or they lost you in traffic
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
        } else if (z.grace <= 0) {
          // a valid ProViDa measurement needs a sustained follow
          z.measure += dt / 4.2;
          if (z.measure >= 1) {
            const p = penaltyFor(z.measurePeak - zLim);
            this._ticket(player, p, 'provida', sectionAt(player.s).name, zLim, z.measurePeak);
            z.state = COP_STATE.PURSUE;
            z.pursueClose = 0;
            z.setLights(true);
            this.events.push({ type: 'measure-done', cop: z, penalty: p, limit: zLim, speed: z.measurePeak });
          }
        }
        active = z;
      }

      if (z.state === COP_STATE.PURSUE) {
        const gap = player.s - z.s;
        z.strobe(dt);
        if (gap > 460 || gap < -160) {
          z.state = COP_STATE.DONE; z.cooldown = 14;
          z.setLights(false);
          this.events.push({ type: 'escaped', cop: z });
        } else if (gap < 34 && player.v < z.v + 3) {
          z.pursueClose += dt;
          if (z.pursueClose > 4.5 || player.v * KMH < 25) {
            z.state = COP_STATE.DONE; z.cooldown = 22;
            z.setLights(false);
            player.stoppedT = 20;
            this.events.push({ type: 'stopped', cop: z });
          }
        } else {
          z.pursueClose = Math.max(0, z.pursueClose - dt * 0.5);
        }
        active = z;
      }

      // --- driving behaviour by state
      if (z.state === COP_STATE.MEASURE || z.state === COP_STATE.PURSUE) {
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
   * The only legal early-warning system on a German motorway: someone coming
   * the other way flicks their headlights at you.
   */
  _warn(dt, player, traffic) {
    this._warnT = (this._warnT || 0) - dt;
    if (this._warnT > 0) return;
    this._warnT = 0.7;
    /* One warning per hazard. Oncoming drivers flash you once as you close on
       something; they don't strobe at you for a kilometre. */
    let threat = null;
    for (const cam of this.cameras) {
      const rel = cam.s - player.s;
      if (rel > 260 && rel < 1400 && !cam.warned) { cam.warned = true; threat = { kind: 'blitzer', rel, obj: cam }; break; }
      if (rel < -60) cam.warned = false;
    }
    if (!threat) {
      for (const z of this.cops) {
        const rel = z.s - player.s;
        if (rel > 260 && rel < 1100 && z.state === COP_STATE.CRUISE && !z.warned) {
          z.warned = true; threat = { kind: 'zivi', rel, obj: z }; break;
        }
      }
    }
    if (!threat) return;
    const flashers = traffic.oncomingFlashers(player.s, 30, 260);
    if (!flashers.length) return;
    for (const f of flashers) f.flashT = 0.75;
    this.events.push({ type: 'lichthupe', threat });
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
    });
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}
