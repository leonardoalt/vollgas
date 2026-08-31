/* ==========================================================================
   audio.js — everything is synthesised; no asset files.
   Engine note is a stack of detuned saws whose pitch follows crank speed,
   plus intake/turbo whine, tyre scrub, wind, a German two-tone Martinshorn
   and a camera flash.
   ========================================================================== */
export class Audio {
  constructor() {
    this.ready = false; this.muted = false;
    this.ctx = null;
  }

  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // ---------------- engine
    this.engine = ctx.createGain(); this.engine.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 512) - 1;
      curve[i] = Math.tanh(x * 2.4) * 0.82;
    }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 1400;
    this.engFilter.Q.value = 0.8;
    this.engine.connect(shaper); shaper.connect(this.engFilter); this.engFilter.connect(this.master);

    this.oscs = [];
    for (const [type, mul, gain, detune] of [
      ['sawtooth', 0.5, 0.55, -6], ['sawtooth', 1.0, 0.42, 5],
      ['square', 1.5, 0.14, 0], ['sawtooth', 2.0, 0.10, 11],
    ]) {
      const o = ctx.createOscillator();
      o.type = type; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(this.engine);
      o.start();
      this.oscs.push({ o, mul });
    }

    // turbo / intake whine
    this.whine = ctx.createOscillator(); this.whine.type = 'triangle';
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 3200; wf.Q.value = 5;
    this.whine.connect(this.whineG); this.whineG.connect(wf); wf.connect(this.master);
    this.whine.start();

    // ---------------- noise sources (wind + tyres)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dat = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dat[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const mkNoise = (type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { g, f };
    };
    this.wind = mkNoise('highpass', 700, 0.6, 0);
    this.tyre = mkNoise('bandpass', 1900, 3.5, 0);
    this.rumble = mkNoise('lowpass', 190, 1.0, 0);

    // ---------------- siren (Martinshorn: two tones, ~1.8 Hz alternation)
    this.sirenG = ctx.createGain(); this.sirenG.gain.value = 0;
    this.sirenG.connect(this.master);
    this.siren = ctx.createOscillator(); this.siren.type = 'square';
    const sg = ctx.createGain(); sg.gain.value = 0.10;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2600;
    this.siren.connect(sg); sg.connect(sf); sf.connect(this.sirenG);
    this.siren.frequency.value = 440;
    this.siren.start();
    this._sirenT = 0;

    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.85; }

  /** one-shot burst used for impacts and the camera flash */
  burst({ freq = 300, dur = 0.25, gain = 0.5, type = 'lowpass', q = 1 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  impact(sev) { this.burst({ freq: 140 + sev * 260, dur: 0.18 + sev * 0.35, gain: 0.28 + sev * 0.5, q: 0.8 }); }
  flash() { this.burst({ freq: 5200, dur: 0.10, gain: 0.42, type: 'highpass', q: 0.7 }); }
  blip() { this.burst({ freq: 1500, dur: 0.06, gain: 0.14, type: 'bandpass', q: 3 }); }

  /** per-frame mix */
  update(dt, st) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime, k = 0.05;
    const rpm = st.rpm || 900;
    const base = 22 + (rpm / 60) * 0.92;             // crank Hz-ish
    for (const { o, mul } of this.oscs) {
      o.frequency.setTargetAtTime(base * mul, now, k);
    }
    const load = 0.28 + st.throttle * 0.72;
    this.engine.gain.setTargetAtTime((0.10 + load * 0.20) * (st.engineOn ? 1 : 0), now, k);
    this.engFilter.frequency.setTargetAtTime(700 + load * 2600 + rpm * 0.16, now, k);
    this.whine.frequency.setTargetAtTime(1400 + rpm * 0.55, now, k);
    this.whineG.gain.setTargetAtTime(st.throttle * Math.min(1, rpm / 5200) * 0.035, now, k);

    const v = st.speed || 0;
    this.wind.g.gain.setTargetAtTime(Math.min(0.16, (v / 90) ** 2 * 0.16), now, k);
    this.wind.f.frequency.setTargetAtTime(520 + v * 12, now, k);
    this.tyre.g.gain.setTargetAtTime(Math.min(0.30, st.slip * 0.30), now, 0.03);
    this.rumble.g.gain.setTargetAtTime(st.offroad ? Math.min(0.34, v / 60 * 0.34) : (st.scrape ? 0.22 : 0), now, 0.04);

    // siren
    this._sirenT += dt;
    const wantSiren = st.siren ? Math.min(1, st.sirenNear) : 0;
    if (st.siren) {
      const two = (this._sirenT % 1.1) < 0.55;
      this.siren.frequency.setTargetAtTime(two ? 415 : 588, now, 0.008);
    }
    this.sirenG.gain.setTargetAtTime(wantSiren * 0.5, now, 0.08);
  }
}
