/* ==========================================================================
   engineWorkletSource.js — the engine DSP, as a string.

   It has to be a string because an AudioWorklet is loaded from a URL, and this
   game ships as one HTML file (dev/build-artifact.mjs inlines the whole bundle
   into a single script tag). A string becomes a Blob URL at runtime, so there
   is no second file to fetch and the single-file build keeps working.

   The model, per bank of cylinders:

     combustion event → blowdown pulse shaper → quarter-wave pipe waveguide

   The pipe is a delay line of D = 2L/c samples with a damped, sign-inverted
   reflection at the tailpipe. That is a comb with poles at the odd multiples of
   c/4L — an actual open pipe, not an EQ curve pretending to be one. Banks are
   summed at a collector, so an uneven bank firing pattern (cross-plane V8)
   produces its half-order partials for real instead of being faked with a
   sub-oscillator.

   Everything is allocation-free after construction: one 128-sample scratch set,
   reused every render quantum.
   ========================================================================== */

export const ENGINE_WORKLET_SOURCE = `
const C_AIR = 343;
const clamp = (x, a, b) => (x < a ? a : (x > b ? b : x));

/* Quarter-wave exhaust pipe: delay line, damped inverting reflection. */
class Pipe {
  constructor(len, sr, damp, refl) {
    this.d = (2 * len / C_AIR) * sr;
    this.n = Math.max(8, Math.ceil(this.d) + 4);
    this.buf = new Float32Array(this.n);
    this.w = 0;
    this.lp = 0;
    this.a = clamp(1 - damp, 0.02, 0.98);
    this.refl = clamp(refl, 0, 0.78);
  }
  step(x) {
    const n = this.n, buf = this.buf;
    let r = this.w - this.d;
    while (r < 0) r += n;
    const i0 = r | 0, f = r - i0;
    const s = buf[i0] * (1 - f) + buf[i0 + 1 >= n ? 0 : i0 + 1] * f;
    this.lp += this.a * (s - this.lp);
    let y = x - this.refl * this.lp;
    if (!(y > -8 && y < 8)) y = 0;
    buf[this.w] = y;
    this.w = this.w + 1 >= n ? 0 : this.w + 1;
    return y;
  }
}

/* Two cascaded one-poles: a unit kick becomes t*exp(-t/tau). Smooth attack, no
   DC step, band-limited by construction — a blowdown spike rather than a click. */
class Pulse {
  constructor() { this.a = 0; this.b = 0; this.k = 0.99; this.norm = 1; }
  setTau(samples) {
    const t = samples < 1.5 ? 1.5 : samples;
    this.k = Math.exp(-1 / t);
    const u = 1 - this.k;
    this.norm = u * u * t * Math.E;      // peak of t*exp(-t/tau) is at t=tau
  }
  step(kick) {
    this.a = kick + this.a * this.k;
    this.b = this.a + this.b * this.k;
    return this.b * this.norm;
  }
}

/* Two-pole resonator, used for the intake plenum (a Helmholtz volume). */
class Reso {
  constructor() { this.y1 = 0; this.y2 = 0; this.b0 = 1; this.a1 = 0; this.a2 = 0; }
  set(f, q, sr) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr;
    const r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    this.b0 = (1 - r) * Math.sqrt(Math.max(1e-6, 1 + r * r - 2 * r * Math.cos(2 * w)));
  }
  step(x) {
    let y = this.b0 * x + this.a1 * this.y1 + this.a2 * this.y2;
    if (!(y > -8 && y < 8)) y = 0;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm',      defaultValue: 800, minValue: 0, maxValue: 14000, automationRate: 'a-rate' },
      { name: 'throttle', defaultValue: 0,   minValue: 0, maxValue: 1,     automationRate: 'a-rate' },
      { name: 'level',    defaultValue: 1,   minValue: 0, maxValue: 4,     automationRate: 'k-rate' },
      { name: 'limiter',  defaultValue: 0,   minValue: 0, maxValue: 1,     automationRate: 'k-rate' },
    ];
  }

  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    const sr = sampleRate;
    this.sr = sr;
    this.tauMs = o.tau || 1.2;
    this.jit = o.jitter != null ? o.jitter : 0.14;
    this.crackle = o.crackle || 0;
    this.body = o.body != null ? o.body : 1;

    const banks = o.banks || [[0, 180, 360, 540]];
    const lens = o.pipe || [2.4];
    this.nb = banks.length;
    this.pipes = []; this.pulses = []; this.fire = [];
    for (let b = 0; b < this.nb; b++) {
      const L = lens[Math.min(b, lens.length - 1)];
      this.pipes.push(new Pipe(L, sr, o.damp != null ? o.damp : 0.5, o.refl != null ? o.refl : 0.55));
      this.pulses.push(new Pulse());
      const f = new Float32Array(banks[b].length);
      for (let i = 0; i < banks[b].length; i++) f[i] = banks[b][i] / 720;
      this.fire.push(f);
    }

    this.intake = new Reso();
    this.intake.set(o.intakeF || 170, 6.0, sr);
    this.intakeLvl = o.intake != null ? o.intake : 0.35;

    this.phase = 0;
    this.wob = 0;
    this.seed = (22222 + ((o.seed || 1) * 7919)) >>> 0 || 1;
    this.bark = 0;
    this.limPhase = 0;

    const N = 256;                       // render quantum is 128; leave headroom
    this.phS = new Float32Array(N);
    this.incS = new Float32Array(N);
    this.kick = new Float32Array(N + 1);
    this.kickC = new Float32Array(N + 1);
    this.kickAll = new Float32Array(N + 1);
    this.carry = new Float32Array(this.nb);
    this.carryC = new Float32Array(this.nb);
    this.dead = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.t === 'bark') this.bark = Math.max(this.bark, d.a || 0.09);
      else if (d.t === 'stop') this.dead = 1;
    };
  }

  rnd() {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed & 0xffffff) / 0xffffff;
  }

  process(inputs, outputs, params) {
    if (this.dead) return false;
    const ex = outputs[0][0];
    const ina = outputs[1] && outputs[1][0];
    if (!ex) return true;
    const n = Math.min(ex.length, 256);
    const sr = this.sr, dt = 1 / sr;
    const rpmA = params.rpm, thA = params.throttle;
    const level = params.level[0];
    const limOn = params.limiter[0] > 0.5;

    // a real crankshaft does not turn at a constant rate: slow random wobble
    this.wob = this.wob * 0.985 + (this.rnd() - 0.5) * 0.015;
    const wobK = 1 + this.wob * 0.02 * this.jit;

    // rev limiter: fuel cut chopped at ~12 Hz is the bounce off the limiter
    let limCut = 0;
    if (limOn) {
      this.limPhase += n * dt * 12;
      while (this.limPhase >= 1) this.limPhase -= 1;
      limCut = this.limPhase < 0.45 ? 1 : 0;
    } else this.limPhase = 0;
    if (this.bark > 0) this.bark = Math.max(0, this.bark - n * dt);

    // ---- one pass over the block for crank phase, shared by every bank
    let ph = this.phase, rpmSum = 0, thSum = 0;
    for (let i = 0; i < n; i++) {
      let rpm = rpmA.length > 1 ? rpmA[i] : rpmA[0];
      rpm = rpm > 120 ? (rpm > 13000 ? 13000 : rpm) : 120;
      const th = clamp(thA.length > 1 ? thA[i] : thA[0], 0, 1);
      rpmSum += rpm; thSum += th;
      const inc = (rpm / 120) * dt * wobK;
      this.incS[i] = inc;
      ph += inc;
      if (ph >= 1) ph -= 1;
      this.phS[i] = ph;                   // phase at the END of sample i
    }
    const rpmM = rpmSum / n, thM = thSum / n;
    const overrun = thM < 0.10 && rpmM > 2400;

    // blowdown gets shorter as revs and load rise: most of why an engine
    // brightens when you open the throttle
    const tauS = (this.tauMs * 0.001) * (3000 / (rpmM + 600)) * (1 - 0.34 * thM);
    const tauN = tauS * sr;

    for (let i = 0; i <= n; i++) this.kickAll[i] = 0;
    for (let i = 0; i < n; i++) { ex[i] = 0; if (ina) ina[i] = 0; }

    for (let b = 0; b < this.nb; b++) {
      for (let i = 0; i <= n; i++) { this.kick[i] = 0; this.kickC[i] = 0; }
      this.kick[0] = this.carry[b]; this.kickC[0] = this.carryC[b];
      this.carry[b] = 0; this.carryC[b] = 0;
      const fire = this.fire[b], nf = fire.length;

      // ---- schedule this block's firings
      for (let i = 0; i < n; i++) {
        const inc = this.incS[i];
        const end = this.phS[i];
        const start = end - inc;            // may be negative: the wrap case
        for (let k = 0; k < nf; k++) {
          const a = fire[k];
          let hit = -1;
          if (a > start && a <= end) hit = (a - start) / inc;
          else if (start < 0 && a > start + 1 && a <= 1) hit = (a - start - 1) / inc;
          if (hit < 0) continue;
          const frac = clamp(hit, 0, 1);
          const sc = 1 + (this.rnd() - 0.5) * 2 * this.jit;
          let amp, cr = 0;
          if (limCut) {
            amp = 0.10 * sc;
            cr = 0.55 + 0.45 * this.rnd();                 // the limiter spits
          } else if (overrun) {
            amp = (0.15 + 0.10 * this.rnd()) * sc;         // pumping, no burn
            // a few lightoffs a second, not a continuous hiss: at 4200 rpm a
            // V8 fires 280 times a second, so this probability is per firing
            const p = this.crackle * 0.11 * Math.min(1, (rpmM - 2400) / 3000);
            if (this.rnd() < p) cr = 0.5 + 0.9 * this.rnd();
          } else {
            amp = (0.28 + 0.72 * thM) * sc;
            if (this.bark > 0 && this.rnd() < 0.30) cr = 0.4 + 0.6 * this.rnd();
          }
          const j = i;
          this.kick[j] += amp * (1 - frac);
          this.kickAll[j] += amp * (1 - frac);
          if (j + 1 < n) { this.kick[j + 1] += amp * frac; this.kickAll[j + 1] += amp * frac; }
          else this.carry[b] += amp * frac;
          if (cr > 0) {
            this.kickC[j] += cr * (1 - frac);
            if (j + 1 < n) this.kickC[j + 1] += cr * frac;
            else this.carryC[b] += cr * frac;
          }
        }
      }

      // ---- run the bank through its pipe
      const pipe = this.pipes[b], pul = this.pulses[b];
      pul.setTau(tauN);
      for (let i = 0; i < n; i++) {
        const nz = (this.rnd() - 0.5) * 2;
        // turbulence in the burn, gated by the pulse itself, plus any lightoff
        const e = pul.step(this.kick[i]) * (1 + nz * 0.5) + this.kickC[i] * nz * 2.2;
        ex[i] += pipe.step(e);
      }
    }

    // ---- intake: air rush plus induction pulses, only loud with the throttle open
    if (ina && this.intakeLvl > 0.001) {
      const air = (0.18 + 0.82 * thM) * Math.min(1, rpmM / 4200);
      const lvl = this.intakeLvl * 1.5;
      for (let i = 0; i < n; i++) {
        const nz = (this.rnd() - 0.5) * 2;
        const y = this.intake.step(nz * air * 0.55 + this.kickAll[i] * 0.9);
        ina[i] = y * lvl;
      }
    }

    // ---- trim, then a soft knee so nothing downstream ever sees a spike
    const g = this.body * level;
    for (let i = 0; i < n; i++) {
      let v = ex[i] * g;
      if (!(v > -8 && v < 8)) v = 0;
      ex[i] = v / (1 + Math.abs(v) * 0.6);
    }

    this.phase = this.phS[n - 1];
    return true;
  }
}

registerProcessor('vollgas-engine', EngineProcessor);
`;
