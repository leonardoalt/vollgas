/* ==========================================================================
   vehicles.js — driving model, traffic and rival racers.

   Everything lives in track space: s (metres along the A81), u (metres right
   of the median centre), plus a heading offset psi from the road tangent.

   Longitudinally it is a power-limited point mass with real drag. Every
   published figure — 0-100, top speed, braking distance — comes out of
   stepLong(), and stepLong() is unchanged.

   Laterally there are two models.

   The player runs a *dynamic* single-track model with genuine yaw inertia:
   slip angles at each axle, a saturating tyre curve, per-axle vertical load
   from real weight transfer, and a friction circle per axle so the newtons
   spent accelerating or braking are newtons the tyres cannot spend cornering.
   The car therefore rotates with mass, settles on its own through the tyres
   rather than by having its heading forced back to parallel, and has a real
   understeer/oversteer balance — including throttle-induced oversteer for the
   rear-drive AMG.

   Traffic and patrol cars run the original cheap *kinematic* model, verbatim.
   Their AI is tuned around its damping, they are only ever seen from outside
   at distance, and there are two dozen of them in every frame.
   ========================================================================== */
import * as THREE from 'three';
import {
  sample, toWorld, LANES, GEO, LENGTH, sectionAt, limitAt, pavedRange, outerBarrier,
} from './track.js';
import { buildCar, buildTruck, CARS, randomPlate } from './carFactory.js';
import { chassis, axleFy, muLeft, loadMul, steerLock, HAND_LAT_CUT } from './tyres.js';
import { Rack, laneAssist } from './steering.js';
import { BODY } from './suspension.js';

export { laneAssist };

const G = 9.81;
/* Deliberately front-heavy: under hard braking the rear axle is unloaded, and
   charging too much brake force to it makes a tiny bend become lift-off
   oversteer. This bias keeps emergency/police stops directionally stable. */
const BRAKE_FRONT = 0.70;
/* The braking model represents road-car ABS, which preserves substantially
   more lateral authority than a fully locked friction-circle calculation.
   The full force still decelerates the car; only this share is charged against
   the axle's cornering budget. */
const BRAKE_FX_USE = 0.35;
/* A locked/sliding rear tyre does not follow the ordinary friction-circle
   equation cleanly. Charge only this share of handbrake force against its
   lateral budget; the full force still slows the car in stepLong(). */
const HAND_FX_USE = 0.45;
/* Guards for the dynamic lateral model. The heading clamp is wider than the
   kinematic one (0.7) because a car with real yaw inertia is allowed to get
   properly sideways before the model gives up on it. */
const PSI_MAX_DYN = 1.05;
const R_MAX = 2.6;
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

/** Engine speed implied by road speed and the selected gear's ratio. */
export function rpmForGear(speed, gear, drivetrain, redline, idle = 900) {
  const top = drivetrain.gearTop[Math.max(0, Math.min(gear, drivetrain.gearTop.length - 1))];
  return Math.max(idle, Math.min(redline, redline * Math.max(0, speed) / top));
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

    this.ch = chassis(spec, opts.id);
    /* dynamic lateral model: the player only. See the header. */
    this.dyn = !!opts.dyn;

    this.s = 0; this.u = LANES[1]; this.v = 30;
    this.psi = 0; this.dir = opts.dir ?? 1;          // +1 with us, -1 oncoming
    this.gear = 1; this.rpm = 1000; this.shiftT = 0;
    this.aLong = 0; this.aLat = 0; this.slip = 0;

    /* Lateral state proper: body-frame sideslip velocity (positive to the
       car's right) and yaw rate. These two are what replace the old trick of
       decaying psi towards zero every frame. */
    this.vy = 0; this.r = 0;
    this.fxF = 0; this.fxR = 0;              // tyre longitudinal force, per axle
    this.slipF = 0; this.slipR = 0;          // slip angles, rad
    this.steerAngle = 0;                     // road-wheel angle, rad
    this.balance = 0;                        // >0 oversteering, <0 understeering
    this._align = 0;
    this.rack = this.dyn ? new Rack() : null;
    this.sRoll = BODY.roll();
    this.sPitch = BODY.pitch();
    this.sHeave = this.dyn ? BODY.heave() : null;
    this.roll = 0; this.pitch = 0;
    this._dGds = 0;
    this.damage = 0; this.offroad = false; this.scrape = 0;
    this.hand = 0;                          // handbrake, 0..1
    this._counterDir = 0;                   // latched ESC direction during a reversal
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
    let tract = 0;
    if (throttle > 0) {
      const grip = d.aMax * p.mass * d.drive * (this.offroad ? 0.42 : 1);
      tract = Math.min(d.P * throttle * cut / v, grip);
      F += tract;
    }
    F -= d.k * v * v;                                       // aerodynamic drag
    F -= d.roll * (this.offroad ? 9 : 1);                   // rolling resistance
    const c = sample(this.s);
    F -= p.mass * G * c.grade * this.dir;                   // gradient
    let fbrake = 0;
    if (brake > 0) {
      fbrake = brake * d.aMax * p.mass * (this.offroad ? 0.45 : 0.88);
      F -= fbrake;
    }
    /* Handbrake locks the rear axle only: a strong retardation, nothing like
       the full braking system, and it costs you most of your rear grip. */
    let fhand = 0;
    if (this.hand > 0) {
      fhand = this.hand * d.aMax * p.mass * 0.34;
      F -= fhand;
    }

    /* Book those same newtons to their axles. Nothing above is altered — the
       total F is arithmetically identical to what it always was, which is why
       dev/phys.mjs cannot drift — but the lateral model needs to know how much
       of each axle's grip is already spent before it asks the tyres for any
       cornering force. This bookkeeping is what gives the rear-drive AMG
       throttle-induced oversteer and every car understeer on the brakes. */
    const rb = this.ch ? this.ch.rearDrive : (p.awd ? 0.60 : 1);
    this.fxF = tract * (1 - rb) - fbrake * BRAKE_FRONT * BRAKE_FX_USE;
    this.fxR = tract * rb - fbrake * (1 - BRAKE_FRONT) * BRAKE_FX_USE
      - fhand * HAND_FX_USE;

    this.aLong = F / p.mass;
    this.v = Math.max(0, this.v + this.aLong * dt);

    // gear + rpm, for the cluster and the engine note
    if (this.shiftT <= 0) {
      let g = this.gear;
      while (g < d.gearTop.length - 1 && this.v > d.gearTop[g]) g++;
      while (g > 0 && this.v < d.gearTop[g - 1] * 0.95) g--;   // 5 % hysteresis band
      if (g !== this.gear) { if (g > this.gear) this.shiftT = 0.14; this.gear = g; }
    }
    // RPM follows the actual ratio: each gear reaches redline at its own top
    // speed. At an upshift the same road speed therefore lands part-way up the
    // next gear instead of resetting every gear to the same 900 rpm floor.
    const target = rpmForGear(this.v, this.gear, d, p.redline);
    this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
    this.brake = brake;
  }

  /* -------------------------------------------------------------- lateral */
  stepLat(dt, steer, ctx) {
    if (this.dyn) this._latDynamic(dt, steer, ctx);
    else this._latKinematic(dt, steer, ctx);
    this._surface(dt);
  }

  /* ------------------------------------------------ kinematic lateral model
     The original model, verbatim, still driving every traffic and patrol car.
     It reads a yaw rate straight off the steer angle (so no rotational
     inertia) and force-decays psi towards zero every frame, which is a
     self-centring hack rather than physics. Both are fine for a car you only
     ever see from outside, and the traffic AI's simple proportional lane
     controllers are tuned around exactly that damping. */
  _latKinematic(dt, steer, ctx) {
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
  }

  /* ---------------------------------------------------- surface & furniture
     Shared by both lateral models: what is under the wheels, and what happens
     when you put a flank into a Stahlschutzplanke. */
  _surface(dt) {
    const pr = pavedRange(this.s);
    const au = Math.abs(this.u);
    this.offroad = au > pr.outer + 0.35 || au < pr.inner - 0.1;
    const railOuter = outerBarrier(this.s) - 0.16;
    const railInner = 1.62 + 0.16;
    this.scrape = 0;
    if (au + this.halfWid * 0.75 > railOuter) {
      this.u = Math.sign(this.u) * (railOuter - this.halfWid * 0.75);
      this.psi *= 0.25; this.r *= 0.25; this.vy *= 0.15;
      this.v *= 1 - 2.2 * dt; this.scrape = 1;
      this.damage = Math.min(100, this.damage + 5 * dt * (this.v / 40));
    }
    if (au - this.halfWid * 0.75 < railInner) {
      this.u = Math.sign(this.u || 1) * (railInner + this.halfWid * 0.75);
      this.psi *= 0.25; this.r *= 0.25; this.vy *= 0.15;
      this.v *= 1 - 2.2 * dt; this.scrape = 1;
      this.damage = Math.min(100, this.damage + 5 * dt * (this.v / 40));
    }
  }

  /* -------------------------------------------------- dynamic lateral model
     A single-track model with rotational mass. Per sub-step:

       loads      static weight distribution, plus longitudinal transfer from
                  whatever stepLong just did, plus the lateral transfer the
                  car is already carrying
       grip       per axle: a friction circle against that axle's own share of
                  the drive/brake force, then a load-sensitivity term so a
                  heavily loaded outside tyre gives a little back
       slip       af = atan((vy + a*r)/v) - delta,  ar = atan((vy - b*r)/v)
       forces     a saturating tyre curve: a peak, then a falloff
       integrate  vy from the total side force, r from the yaw *moment*

     Nothing forces psi anywhere. The car settles because the tyres damp vy
     and r, which is how a real car settles, and it keeps a heading error
     relative to the road until the driver steers it out — which is the whole
     difference between driving a car and sliding a brick sideways. */
  _latDynamic(dt, cmd, ctx) {
    const ch = this.ch, p = this.perf;
    const c = sample(this.s);
    const surf = this.offroad ? 0.45 : 1;

    // ---- vertical load per axle
    const dz = p.mass * this.aLong * ch.hCog / ch.L;      // + = onto the rear
    const fzF = Math.max(0.12 * ch.staticF, ch.staticF - dz);
    const fzR = Math.max(0.12 * ch.staticR, ch.staticR + dz);

    /* ---- grip left per axle. The handbrake's lateral cut lands on the rear
       only, because the rear is the axle that is locked. */
    const muBaseF = ch.mu * surf;
    const muBaseR = ch.mu * surf * (1 - HAND_LAT_CUT * this.hand);
    const ay0 = this.aLat;
    const muF = Math.max(0.05, muLeft(muBaseF, this.fxF, fzF)
      * loadMul(ay0, fzF, p.mass, ch.hCog, ch.track, ch.rollF));
    const muR = Math.max(0.05, muLeft(muBaseR, this.fxR, fzR)
      * loadMul(ay0, fzR, p.mass, ch.hCog, ch.track, 1 - ch.rollF));

    /* Sub-stepped: cornering stiffness over mass times speed is a stiff
       eigenvalue at low speed, and the game clamps dt to 0.05 s. Nine
       sub-steps of a two-state ODE for one car costs nothing, and it means a
       20 fps frame produces the same car as a 144 fps one. */
    const n = Math.min(14, Math.max(1, Math.ceil(dt / 0.006)));
    const h = dt / n;
    const rot = c.curv * this.dir;              // road's own yaw rate per m/s
    let fyF = 0, fyR = 0, af = 0, ar = 0;

    for (let i = 0; i < n; i++) {
      const v = this.v;
      const vr = Math.max(2.2, v);
      const delta = this.rack.step(h, cmd, this._align) * steerLock(ch, v);

      af = Math.atan((this.vy + ch.a * this.r) / vr) - delta;
      ar = Math.atan((this.vy - ch.b * this.r) / vr);
      fyF = axleFy(af, fzF, muF, ch.csF);
      fyR = axleFy(ar, fzR, muR, ch.csR);
      const cd = Math.cos(delta);

      const ay = (fyF * cd + fyR) / p.mass;
      const mz = ch.a * fyF * cd - ch.b * fyR;
      this.vy += (ay - this.r * v) * h;
      this.r += (mz / ch.iz) * h;

      /* Below walking-out speed the slip-angle formulation degenerates, so
         fade to the kinematic answer. Nothing is ever driven fast enough for
         that to be visible, and it is what keeps the pull-over stable. */
      if (v < 8) {
        const w = Math.min(1, Math.max(0, (v - 2.5) / 5.5));
        const rk = (v / ch.L) * Math.tan(delta);
        this.r = w * this.r + (1 - w) * rk;
        this.vy = w * this.vy + (1 - w) * rk * ch.b;
      }
      if (this.r > R_MAX) this.r = R_MAX; else if (this.r < -R_MAX) this.r = -R_MAX;
      const vyCap = 0.8 * Math.max(v, 5) + 3;
      if (this.vy > vyCap) this.vy = vyCap; else if (this.vy < -vyCap) this.vy = -vyCap;

      // heading relative to the road: subtract the road's own rotation
      this.psi += (this.r - v * rot) * h;
      if (this.psi > PSI_MAX_DYN) { this.psi = PSI_MAX_DYN; if (this.r > 0) this.r = 0; }
      else if (this.psi < -PSI_MAX_DYN) { this.psi = -PSI_MAX_DYN; if (this.r < 0) this.r = 0; }

      const cp = Math.cos(this.psi), sp = Math.sin(this.psi);
      this.u += (v * sp + this.vy * cp) * this.dir * h;
      this.s += (v * cp - this.vy * sp) * this.dir * h;

      /* Cornering drag: a tyre making side force at a slip angle costs you
         forward speed. Exactly zero in a straight line, so it cannot reach
         any figure dev/phys.mjs measures — but it means a big slide is slow. */
      const drag = (Math.abs(fyF * Math.sin(af)) + Math.abs(fyR * Math.sin(ar))) / p.mass;
      this.v = Math.max(0, this.v - drag * h);

      this.aLat = ay;
      this.steerAngle = delta;
      this._wheelAngle = delta;

      /* Self-aligning torque fed back to the rack, normalised by what the
         front axle can actually do, with the pneumatic trail collapsing as
         the front saturates — so the steering goes light just before the car
         runs wide, which is the only warning a real one gives you. */
      let nrm = fyF / Math.max(1, muF * fzF);
      if (nrm > 1.4) nrm = 1.4; else if (nrm < -1.4) nrm = -1.4;
      this._align = nrm * (1 - 0.28 * nrm * nrm);
    }

    this.slipF = af; this.slipR = ar;
    /* How far past its best each axle is, and which one is further: that is
       the understeer/oversteer balance, and it is a real number now. */
    const useF = Math.abs(af) / ch.peakF, useR = Math.abs(ar) / ch.peakR;
    this.balance = useR - useF;
    const target = Math.min(1, Math.max(0, (Math.max(useF, useR) - 0.85) / 0.75));
    this.slip += (target - this.slip) * Math.min(1, dt * 6);
    this.slip = Math.max(0, Math.min(1, this.slip));
  }

  /* ---------------------------------------------------------- mesh update */
  sync(dt) {
    const c = sample(this.s);
    const w = toWorld(this.s, this.u);
    const m = this.mesh;

    /* Body attitude as a sprung mass rather than an algebraic function of
       acceleration. The same steady-state lean and squat as before — a car
       holding 0.8 g leans exactly as far as it always did — but it now takes
       a couple of tenths to get there and overshoots once on the way. */
    const roll = this.sRoll.step(dt, Math.max(-0.06, Math.min(0.06, this.aLat * 0.0055)));
    const pitch = this.sPitch.step(dt, -this.aLong * 0.0035);
    this.roll = roll; this.pitch = pitch;

    let heave = 0;
    if (this.sHeave) {
      /* Float over a crest: for a moment the body carries on in a straight
         line while the road falls away underneath it. Low-passed, because the
         elevation profile's grade is only piecewise smooth. */
      const ds = this.s - (this._lastS ?? this.s);
      const dg = c.grade - (this._lastGrade ?? c.grade);
      this._lastS = this.s; this._lastGrade = c.grade;
      let raw = Math.abs(ds) > 0.05 ? dg / ds : 0;
      if (raw > 4e-4) raw = 4e-4; else if (raw < -4e-4) raw = -4e-4;
      this._dGds += (raw - this._dGds) * Math.min(1, dt * 8);
      const tgt = Math.max(-0.05, Math.min(0.05, -this.v * this.v * this._dGds * 0.016));
      heave = this.sHeave.step(dt, tgt);
    }

    m.position.set(w.x, w.y + heave, w.z);
    /* Track-space yaw is positive to the car's right, while THREE's positive
       rotation.y turns local +Z to the left of the track. Convert between the
       two conventions here. Using `+ psi` made the nose point left while the
       physics moved a player steering right to the right, so every manoeuvre
       looked like a sideways drift. `dir` reverses that conversion for an
       oncoming vehicle. */
    m.rotation.y = c.head - this.psi * this.dir + (this.dir < 0 ? Math.PI : 0);
    m.rotation.x = -Math.atan(c.grade) * this.dir + pitch * this.dir;
    m.rotation.z = roll * this.dir;

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
    super(mesh, spec, { kind: 'player', id, dyn: true });
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
      this.hand = 0;                 // never carry a player's handbrake into autopilot
      if (this._pullOverU === undefined) this._pullOverU = this.u;
      const shoulder = GEO.kerbOut + GEO.shoulder * 0.5;
      /* A stop can be triggered above 200 km/h. Brake in the current lane
         first; asking for the shoulder at that speed made the controller throw
         the car into a full spin before it had any chance to slow down. */
      const slowing = this.v > 17;
      const target = slowing ? this._pullOverU : shoulder;
      const err = shoulder - this.u;
      const arrived = !slowing && Math.abs(err) < 0.7;
      this.pulledOver = arrived && this.v < 1.5;
      const wantV = slowing ? 16 : (arrived ? 0 : 10);
      let thr = 0, brk = 0;
      if (this.v > wantV + 0.5) {
        /* Leave the tyres enough lateral budget to follow the road while the
           automated stop sheds speed. Full emergency braking plus even a tiny
           curvature correction can saturate opposite axles and start a spin. */
        const cap = slowing ? 0.55 : 0.78;
        brk = Math.min(cap, 0.18 + (this.v - wantV) * 0.05);
      }
      else if (this.v < wantV - 0.5) thr = 0.32;
      this.stepLong(dt, thr, brk, ctx);
      /* A car with yaw inertia needs a damped controller, not a bare gain on
         lateral error — that is an undamped second-order loop and it weaves. */
      const assist = slowing
        ? { kp: 0.65, kd: 2.1, lim: 0.35, ay: 3.5 }
        : { kp: 0.70, kd: 1.9, lim: 0.45, ay: 4.5 };
      this.stepLat(dt, laneAssist(this, target, assist), ctx);
      if (slowing) {
        /* The automated stop has the equivalent of ESC: damp excess yaw and
           sideslip around the road yaw rate while braking. This operates only
           during the non-interactive police deceleration phase. */
        const roadR = this.v * sample(this.s).curv * this.dir;
        const esc = Math.exp(-dt * 7);
        this.r = roadR + (this.r - roadR) * esc;
        this.vy *= esc;
      }
      if (this.v < 0.3) this.v = 0;
      return;
    }
    let thr = input.throttle, brk = input.brake;
    if (this.damage >= 100) { thr = 0; brk = Math.max(brk, 0.5); }
    const handWant = input.handbrake ? 1 : 0;
    this.hand += (handWant - this.hand) * Math.min(1, dt * (handWant ? 7 : 12));
    if (!handWant && this.hand < 0.01) this.hand = 0;
    this.stepLong(dt, thr, brk, ctx);
    /* Do not feed a simultaneous pair of binary full-scale inputs straight
       into the tyre model. A braking tyre has less useful steering range,
       while the remaining 28-40 % is still well above the demand needed for
       a decisive road turn. This prevents a one-frame force/yaw spike before
       the stability controller below gets to act. */
    const steerWhileStopping = input.steer
      * (1 - 0.60 * brk)
      * (1 - 0.72 * this.hand);
    this.stepLat(dt, steerWhileStopping, ctx);
    const stopping = Math.max(brk, this.hand);
    if (stopping > 0.02) {
      /* A binary key can ask for full lock and full braking indefinitely.
         Road-car ABS/ESC must preserve the requested direction without
         allowing that combination to wind the single-track model into a
         spin. Follow the driver's kinematic yaw demand, but bound it to a
         stable road-car turn rate. The handbrake gets the tighter envelope:
         it has no front/rear brake balance and a keyboard has no proportional
         counter-steer with which to catch a large rear slide. */
      const v = Math.max(6, this.v);
      const gripR = this.ch.ayMax / v;
      let rWant = (v / this.ch.L) * Math.tan(this.steerAngle);
      if (rWant > gripR) rWant = gripR;
      else if (rWant < -gripR) rWant = -gripR;
      const handMix = this.hand;
      const rCap = 0.22 + (0.15 - 0.22) * handMix; // 12.6 down to 8.6 deg/s
      if (rWant > rCap) rWant = rCap;
      else if (rWant < -rCap) rWant = -rCap;
      const esc = 1 - Math.exp(-dt * (8 + stopping * 10));
      this.r += (rWant - this.r) * esc;
      const hardR = rCap * 1.08;
      if (this.r > hardR) this.r = hardR;
      else if (this.r < -hardR) this.r = -hardR;
      this.vy *= Math.exp(-dt * stopping * 6);
      const vyCap = 0.045 * this.v + 0.35;
      if (this.vy > vyCap) this.vy = vyCap;
      else if (this.vy < -vyCap) this.vy = -vyCap;
    }
    /* Once the rack has crossed centre, counter-steering should cancel the
       old turn promptly. Saturated tyres otherwise limit the reversal to the
       old corner's yaw rate, making a 30-degree left-to-right correction take
       almost three seconds even though the controls themselves moved in
       0.25 s. Model the yaw-moment intervention of road-car ESC only while
       the driver's demand opposes the current velocity direction. */
    const travelHeading = this.psi + Math.atan2(this.vy, Math.max(4, this.v));
    const steerDir = Math.sign(input.steer);
    if (stopping > 0.02 || Math.abs(input.steer) <= 0.2) this._counterDir = 0;
    else if (!this._counterDir
      && this.v > 15
      && input.steer * travelHeading < -0.02
      && input.steer * this.steerAngle > 0) this._counterDir = steerDir;
    else if (this._counterDir && (steerDir !== this._counterDir
      || input.steer * this.psi >= 12 * Math.PI / 180)) this._counterDir = 0;
    if (this._counterDir) {
      const rWant = this._counterDir * 0.62; // 35.5 deg/s during correction
      this.r += (rWant - this.r) * (1 - Math.exp(-dt * 7));
    }
    else if (stopping <= 0.02 && this.v > 15 && thr < 0.85) {
      /* Lift-off removes the rear-axle load that was stabilising a full-lock
         turn. The simplified load/tyre model exaggerated that transient from
         an ordinary tightening line into 40-54 deg/s spins. Road-car ESC
         follows the steering request while coasting and rejects only that
         excess yaw; counter-steering above deliberately takes precedence. */
      const v = Math.max(6, this.v);
      const gripR = Math.min(0.30, this.ch.ayMax / v);
      let rWant = (v / this.ch.L) * Math.tan(this.steerAngle);
      if (rWant > gripR) rWant = gripR;
      else if (rWant < -gripR) rWant = -gripR;
      const authority = (0.85 - thr) / 0.85;
      this.r += (rWant - this.r) * (1 - Math.exp(-dt * (6 + 6 * authority)));
      const hardR = Math.min(0.34, gripR * 1.25);
      if (this.r > hardR) this.r = hardR;
      else if (this.r < -hardR) this.r = -hardR;
    }
    /* The saturating tyre curve deliberately permits under/oversteer, but a
       road car with ESC must not retain 20 degrees of body sideslip through a
       direction reversal. That made the nose point left while the velocity
       vector was still moving right, so no amount of faster keyboard/rack
       response could make the car obey. Leave ordinary sub-limit handling
       untouched and progressively trim only sideslip beyond three degrees. */
    const beta = Math.atan2(this.vy, Math.max(4, this.v));
    const betaSoft = 3 * Math.PI / 180;
    if (Math.abs(beta) > betaSoft) {
      const excess = Math.min(1, (Math.abs(beta) - betaSoft) / (6 * Math.PI / 180));
      const targetVy = Math.sign(beta) * Math.tan(betaSoft) * Math.max(4, this.v);
      const esc = 1 - Math.exp(-dt * (5 + 18 * excess));
      this.vy += (targetVy - this.vy) * esc;
      this.slip = Math.max(this.slip, excess);
    }
    if (this.hand) {
      this.slip = Math.min(1, this.slip + dt * 1.6);
    }
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
