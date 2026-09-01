/* ==========================================================================
   input.js — keyboard to analogue-ish controls.

   The only input device is a set of binary keys, so everything interesting
   happens in how a key-down becomes a control value.

   Steering is the one that matters. This used to be an exponential approach to
   a target, which is a filter, not a hand: it moves fastest at the instant you
   press the key and then creeps, so a tap gives you a jolt of lock followed by
   nothing. What a driver's arms actually have is a *rate limit* — a roughly
   constant number of degrees per second — so that is what this is: a linear
   ramp, quicker to unwind than to wind on, because letting go of a wheel is
   easier than turning one.

   The rest of the steering feel is not here. What this produces is the
   driver's demand; the rack that turns that demand into an actual road-wheel
   angle — with its own inertia, its own rate limit and the self-aligning
   torque pushing back — lives in steering.js, because it belongs to the car
   rather than to the keyboard.
   ========================================================================== */

/* Hand speed, in full-lock per second. Winding on is deliberately slower than
   letting go, and both are slow enough that a car with real yaw inertia is
   never asked for a step input. */
const WIND_ON = 4.2;
const WIND_OFF = 7.0;
export class Input {
  constructor() {
    this.keys = new Set();
    this.throttle = 0; this.brake = 0; this.steer = 0;
    this.handbrake = false;
    this.pressed = new Set();
    const down = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    };
    const up = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', () => this.keys.clear());
  }
  has(...ks) { return ks.some(k => this.keys.has(k)); }
  /** true once per physical key press */
  tapped(...ks) {
    for (const k of ks) if (this.pressed.has(k)) { return true; }
    return false;
  }
  endFrame() { this.pressed.clear(); }

  update(dt) {
    const gas = this.has('w', 'ArrowUp');
    const dec = this.has('s', 'ArrowDown');
    const left = this.has('a', 'ArrowLeft');
    const right = this.has('d', 'ArrowRight');
    const rate = 1 / 0.16;
    this.throttle += ((gas ? 1 : 0) - this.throttle) * Math.min(1, dt * rate * 1.4);
    this.brake += ((dec ? 1 : 0) - this.brake) * Math.min(1, dt * rate * 2.2);
    /* A real rate limit rather than an exponential: constant hand speed all
       the way, so winding lock on feels like winding lock on. Unwinding — and
       reversing, where the wheel is passing back through centre — gets the
       quicker rate. */
    const want = (right ? 1 : 0) - (left ? 1 : 0);
    const releasing = want === 0 || want * this.steer < 0;
    const step = (releasing ? WIND_OFF : WIND_ON) * dt;
    const diff = want - this.steer;
    this.steer += Math.max(-step, Math.min(step, diff));
    if (want === 0 && Math.abs(this.steer) < 0.004) this.steer = 0;
    this.handbrake = this.has(' ');
    return this;
  }
}
