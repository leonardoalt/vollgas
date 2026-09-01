/* ==========================================================================
   vehicles.js — driving model, traffic and rival racers.

   Everything lives in track space: s (metres along the A81), u (metres right
   of the median centre), plus a heading offset psi from the road tangent.
   Longitudinally it is a power-limited point mass with real drag; laterally
   it is a bicycle model whose steering is clamped by a friction circle, so
   braking really does cost you cornering grip and a 2.1 t estate really does
   run wide where a 911 does not.
   ========================================================================== */
import * as THREE from 'three';
import {
  sample, toWorld, LANES, GEO, LENGTH, sectionAt, limitAt, pavedRange, outerBarrier,
} from './track.js';
import { buildCar, buildTruck, CARS, randomPlate } from './carFactory.js';

const G = 9.81;
const KMH = 3.6;
/* Lichthupe timing: a ~0.95 s burst of roughly 0.13 s pulses. */
export const FLASH_DUR = 0.95;
export const FLASH_PULSE = 0.13;

/* ------------------------------------------------------- drivetrain setup */
export function derive(perf) {
  const vmax = perf.vmax / KMH;                    // m/s
  const P = perf.power * 1000;                     // W
  const crr = 0.013;
  const roll = crr * perf.mass * G;
  // pick the drag constant so the car actually tops out at its quoted vmax
  const k = Math.max(0.05, (P / vmax - roll) / (vmax * vmax));
  const gearTop = [];
  for (let i = 0; i < perf.gears; i++) gearTop.push(vmax * Math.pow((i + 1) / perf.gears, 0.72));
  /* `launch` is the fraction of the tyres' grip that actually reaches the road
     off the line: a per-car figure, because a 2.1 t estate does not get away
     like a rear-engined 911 even with the same nominal grip. Falls back to a
     sensible default by driven axles. */
  const drive = perf.launch ?? (perf.awd ? 0.78 : 0.62);
  return { vmax, P, roll, k, gearTop, aMax: perf.grip * G, drive };
}

export class Vehicle {
  constructor(mesh, spec, opts = {}) {
    this.mesh = mesh;
    this.spec = spec;
    this.perf = spec.perf;
    this.d = derive(spec.perf);
    this.halfLen = mesh.userData.halfLen ?? spec.dims.length / 2;
    this.halfWid = mesh.userData.halfWid ?? spec.dims.width / 2;
    this.wheelbase = (spec.axleF ?? 1.4) - (spec.axleR ?? -1.4);

    this.s = 0; this.u = LANES[1]; this.v = 30;
    this.psi = 0; this.dir = opts.dir ?? 1;          // +1 with us, -1 oncoming
    this.gear = 1; this.rpm = 1000; this.shiftT = 0;
    this.aLong = 0; this.aLat = 0; this.slip = 0;
    this.damage = 0; this.offroad = false; this.scrape = 0;
    this.hand = 0;                          // handbrake, 0..1
    this.kind = opts.kind || 'traffic';
    this.name = opts.name || spec.name;
    this.active = true;
    this.headlights = false;
    this.brake = 0;
    this._wheelAngle = 0;
    mesh.rotation.order = 'YXZ';
  }

  /* --------------------------------------------------------- longitudinal */
  stepLong(dt, throttle, brake, ctx) {
    const d = this.d, p = this.perf;
    const v = Math.max(0.5, this.v);
    let F = 0;
    this.shiftT = Math.max(0, this.shiftT - dt);
    const cut = this.shiftT > 0 ? 0.12 : 1;
    if (throttle > 0) {
      const grip = d.aMax * p.mass * d.drive * (this.offroad ? 0.42 : 1);
      F += Math.min(d.P * throttle * cut / v, grip);
    }
    F -= d.k * v * v;                                       // aerodynamic drag
    F -= d.roll * (this.offroad ? 9 : 1);                   // rolling resistance
    const c = sample(this.s);
    F -= p.mass * G * c.grade * this.dir;                   // gradient
    if (brake > 0) F -= brake * d.aMax * p.mass * (this.offroad ? 0.45 : 0.88);
    /* Handbrake locks the rear axle only: a strong retardation, nothing like
       the full braking system, and it costs you most of your rear grip. */
    if (this.hand > 0) F -= this.hand * d.aMax * p.mass * 0.34;

    this.aLong = F / p.mass;
    this.v = Math.max(0, this.v + this.aLong * dt);

    // gear + rpm, for the cluster and the engine note
    if (this.shiftT <= 0) {
      let g = this.gear;
      while (g < d.gearTop.length - 1 && this.v > d.gearTop[g]) g++;
      while (g > 0 && this.v < d.gearTop[g - 1] * 0.95) g--;   // 5 % hysteresis band
      if (g !== this.gear) { if (g > this.gear) this.shiftT = 0.14; this.gear = g; }
    }
    const g = this.gear;
    const lo = g === 0 ? 0 : d.gearTop[g - 1], hi = d.gearTop[g];
    const f = hi > lo ? (this.v - lo) / (hi - lo) : 0;
    const target = 900 + Math.min(1, Math.max(0, f)) * (p.redline - 900);
    this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
    this.brake = brake;
  }

  /* -------------------------------------------------------------- lateral */
  stepLat(dt, steer, ctx) {
    const d = this.d;
    const c = sample(this.s);
    const v = this.v;
    // friction circle: what's left for cornering after longitudinal demand
    const used = Math.min(1, Math.abs(this.aLong) / d.aMax);
    const gripMul = (this.offroad ? 0.45 : 1) * (1 - 0.42 * this.hand);
    const latMax = d.aMax * gripMul * Math.sqrt(Math.max(0.10, 1 - used * used * 0.85));

    // steer angle, tapering with speed the way a real rack feels
    const dMax = 0.52 / (1 + v * 0.055);
    let delta = steer * dMax;
    // clamp to what the tyres can actually do
    if (v > 4) {
      const maxDelta = Math.atan(latMax * this.wheelbase / (v * v));
      delta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    }
    this._wheelAngle = delta;

    const yawRate = (v / this.wheelbase) * Math.tan(delta);
    this.aLat = v * yawRate;
    // heading relative to the road: subtract the road's own rotation
    this.psi += (yawRate - v * c.curv * this.dir) * dt;
    this.psi = Math.max(-0.7, Math.min(0.7, this.psi));

    // sliding: rear-drive cars step out when you ask too much
    const demand = Math.abs(this.aLat) / Math.max(1, latMax);
    this.slip += ((demand > 0.96 ? demand - 0.96 : -0.25) * 4) * dt;
    this.slip = Math.max(0, Math.min(1, this.slip));

    this.u += v * Math.sin(this.psi) * this.dir * dt;
    this.s += v * Math.cos(this.psi) * this.dir * dt;

    // self-centring: the car naturally settles parallel to the road
    this.psi *= 1 - Math.min(0.9, dt * 2.4);

    // ---- surface & furniture
    const pr = pavedRange(this.s);
    const au = Math.abs(this.u);
    this.offroad = au > pr.outer + 0.35 || au < pr.inner - 0.1;
    const railOuter = outerBarrier(this.s) - 0.16;
    const railInner = 1.62 + 0.16;
    this.scrape = 0;
    if (au + this.halfWid * 0.75 > railOuter) {
      this.u = Math.sign(this.u) * (railOuter - this.halfWid * 0.75);
      this.psi *= 0.25; this.v *= 1 - 2.2 * dt; this.scrape = 1;
      this.damage = Math.min(100, this.damage + 5 * dt * (this.v / 40));
    }
    if (au - this.halfWid * 0.75 < railInner) {
      this.u = Math.sign(this.u || 1) * (railInner + this.halfWid * 0.75);
      this.psi *= 0.25; this.v *= 1 - 2.2 * dt; this.scrape = 1;
      this.damage = Math.min(100, this.damage + 5 * dt * (this.v / 40));
    }
  }

  /* ---------------------------------------------------------- mesh update */
  sync(dt) {
    const c = sample(this.s);
    const w = toWorld(this.s, this.u);
    const m = this.mesh;
    m.position.set(w.x, w.y, w.z);
    m.rotation.y = c.head + this.psi + (this.dir < 0 ? Math.PI : 0);
    const pitch = -Math.atan(c.grade) * this.dir - this.aLong * 0.0035 * this.dir;
    m.rotation.x = pitch;
    m.rotation.z = Math.max(-0.06, Math.min(0.06, this.aLat * 0.0055)) * this.dir;

    const ws = m.userData.wheels;
    if (ws) {
      this._wheelAngle = this._wheelAngle || 0;
      for (const wh of ws) {
        const r = wh.userData.radius || 0.34;
        if (wh.userData.spin) wh.userData.spin.rotation.x -= (this.v / r) * dt;
        if (wh.userData.front) wh.rotation.y = this._wheelAngle;
      }
    }
    if (m.userData.tailMat) {
      m.userData.tailMat.emissiveIntensity = 0.55 + this.brake * 2.6;
    }
    if (m.userData.headMat) {
      m.userData.headMat.emissiveIntensity = this.flashOn ? 16 : (this.headlights ? 2.2 : 0.4);
    }
    const glows = m.userData.glows;
    if (glows && glows.length) {
      const want = this.flashOn ? 1 : (this.headlights ? 0.22 : 0);
      for (const sp of glows) {
        sp.visible = want > 0.01;
        sp.material.opacity = want;
      }
    }
  }
}

/* ========================================================== the player car */
export class Player extends Vehicle {
  constructor(id, paint) {
    const spec = CARS[id];
    const mesh = buildCar(id, { paint });
    super(mesh, spec, { kind: 'player' });
    this.id = id;
    this.u = LANES[0];
    this.vmaxSeen = 0;
    this.fines = 0; this.points = 0; this.tickets = [];
    this.stoppedT = 0;
  }
  control(dt, input, ctx) {
    if (this.stoppedT > 0) {
      /* Verkehrskontrolle. Keep rolling at walking-out pace until actually on
         the hard shoulder — lateral movement is v·sin(psi), so a car that
         brakes to a standstill first can never steer off the carriageway and
         you end up parked in a live lane. */
      this.stoppedT -= dt;
      const target = GEO.kerbOut + GEO.shoulder * 0.5;
      const err = target - this.u;
      const arrived = Math.abs(err) < 0.7;
      this.pulledOver = arrived && this.v < 1.5;
      const wantV = arrived ? 0 : 10;
      let thr = 0, brk = 0;
      if (this.v > wantV + 0.5) brk = Math.min(1, 0.18 + (this.v - wantV) * 0.05);
      else if (this.v < wantV - 0.5) thr = 0.32;
      this.stepLong(dt, thr, brk, ctx);
      this.stepLat(dt, Math.max(-0.6, Math.min(0.6, err * 0.30)), ctx);
      if (this.v < 0.3) this.v = 0;
      return;
    }
    let thr = input.throttle, brk = input.brake;
    if (this.damage >= 100) { thr = 0; brk = Math.max(brk, 0.5); }
    this.hand = input.handbrake ? 1 : 0;
    this.stepLong(dt, thr, brk, ctx);
    this.stepLat(dt, input.steer, ctx);
    if (this.hand) this.slip = Math.min(1, this.slip + dt * 1.6);
    this.vmaxSeen = Math.max(this.vmaxSeen, this.v * KMH);
  }
}

/* ============================================================== traffic AI */
const TRAFFIC_MIX = [
  ['kombi', 0.28], ['hatch', 0.26], ['taxi', 0.16], ['van', 0.14], ['truck', 0.16],
];
const TRAFFIC_PAINTS = [
  0x9aa0a6, 0xb8bcbf, 0x2b2e33, 0xe6e7e4, 0x5b6167, 0x1f3550,
  0x6c3a2e, 0x2f4a3a, 0x8b1d20, 0xd6d2c4,
];

function pick(rand, mix) {
  let r = rand(), acc = 0;
  for (const [k, p] of mix) { acc += p; if (r <= acc) return k; }
  return mix[0][0];
}

export class TrafficCar extends Vehicle {
  constructor(mesh, spec, opts) {
    super(mesh, spec, opts);
    this.lane = 1;
    this.targetU = LANES[1];
    this.cruise = 30;
    this.react = 0.25 + Math.random() * 0.55;
    this.courtesy = Math.random();          // will they move over for you?
    this.flashHold = 0;                     // seconds of flashing left
    this.flashPhase = 0;                    // continuous, drives the pulse pattern
    this.warnFlash = false;                 // warning you about something ahead
    this.flashOn = false;
  }

  /** simple lane-discipline driver with a car-following model */
  drive(dt, ctx) {
    const lim = limitAt(this.s);
    const sec = sectionAt(this.s);
    let want = this.cruise;
    if (lim !== Infinity) want = Math.min(want, lim / KMH + 1.5);
    if (sec.works) want = Math.min(want, 24);
    if (this.isTruck) want = Math.min(want, 24.5);

    // ---- car following: look for the nearest thing ahead in my lane
    const ahead = ctx.nearestAhead(this, this.lane);
    let brake = 0, thr = 1;
    if (ahead) {
      const gap = ahead.gap - this.halfLen - ahead.v.halfLen;
      const dv = this.v - ahead.v.v;
      const safe = 16 + this.v * 1.35;
      if (gap < safe) {
        const urgency = Math.min(1, (safe - gap) / safe + Math.max(0, dv) * 0.09);
        want = Math.min(want, ahead.v.v - 0.5);
        if (gap < safe * 0.8 && dv > 0.5) brake = Math.min(1, urgency);
      }
      // overtake?
      if (!this.isTruck && this.lane === 1 && dv > 1.5 && gap < 90) {
        const clear = ctx.laneClear(this, 0, -Math.max(70, this.v * 3.2), 55);
        if (clear) { this.lane = 0; }
      }
    }
    // ---- Rechtsfahrgebot: get back right when the road is clear
    if (this.lane === 0) {
      const rightAhead = ctx.nearestAhead(this, 1);
      const rightClear = ctx.laneClear(this, 1, -22, 60) && (!rightAhead || rightAhead.gap > 75);
      if (rightClear && !this.overtaking) this.lane = 1;
    }
    // ---- a fast car closing from behind: most people move over
    const behind = ctx.fastBehind(this);
    if (behind && this.lane === 0) {
      if (this.courtesy > 0.14 && ctx.laneClear(this, 1, -18, 38)) this.lane = 1;
      if (this.flashHold <= 0 && !this.warnFlash && behind < 90) this.flashHold = FLASH_DUR;
    }
    /* Someone warning you about a camera keeps flashing until you have actually
       gone past them — a driver does not flick their lights once and give up
       while you are still half a kilometre away. */
    if (this.warnFlash) {
      const ps = ctx.playerS;
      if (ps === undefined || this.s <= ps + 4) { this.warnFlash = false; this.flashHold = 0; }
      else this.flashHold = 0.25;
    }
    this.flashHold = Math.max(0, this.flashHold - dt);
    if (this.flashHold > 0) this.flashPhase += dt; else this.flashPhase = 0;
    // on/off pattern, so it reads as flicked headlights rather than main beam
    this.flashOn = this.flashHold > 0 && Math.floor(this.flashPhase / FLASH_PULSE) % 2 === 0;

    if (this.v < want - 0.4) { thr = 1; }
    else if (this.v > want + 0.4) { thr = 0; brake = Math.max(brake, Math.min(0.55, (this.v - want) * 0.09)); }
    else thr = 0.35;

    this.targetU = LANES[this.lane] * (this.dir > 0 ? 1 : -1);
    const err = (this.targetU - this.u) * this.dir;
    const steer = Math.max(-0.5, Math.min(0.5, err * 0.30));

    this.stepLong(dt, thr, brake, ctx);
    this.stepLat(dt, steer, ctx);
    this.headlights = ctx.dark || this.flashOn;
  }
}

/* ------------------------------------------------------------ rival racers */
const RIVAL_NAMES = ['R. Vettel', 'M. Aicher', 'K. Brandt'];

export class Rival extends TrafficCar {
  constructor(mesh, spec, opts) {
    super(mesh, spec, opts);
    this.kind = 'rival';
    this.aggression = opts.aggression ?? 0.85;
    this.lawAbiding = opts.lawAbiding ?? 0.35;   // how much they respect limits
    this.finished = false; this.finishT = 0;
    this.fines = 0; this.points = 0;
    this.lane = 0;
  }
  drive(dt, ctx) {
    const lim = limitAt(this.s);
    const sec = sectionAt(this.s);
    let want = this.d.vmax * (0.86 + this.aggression * 0.12);
    if (lim !== Infinity) {
      // they creep over the limit by an amount set by how law-abiding they are
      want = Math.min(want, lim / KMH * (1.04 + (1 - this.lawAbiding) * 0.42));
    }
    if (sec.works) want = Math.min(want, 30);

    // corner speed: don't ask more of the tyres than they have
    const look = 90 + this.v * 1.6;
    let kMax = 0;
    for (let d = 20; d < look; d += 20) kMax = Math.max(kMax, Math.abs(sample(this.s + d).curv));
    if (kMax > 1e-5) want = Math.min(want, Math.sqrt(this.d.aMax * 0.90 / kMax));

    // pick a lane: overtake on the left, dive right if the left is blocked
    let brake = 0, thr = 1;
    const aheadL = ctx.nearestAhead(this, 0), aheadR = ctx.nearestAhead(this, 1);
    const gapOf = (a) => a ? a.gap - this.halfLen - a.v.halfLen : 9999;
    const gL = gapOf(aheadL), gR = gapOf(aheadR);
    if (this.lane === 0 && gL < 60 && gR > gL + 45) this.lane = 1;
    else if (this.lane === 1 && gR < 70 && gL > gR + 20) this.lane = 0;
    const gap = this.lane === 0 ? gL : gR;
    const lead = this.lane === 0 ? aheadL : aheadR;
    if (lead && gap < 999) {
      const safe = 9 + this.v * (0.55 + (1 - this.aggression) * 0.7);
      if (gap < safe) {
        want = Math.min(want, lead.v.v);
        if (gap < safe * 0.6) brake = Math.min(1, (safe - gap) / safe);
      }
    }
    if (this.v < want - 0.5) thr = 1;
    else if (this.v > want + 0.5) { thr = 0; brake = Math.max(brake, Math.min(0.8, (this.v - want) * 0.11)); }
    else thr = 0.4;

    this.targetU = LANES[this.lane];
    const err = this.targetU - this.u;
    const steer = Math.max(-0.6, Math.min(0.6, err * 0.34));
    this.stepLong(dt, thr, brake, ctx);
    this.stepLat(dt, steer, ctx);
  }
}

/* ==================================================== the traffic director */
export class Traffic {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.same = [];      // travelling with us
    this.opp = [];       // oncoming carriageway
    this.rivals = [];
    this.all = [];
  }

  _make(kind, dir) {
    let mesh, spec;
    if (kind === 'truck') {
      mesh = buildTruck({
        cab: TRAFFIC_PAINTS[Math.floor(this.rand() * TRAFFIC_PAINTS.length)],
        box: this.rand() < 0.6 ? 0xe9eae7 : 0xc9d2dc,
        plate: randomPlate(this.rand),
      });
      spec = { perf: mesh.userData.perf, dims: mesh.userData.dims, axleF: 1.35, axleR: -1.35 };
      const t = new TrafficCar(mesh, spec, { dir, kind: 'truck' });
      t.isTruck = true;
      return t;
    }
    spec = CARS[kind];
    mesh = buildCar(kind, {
      paint: TRAFFIC_PAINTS[Math.floor(this.rand() * TRAFFIC_PAINTS.length)],
      plate: randomPlate(this.rand),
    });
    return new TrafficCar(mesh, spec, { dir, kind: 'traffic' });
  }

  build(playerS, counts = { same: 15, opp: 11 }) {
    for (let i = 0; i < counts.same; i++) {
      const kind = pick(this.rand, TRAFFIC_MIX);
      const t = this._make(kind, 1);
      this.same.push(t); this.all.push(t); this.scene.add(t.mesh);
      this._placeSame(t, playerS, true);
    }
    for (let i = 0; i < counts.opp; i++) {
      const kind = pick(this.rand, TRAFFIC_MIX);
      const t = this._make(kind, -1);
      this.opp.push(t); this.all.push(t); this.scene.add(t.mesh);
      this._placeOpp(t, playerS, true);
    }
  }

  addRivals(playerS, playerId) {
    const pool = ['m5', 'rs6', 'amg', 'turbo'].filter(x => x !== playerId);
    for (let i = 0; i < 3; i++) {
      const id = pool[i % pool.length];
      const spec = CARS[id];
      const paint = spec.paints[(i + 1) % spec.paints.length].c;
      const mesh = buildCar(id, { paint, plate: randomPlate(this.rand) });
      const r = new Rival(mesh, spec, {
        dir: 1, name: RIVAL_NAMES[i],
        aggression: 0.74 + i * 0.10,
        // they don't want points either — beating them means using the
        // restricted sections harder than they dare
        lawAbiding: 0.94 - i * 0.13,
      });
      r.s = playerS + 26 + i * 17;
      r.u = i % 2 ? LANES[1] : LANES[0];
      r.v = 25;
      r.cruise = r.d.vmax * 0.9;
      this.rivals.push(r); this.all.push(r); this.scene.add(mesh);
    }
  }

  _placeSame(t, playerS, initial) {
    const ahead = initial ? 170 + this.rand() * 1500 : 700 + this.rand() * 800;
    t.s = Math.min(LENGTH - 60, Math.max(30, playerS + ahead));
    t.isTruck = t.isTruck || false;
    t.lane = t.isTruck ? 1 : (this.rand() < 0.72 ? 1 : 0);
    t.u = LANES[t.lane];
    t.cruise = t.isTruck ? 22.5 + this.rand() * 2.5 : (28 + this.rand() * 17);
    t.v = t.cruise;
    t.psi = 0;
    t.courtesy = this.rand();
    if (t.mesh.userData.paintMat && this.rand() < 0.5) {
      t.mesh.userData.paintMat.color.setHex(TRAFFIC_PAINTS[Math.floor(this.rand() * TRAFFIC_PAINTS.length)]);
    }
  }
  _placeOpp(t, playerS, initial) {
    const ahead = initial ? 220 + this.rand() * 1700 : 900 + this.rand() * 900;
    t.s = Math.min(LENGTH - 20, Math.max(20, playerS + ahead));
    t.lane = t.isTruck ? 1 : (this.rand() < 0.75 ? 1 : 0);
    t.u = -LANES[t.lane];
    t.cruise = t.isTruck ? 22.5 + this.rand() * 2 : (30 + this.rand() * 16);
    t.v = t.cruise;
    t.psi = 0;
    t.warnFlash = false; t.flashHold = 0; t.flashPhase = 0; t.flashOn = false;
  }

  /* ----------------------------------------------------- spatial queries */
  nearestAhead(me, lane) {
    const laneU = LANES[lane] * (me.dir > 0 ? 1 : -1);
    let best = null;
    for (const o of this.all) {
      if (o === me || !o.active || o.dir !== me.dir) continue;
      if (Math.abs(o.u - laneU) > GEO.laneWidth * 0.72) continue;
      const gap = (o.s - me.s) * me.dir;
      if (gap <= 0 || gap > 420) continue;
      if (!best || gap < best.gap) best = { v: o, gap };
    }
    return best;
  }
  laneClear(me, lane, back, front) {
    const laneU = LANES[lane] * (me.dir > 0 ? 1 : -1);
    for (const o of this.all) {
      if (o === me || !o.active || o.dir !== me.dir) continue;
      if (Math.abs(o.u - laneU) > GEO.laneWidth * 0.8) continue;
      const rel = (o.s - me.s) * me.dir;
      if (rel > back && rel < front) return false;
    }
    return true;
  }
  fastBehind(me) {
    let best = null;
    for (const o of this.all) {
      if (o === me || !o.active || o.dir !== me.dir) continue;
      if (Math.abs(o.u - me.u) > GEO.laneWidth * 0.85) continue;
      const rel = (me.s - o.s) * me.dir;
      if (rel <= 0 || rel > 220) continue;
      if (o.v < me.v + 4) continue;
      if (!best || rel < best) best = rel;
    }
    return best;
  }

  /* ------------------------------------------------------------- stepping */
  update(dt, player, ctx) {
    this.playerS = player.s;               // so drivers know when you are past
    for (const t of this.same) {
      t.drive(dt, ctx);
      if (t.s < player.s - 260 || t.s > player.s + 2100) this._placeSame(t, player.s, false);
      t.sync(dt);
    }
    for (const t of this.opp) {
      t.drive(dt, ctx);
      if (t.s < player.s - 320 || t.s > player.s + 2300) this._placeOpp(t, player.s, false);
      t.sync(dt);
    }
    for (const r of this.rivals) {
      if (r.finished) { r.sync(dt); continue; }
      r.drive(dt, ctx);
      if (r.s >= LENGTH - 20) { r.finished = true; r.finishT = ctx.raceTime; }
      r.sync(dt);
    }
  }

  /**
   * Clear a path to the hard shoulder for a traffic stop. Traffic in the way
   * pulls left and slows; anything actually in the space we are about to
   * occupy is recycled far ahead, because being dragged through a Kombi looks
   * far worse than a car quietly no longer being there.
   */
  clearPath(player) {
    for (const t of this.same) {
      const rel = t.s - player.s;
      if (rel < -50 || rel > 110) continue;
      // in the space we are moving into?
      const inTheWay = Math.abs(rel) < 26 && t.u > GEO.laneL + 1.2;
      if (inTheWay) { this._placeSame(t, player.s, false); continue; }
      t.lane = 0;                            // move over
      t.cruise = Math.min(t.cruise, 24);     // and ease off
    }
  }

  /** Anyone on our carriageway within `range` metres ahead of s. */
  oncomingFlashers(s, from, to) {
    const out = [];
    for (const t of this.opp) {
      const rel = t.s - s;
      if (rel > from && rel < to) out.push(t);
    }
    return out;
  }

  /** Guarantee one readable oncoming headlight warning for the lesson. */
  stageTutorialFlasher(playerS) {
    const t = this.opp[0];
    if (!t) return null;
    t.s = playerS + 150;
    t.lane = 0;
    t.u = -LANES[0];
    t.v = 31;
    t.cruise = 31;
    t.psi = 0;
    t.warnFlash = false; t.flashHold = 0; t.flashPhase = 0; t.flashOn = false;
    t.sync(0);
    return t;
  }

  /** Keep ordinary traffic from masking the lesson's parked camera van. */
  clearTutorialCameraSightline(cameraS, playerS) {
    for (const t of this.same) {
      if (t.s < playerS - 25 || t.s > cameraS + 220) continue;
      /* Recycle beyond the whole teaching area, not merely into the other
         lane: a lorry in either lane can fill the camera spotlight. */
      this._placeSame(t, cameraS + 260, false);
      t.sync(0);
    }
  }
}

/* ============================================================= collisions */
export function resolveCollisions(player, list, onHit, dt = 0.016) {
  if (player.stoppedT > 0) return;      // parked on the shoulder with the police
  for (const o of list) {
    if (!o.active || o === player) continue;
    o._hitCool = Math.max(0, (o._hitCool || 0) - dt);
    const ds = (o.s - player.s);
    const du = o.u - player.u;
    const lenSum = player.halfLen + o.halfLen;
    const widSum = player.halfWid + o.halfWid;
    if (Math.abs(ds) > lenSum || Math.abs(du) > widSum) continue;

    const closing = player.v * player.dir - o.v * o.dir;
    const overlapS = lenSum - Math.abs(ds);
    const overlapU = widSum - Math.abs(du);

    if (overlapU < overlapS) {
      // side swipe — shove both sideways, scrub a little speed
      const push = Math.sign(du || 1);
      player.u -= push * overlapU * 0.55;
      o.u += push * overlapU * 0.45;
      player.psi -= push * 0.05;
      player.v *= 0.985;
      const sev = Math.min(1, Math.abs(closing) / 30 + 0.15);
      if (o._hitCool <= 0) {
        player.damage = Math.min(100, player.damage + sev * 3.0);
        o._hitCool = 0.35;
        onHit('side', sev);
      }
    } else {
      // nose-to-tail
      const push = Math.sign(ds || 1);
      player.s -= push * overlapS * 0.6;
      o.s += push * overlapS * 0.4;
      const rel = Math.abs(closing);
      if (push > 0) {                        // we ran into the back of them
        player.v = Math.max(o.v * 0.72, player.v - rel * 0.72);
        o.v += rel * 0.18;
      } else {
        player.v += rel * 0.10;
      }
      const sev = Math.min(1, rel / 26 + 0.2);
      if (o._hitCool <= 0) {
        // hitting someone is on you; being hit from behind much less so
        const blame = push > 0 ? 1 : 0.28;
        player.damage = Math.min(100, player.damage + sev * 13 * blame);
        o._hitCool = 0.55;
        onHit('rear', sev * blame);
      }
    }
  }
}
