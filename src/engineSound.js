/* ==========================================================================
   engineSound.js — the player's engine, and the cheap version for everyone else.

   Two synths, because they have very different budgets:

   PlayerEngine   one AudioWorklet running the firing-order / waveguide model
                  from engineWorkletSource.js, then a post chain of exhaust
                  formants, a muffler notch, a load-driven waveshaper, an
                  intake path and a turbo. This is the car you are sitting in;
                  it is worth a few hundred kFLOP/s.

   WaveEngine     one OscillatorNode with a PeriodicWave built from the DFT of
                  the same firing pattern, plus a filter. Correct harmonic
                  structure (half-orders and all), no per-cycle life. Used for
                  traffic, and as the fallback if AudioWorklet is unavailable
                  or a Content-Security-Policy refuses the Blob URL.

   The PeriodicWave route deserves a note, because it is a nice trick: an engine
   cycle is 720° long, so the whole firing pattern — even an uneven one — is
   periodic at rpm/120 Hz. Take the DFT of one cycle and you have a wavetable
   whose harmonics *are* the engine's orders: k = 1 is the half order, k = 2 the
   first order, and a cross-plane V8's lumpiness lives in the odd k. One
   band-limited oscillator then reproduces it at any rpm with no aliasing.
   ========================================================================== */
import { ENGINES, engineFor, bankCycle, cycleHz } from './engineSpec.js';
import { ENGINE_WORKLET_SOURCE } from './engineWorkletSource.js';

const C_AIR = 343;

/* The Web Audio PeriodicWave synthesis convention is
     x(t) = Σ real[k]·cos(2πkt) + imag[k]·sin(2πkt)
   with imag negated relative to the textbook DFT. dev/sound-check.mjs measures
   this against a reference waveform, so if a browser ever disagrees the test
   says so rather than the sound quietly turning inside out. */
export const IMAG_SIGN = 1;

let workletUrl = null;
/** Blob URL for the worklet module. Built once; survives the single-file build. */
export function engineWorkletUrl() {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([ENGINE_WORKLET_SOURCE], { type: 'text/javascript' }));
  }
  return workletUrl;
}

/**
 * One engine cycle as a PeriodicWave: DFT of the summed bank pulse trains.
 * `tauDeg` sets the pulse width in crank degrees — narrower means brighter.
 */
export function enginePeriodicWave(ctx, eng, { harmonics = 180, tauDeg = 26, m = 1024 } = {}) {
  const w = new Float32Array(m);
  const tmp = new Float32Array(m);
  for (let b = 0; b < eng.banks.length; b++) {
    bankCycle(eng.banks[b], m, tauDeg, tmp);
    for (let i = 0; i < m; i++) w[i] += tmp[i];
  }
  const H = Math.min(harmonics, 4095);
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let re = 0, im = 0;
    const dw = 2 * Math.PI * k / m;
    for (let i = 0; i < m; i++) {
      const a = dw * i;
      re += w[i] * Math.cos(a);
      im += w[i] * Math.sin(a);
    }
    real[k] = (2 / m) * re;
    imag[k] = IMAG_SIGN * (2 / m) * im;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Reference waveform for the same wave, for the offline test to compare with. */
export function engineCycleWaveform(eng, { tauDeg = 26, m = 1024 } = {}) {
  const w = new Float32Array(m);
  const tmp = new Float32Array(m);
  for (let b = 0; b < eng.banks.length; b++) {
    bankCycle(eng.banks[b], m, tauDeg, tmp);
    for (let i = 0; i < m; i++) w[i] += tmp[i];
  }
  return w;
}

/* ========================================================================== */
/*  Player engine: worklet + post chain                                       */
/* ========================================================================== */
export class PlayerEngine {
  /**
   * @param ctx  an AudioContext or OfflineAudioContext
   * @param dest where the engine lands (usually a bus gain)
   */
  constructor(ctx, dest, engKey = 'v8na40', seed = 1) {
    this.ctx = ctx;
    this.engKey = ENGINES[engKey] ? engKey : 'v8na40';
    this.eng = ENGINES[this.engKey];
    this.seed = seed;
    this.mode = 'pending';
    this.boost = 0;
    this._lastTh = 0;

    // ---- summing bus for everything the engine bay makes
    this.sum = ctx.createGain(); this.sum.gain.value = 1;

    // exhaust formants: the resonances of collector, pipe and can. Peaking
    // rather than bandpass, so the waveguide's own comb still comes through.
    this.fmt = [];
    let node = null;
    for (const [f, q, g] of this.eng.formants) {
      const bq = ctx.createBiquadFilter();
      bq.type = 'peaking'; bq.frequency.value = f; bq.Q.value = q; bq.gain.value = g;
      if (node) node.connect(bq);
      node = bq;
      this.fmt.push(bq);
    }
    this.exIn = this.fmt[0];

    // muffler: a Helmholtz absorber is a notch, which is why a stock exhaust
    // sounds hollowed-out at one particular frequency
    this.notch = ctx.createBiquadFilter();
    this.notch.type = 'notch';
    this.notch.frequency.value = this.eng.notch;
    this.notch.Q.value = 1.6;
    node.connect(this.notch);

    // load-driven saturation: an engine on full throttle breaks up
    this.drive = ctx.createGain(); this.drive.gain.value = 0.8;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      const x = (i / 1023.5) - 1;
      curve[i] = Math.tanh(x * 2.0) / Math.tanh(2.0);
    }
    this.shaper.curve = curve;
    this.shaper.oversample = '2x';
    this.exGain = ctx.createGain(); this.exGain.gain.value = 0.35;
    this.notch.connect(this.drive);
    this.drive.connect(this.shaper);
    this.shaper.connect(this.exGain);
    this.exGain.connect(this.sum);

    // ---- intake: airbox honk. Highpassed, because induction noise reaching
    // the cabin has no bottom end — the bottom end is the exhaust's job.
    this.intHP = ctx.createBiquadFilter();
    this.intHP.type = 'highpass'; this.intHP.frequency.value = 110; this.intHP.Q.value = 0.7;
    this.intGain = ctx.createGain(); this.intGain.gain.value = 0.0;
    this.intHP.connect(this.intGain); this.intGain.connect(this.sum);

    // ---- turbo: blade-passing whistle (two partials) plus a compressor rush
    this.turboOn = this.eng.turbo > 0.001;
    if (this.turboOn) {
      this.spoolA = ctx.createOscillator(); this.spoolA.type = 'sine';
      this.spoolB = ctx.createOscillator(); this.spoolB.type = 'triangle';
      this.spoolAG = ctx.createGain(); this.spoolAG.gain.value = 0.62;
      this.spoolBG = ctx.createGain(); this.spoolBG.gain.value = 0.24;
      this.turboBP = ctx.createBiquadFilter();
      this.turboBP.type = 'bandpass'; this.turboBP.frequency.value = 3000; this.turboBP.Q.value = 1.2;
      this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
      this.spoolA.connect(this.spoolAG); this.spoolAG.connect(this.turboBP);
      this.spoolB.connect(this.spoolBG); this.spoolBG.connect(this.turboBP);
      this.turboBP.connect(this.turboG); this.turboG.connect(this.sum);
      this.spoolA.start(); this.spoolB.start();
    }

    this.sum.connect(dest);

    // ---- the source itself
    this._startSource();
  }

  _startSource() {
    const ctx = this.ctx;
    const eng = this.eng;
    if (!ctx.audioWorklet) { this._startFallback(); return; }
    const opts = {
      numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [1, 1],
      processorOptions: {
        banks: eng.banks, pipe: eng.pipe, damp: eng.damp, refl: eng.refl,
        tau: eng.tau, jitter: eng.jitter, crackle: eng.crackle,
        intake: eng.intake, intakeF: eng.intakeF, body: eng.body, seed: this.seed,
      },
    };
    const attach = () => {
      try {
        const node = new AudioWorkletNode(ctx, 'vollgas-engine', opts);
        node.connect(this.exIn, 0);
        node.connect(this.intHP, 1);
        this.node = node;
        this.p = {
          rpm: node.parameters.get('rpm'),
          throttle: node.parameters.get('throttle'),
          level: node.parameters.get('level'),
          limiter: node.parameters.get('limiter'),
        };
        this.mode = 'worklet';
      } catch (e) {
        this._startFallback();
      }
    };
    this.readyPromise = ctx.audioWorklet.addModule(engineWorkletUrl())
      .then(attach).catch(() => this._startFallback());
  }

  /* No worklet (ancient browser, or a CSP that will not have a Blob URL):
     drive the same post chain from a PeriodicWave oscillator instead. Less
     alive, still the right engine. */
  _startFallback() {
    if (this.mode === 'worklet' || this.mode === 'wave') return;
    const ctx = this.ctx;
    this.wave = new WaveEngine(ctx, this.exIn, this.eng, { level: 0.55 });
    this.mode = 'wave';
  }

  /**
   * Per-frame mix.
   * @param rpm       crank speed
   * @param throttle  0..1
   * @param redline   for the limiter bounce
   * @param dt        frame time, for the boost model
   */
  set(rpm, throttle, redline, dt) {
    const ctx = this.ctx, t = ctx.currentTime;
    const th = Math.max(0, Math.min(1, throttle));
    const eng = this.eng;

    // ---- turbo boost: a first-order lag on throttle × how much air the
    // engine is actually pumping. Spools in ~0.45 s, dumps in ~0.12 s.
    const capacity = Math.min(1, Math.max(0, (rpm - 1300) / 2600));
    const want = th * capacity;
    const k = want > this.boost ? 1 - Math.exp(-dt / 0.45) : 1 - Math.exp(-dt / 0.12);
    this.boost += (want - this.boost) * k;

    // ---- blow-off when the throttle shuts on boost
    if (this._lastTh - th > 0.35 && this.boost > 0.3) this.blowOff(this.boost);
    this._lastTh = th;

    if (this.mode === 'worklet') {
      // a-rate params: a short ramp, not a jump, or fast rev changes zipper
      this.p.rpm.setTargetAtTime(rpm, t, 0.012);
      this.p.throttle.setTargetAtTime(th, t, 0.03);
      this.p.limiter.value = rpm > redline - 40 && th > 0.5 ? 1 : 0;
    } else if (this.wave) {
      this.wave.set(rpm, th, 1);
    }

    // exhaust brightness and drive follow load; on overrun the note loses its
    // top and half its level, which is the single biggest lift/on cue there is
    const load = 0.22 + th * 0.78;
    this.drive.gain.setTargetAtTime(0.45 + load * eng.rasp * 0.85, t, 0.05);
    this.exGain.gain.setTargetAtTime(0.23 + load * 0.29, t, 0.05);
    this.fmt[2].gain.setTargetAtTime(eng.formants[2][2] * (0.35 + load * 0.9), t, 0.06);
    this.intGain.gain.setTargetAtTime(eng.intake * (0.05 + th * 0.95) * 0.5, t, 0.05);

    if (this.turboOn) {
      const [f0, f1] = eng.boostF;
      const f = f0 + this.boost * (f1 - f0) + rpm * 0.14;
      this.spoolA.frequency.setTargetAtTime(f, t, 0.06);
      this.spoolB.frequency.setTargetAtTime(f * 1.51, t, 0.06);
      this.turboBP.frequency.setTargetAtTime(f * 1.15, t, 0.06);
      this.turboG.gain.setTargetAtTime(eng.turbo * this.boost * this.boost * 0.09, t, 0.05);
    }
  }

  /** brief exhaust lightoff — an upshift bark, or the overrun on lift */
  bark(amt = 0.10) {
    if (this.node) this.node.port.postMessage({ t: 'bark', a: amt });
    else if (this.wave) this.wave.bark(amt);
  }

  /** wastegate/dump valve: a short pressurised hiss with a flutter on it */
  blowOff(str = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this._bovBuf) {
      const n = Math.floor(ctx.sampleRate * 0.5);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._bovBuf = b;
    }
    const src = ctx.createBufferSource(); src.buffer = this._bovBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 1500; bp.Q.value = 1.1;
    const g = ctx.createGain();
    const a = Math.min(1, str) * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(a, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    // flutter: the valve chatters as the pressure drops
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 46;
    const lg = ctx.createGain(); lg.gain.value = a * 0.4;
    lfo.connect(lg); lg.connect(g.gain);
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    src.connect(bp); bp.connect(g); g.connect(this.sum);
    src.start(t); src.stop(t + 0.32);
    lfo.start(t); lfo.stop(t + 0.32);
  }

  stop() {
    if (this.node) { try { this.node.port.postMessage({ t: 'stop' }); } catch (e) { /* gone */ } }
  }
}

/* ========================================================================== */
/*  Cheap engine: one band-limited oscillator per voice                       */
/* ========================================================================== */
export class WaveEngine {
  constructor(ctx, dest, eng, { level = 1, bright = 1 } = {}) {
    this.ctx = ctx;
    this.eng = eng;
    this._waves = new Map();
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(this._wave(eng));
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 1600; this.lp.Q.value = 0.9;
    this.pk = ctx.createBiquadFilter();
    this.pk.type = 'peaking';
    this.pk.frequency.value = eng.formants[0][0];
    this.pk.Q.value = 2.2; this.pk.gain.value = eng.formants[0][2];
    this.g = ctx.createGain(); this.g.gain.value = 0;
    this.osc.connect(this.pk); this.pk.connect(this.lp); this.lp.connect(this.g);
    this.g.connect(dest);
    this.osc.frequency.value = cycleHz(eng.idle);
    this.osc.start();
    this.level = level; this.bright = bright;
  }
  _wave(eng) {
    let w = this._waves.get(eng);
    if (!w) { w = enginePeriodicWave(this.ctx, eng, { harmonics: 150, tauDeg: 24 }); this._waves.set(eng, w); }
    return w;
  }

  /**
   * Point this voice at a different engine. Swapping a PeriodicWave mid-note
   * steps the waveform and clicks, so the caller must only do this while the
   * voice is silent — which is also when a neighbour voice changes target.
   */
  setEngine(eng) {
    if (eng === this.eng || !eng) return;
    this.eng = eng;
    this.osc.setPeriodicWave(this._wave(eng));
    this.pk.frequency.value = eng.formants[0][0];
    this.pk.gain.value = eng.formants[0][2];
  }

  /** @param doppler multiply the pitch (1 = no shift) */
  set(rpm, throttle, gain, doppler = 1) {
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(cycleHz(Math.max(300, rpm)) * doppler, t, 0.04);
    const load = 0.25 + throttle * 0.75;
    this.lp.frequency.setTargetAtTime((520 + rpm * 0.30 + load * 1500) * this.bright * doppler, t, 0.06);
    this.g.gain.setTargetAtTime(gain * this.level * (0.4 + load * 0.6), t, 0.06);
  }
  bark() { /* the wave engine has no per-cycle events to bark with */ }
  silence() { this.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }
}

/** Distance/Doppler helper: returns the pitch multiplier for a closing rate. */
export function doppler(closingRate) {
  // f' = f · c/(c − v_closing): closing raises the pitch, receding lowers it.
  // Clamped so a bug in the sim can never invert or explode the pitch.
  const v = Math.max(-260, Math.min(260, closingRate));
  return Math.max(0.55, Math.min(1.9, C_AIR / (C_AIR - v)));
}

export { engineFor };
