/* ==========================================================================
   steering.js — the rack, and the lane-keeping assist the AI drivers use.

   Two things live here.

   `Rack` is what stands between a key being held down and the front wheels
   actually being turned. It is a second-order system with a hand-speed rate
   limit and a self-aligning-torque term fed back from the real front tyre
   force, so:
     · winding lock on has a rise time, not a ramp;
     · you have to hold the wheel against the tyres, and lose a little lock
       doing it;
     · the aligning torque stops growing once the front axle saturates — the
       steering goes light exactly when the front is about to run wide;
     · letting go unwinds the wheel and lets it *settle*, rather than snapping
       the car's heading back to parallel.

   `laneAssist` is the other half of the story. Once the car has genuine yaw
   inertia, a bare proportional controller on lateral error is an undamped
   second-order loop and it weaves. This is the properly damped version: it
   asks for a lateral acceleration and converts that to lock through the car's
   own understeer gradient, so one set of gains works at 30 km/h and at 300.
   ========================================================================== */

import { sample } from './track.js';
import { steerLock } from './tyres.js';

export class Rack {
  constructor(o = {}) {
    this.pos = 0;                       // rack position, -1..1
    this.vel = 0;                       // rack rate, full-lock per second
    /* how hard the driver holds the wheel where they want it */
    this.kHold = o.kHold ?? 200;
    /* ...and how loosely they hold it once they stop asking for anything */
    this.kLoose = o.kLoose ?? 84;
    this.zeta = o.zeta ?? 0.90;
    /* self-aligning torque. kAlign/kHold is the fraction of commanded lock
       you give up to the tyres at full cornering load: about 15 %. */
    this.kAlign = o.kAlign ?? 30;
    /* a hand can only move so fast: full lock in about a third of a second */
    this.rate = o.rate ?? 3.2;
  }

  reset() { this.pos = 0; this.vel = 0; }

  /**
   * @param h     sub-step, s
   * @param cmd   driver demand, -1..1
   * @param align normalised front-axle aligning torque, -1..1 (positive when
   *              the front tyres are pushing the wheel back to the left)
   */
  step(h, cmd, align) {
    const loose = Math.abs(cmd) < 0.02;
    const k = loose ? this.kLoose : this.kHold;
    const c = 2 * this.zeta * Math.sqrt(k);
    const ka = this.kAlign * (loose ? 0.55 : 1);
    const acc = k * (cmd - this.pos) - c * this.vel - ka * align;
    let vel = this.vel + acc * h;
    if (vel > this.rate) vel = this.rate;
    else if (vel < -this.rate) vel = -this.rate;
    this.vel = vel;
    this.pos += vel * h;
    if (this.pos > 1) { this.pos = 1; if (this.vel > 0) this.vel = 0; }
    else if (this.pos < -1) { this.pos = -1; if (this.vel < 0) this.vel = 0; }
    return this.pos;
  }
}

/**
 * Damped lane keeping: steer `car` towards track-space offset `targetU`.
 *
 * Returns a normalised steer demand in the same -1..1 units the player's keys
 * produce, so it can be handed straight to stepLat() or stuffed into the
 * input object by a harness.
 *
 * The loop is designed in acceleration space — kp is rad/s² of closed-loop
 * stiffness and kd is its damping, so omega = sqrt(kp) and zeta = kd/2sqrt(kp)
 * regardless of speed — and only then converted to lock. That is what makes it
 * behave the same at every speed, which a fixed gain on lateral error does not.
 */
export function laneAssist(car, targetU, o = {}) {
  const kp = o.kp ?? 0.90;            // omega ~= 0.95 rad/s
  const kd = o.kd ?? 1.90;            // zeta  ~= 1.0
  const lim = o.lim ?? 0.85;
  const ch = car.ch;
  const v = Math.max(4, car.v);
  const dir = car.dir || 1;

  /* Error and closing rate in the car's own frame: positive is to its right,
     which is the direction positive steer takes it. Note `rate` is the rate of
     change of u, i.e. relative to the road, so it is zero in a steady corner
     and is exactly the right thing to damp against. */
  const err = (targetU - car.u) * dir;
  const rate = v * Math.sin(car.psi) + (car.vy || 0) * Math.cos(car.psi);

  /* Feed-forward for the corner itself. Without this the controller has to
     manufacture the whole cornering acceleration out of lane error, so it can
     only hold a bend by sitting several metres wide of the line — which is
     what a driver would call not looking where they are going. */
  const ff = o.ff === false ? 0 : v * v * sample(car.s).curv * dir;

  let ay = ff + kp * err - kd * rate;
  const cap = o.ay ?? (ch ? 0.95 * ch.ayMax : 11);
  if (ay > cap) ay = cap; else if (ay < -cap) ay = -cap;

  /* lock needed for that acceleration: geometric part plus understeer */
  const L = ch ? ch.L : (car.wheelbase || 2.7);
  const kus = ch ? ch.kus : 0;
  const delta = L * ay / (v * v) + kus * ay;
  const dMax = ch ? steerLock(ch, v) : 0.52 / (1 + v * 0.055);

  let st = delta / dMax;
  if (st > lim) st = lim; else if (st < -lim) st = -lim;
  return st;
}
