/* ==========================================================================
   suspension.js — sprung body attitude.

   The visual weight transfer was already the best thing about the old model:
   the nose drops on the brakes, the tail squats under power, the body leans
   into a corner. The one thing wrong with it was that it was an *algebraic*
   function of acceleration, so the body attitude changed in the same frame the
   input did. Real bodies are masses on springs: they have a rise time, they
   overshoot a little, and they settle.

   This is that, as a plain damped harmonic oscillator per axis, sub-stepped so
   it cannot go unstable at the 0.05 s dt the game clamps to. The steady-state
   gain is deliberately unchanged from the old code, so a car sitting at a
   constant 0.8 g leans exactly as far as it always did — it just takes a
   quarter of a second to get there and wobbles once on the way.
   ========================================================================== */

export class Spring {
  /**
   * @param hz    undamped natural frequency
   * @param zeta  damping ratio (< 1 overshoots, which is the point)
   * @param limit optional hard clamp on the output
   */
  constructor(hz, zeta, limit = Infinity) {
    this.w = 2 * Math.PI * hz;
    this.z = zeta;
    this.limit = limit;
    this.x = 0;
    this.v = 0;
  }

  reset() { this.x = 0; this.v = 0; }

  step(dt, target) {
    /* symplectic Euler is stable while w*h < 2; keep a wide margin so a 20 fps
       frame is no different from a 144 fps one */
    const n = Math.min(8, Math.max(1, Math.ceil(dt * this.w / 0.4)));
    const h = dt / n;
    const w2 = this.w * this.w, c = 2 * this.z * this.w;
    for (let i = 0; i < n; i++) {
      this.v += (w2 * (target - this.x) - c * this.v) * h;
      this.x += this.v * h;
    }
    if (this.x > this.limit) { this.x = this.limit; if (this.v > 0) this.v = 0; }
    else if (this.x < -this.limit) { this.x = -this.limit; if (this.v < 0) this.v = 0; }
    return this.x;
  }
}

/* Body frequencies. A road car's sprung mass sits around 1.2-1.6 Hz; roll is
   the softest and least damped of the three, which is why leaning into a
   corner is the motion you actually feel. */
export const BODY = {
  roll:  () => new Spring(1.30, 0.44, 0.075),
  pitch: () => new Spring(1.55, 0.52, 0.075),
  heave: () => new Spring(1.20, 0.38, 0.038),
};
