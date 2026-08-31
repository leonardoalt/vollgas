/* ==========================================================================
   audio.js — the mixer. Everything is synthesised; there are no asset files.

   Layout:

     PlayerEngine ─┐                      (engineSound.js: firing-order pulse
     wind hiss     │                       trains through waveguide exhaust)
     wind buffet   ├─► dry ─► master ─► soft limiter ─► destination
     road roar     │            ▲
     tyre scrub    │            │
     kerb rumble   │        tunnel reverb (4 combs + 2 slapback taps)
     traffic       │            ▲
     siren        ─┴────────────┘

   Two rules the whole file obeys:

   1. Nothing is created per frame. Every node exists from start(); update()
      only writes AudioParams. The one-shots (impacts, blow-off, camera flash)
      do allocate, but they are events, not frames.

   2. The property names `engine`, `wind.g`, `tyre.g`, `rumble.g` and `sirenG`
      are load-bearing: dev/audio-check.mjs reads them to prove the mixer
      really goes quiet on pause and on the results screen.
   ========================================================================== */
import { PlayerEngine, WaveEngine, doppler } from './engineSound.js';
import { ENGINES, CAR_ENGINE, engineFor } from './engineSpec.js';

const MASTER = 0.85;

/* A road tunnel is a very long, very hard box. Prime-ish comb delays plus two
   discrete slapback taps: the taps are what make it read as *tunnel* rather
   than as reverb in general. */
const COMBS = [0.0411, 0.0477, 0.0537, 0.0611];
const SLAPS = [0.029, 0.067];

export class Audio {
  constructor() {
    this.ready = false; this.muted = false;
    this.ctx = null;
    this.carId = 'amg';
    this._sirenT = 0;
    this._gear = 1;
    this._sirenDist = 200;
  }

  /** @param carId which car the player picked; picks the engine character */
  start(carId) {
    if (carId) this.carId = carId;
    if (this.ready) { this._retune(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // ---------------- master: gain, then a soft knee so a pile-up of sources
    // can never hand the DAC a sample outside ±1.
    this.master = ctx.createGain();
    this.master.gain.value = MASTER;
    const lim = ctx.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) {
      const x = (i / 2047.5) - 1, a = Math.abs(x);
      // linear to 0.62, then a tanh knee that asymptotes below 1
      const y = a <= 0.62 ? a : 0.62 + 0.38 * Math.tanh((a - 0.62) / 0.38);
      curve[i] = Math.sign(x) * y * 0.985;
    }
    lim.curve = curve;
    lim.oversample = '2x';
    this.master.connect(lim);
    lim.connect(ctx.destination);
    this.limiter = lim;

    // ---------------- tunnel reverb
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0;
    this.revWet = ctx.createGain(); this.revWet.gain.value = 0.9;
    const revSum = ctx.createGain(); revSum.gain.value = 1 / COMBS.length;
    this.combs = [];
    for (const d of COMBS) {
      const dl = ctx.createDelay(0.2); dl.delayTime.value = d;
      const fb = ctx.createGain(); fb.gain.value = 0.80;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass'; damp.frequency.value = 2600; damp.Q.value = 0.4;
      this.revSend.connect(dl);
      dl.connect(damp); damp.connect(fb); fb.connect(dl);   // the loop
      dl.connect(revSum);
      this.combs.push({ dl, fb, damp });
    }
    revSum.connect(this.revWet);
    this.revWet.connect(this.master);
    this.slaps = [];
    for (let i = 0; i < SLAPS.length; i++) {
      const dl = ctx.createDelay(0.2); dl.delayTime.value = SLAPS[i];
      const g = ctx.createGain(); g.gain.value = 0.42 - i * 0.16;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 160;
      this.revSend.connect(dl); dl.connect(hp); hp.connect(g); g.connect(this.master);
      this.slaps.push(g);
    }

    // ---------------- engine bus: a cabin filter, then the harness-visible gain
    this.cabLP = ctx.createBiquadFilter();
    this.cabLP.type = 'lowpass'; this.cabLP.frequency.value = 4200; this.cabLP.Q.value = 0.6;
    this.engine = ctx.createGain(); this.engine.gain.value = 0;
    this.cabLP.connect(this.engine);
    this.engine.connect(this.master);
    this.engine.connect(this.revSend);

    const eKey = CAR_ENGINE[this.carId] || 'v8na40';
    this.eng = new PlayerEngine(ctx, this.cabLP, eKey, 3);
    this.engSpec = ENGINES[eKey] || ENGINES.v8na40;

    // ---------------- shared noise
    const len = Math.floor(ctx.sampleRate * 2.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dat = buf.getChannelData(0);
    // a touch of pink: pure white noise sounds like a hi-hat, not like air
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.0555;
      b1 = 0.985 * b1 + w * 0.0750;
      b2 = 0.950 * b2 + w * 0.1538;
      dat[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.35) * 1.6));
    }
    this.noiseBuf = buf;

    const mkNoise = (type, freq, q, gain, wet = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.master);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.revSend); }
      src.start();
      return { g, f, src };
    };

    // wind: two components. Hiss is what you hear; buffet is what you feel.
    this.wind = mkNoise('highpass', 700, 0.6, 0);
    this.windLow = mkNoise('bandpass', 190, 0.9, 0);
    // road: tyre/road roar and the low ride-noise floor
    this.road = mkNoise('bandpass', 900, 0.8, 0, 0.7);
    this.roadLow = mkNoise('lowpass', 240, 0.7, 0, 0.5);
    // scrub and kerb
    this.tyre = mkNoise('bandpass', 1900, 3.5, 0, 0.6);
    this.rumble = mkNoise('lowpass', 190, 1.0, 0, 0.5);

    // stick-slip squeal: a sliding tyre is tonal, not just noisy
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    const sqf = ctx.createBiquadFilter(); sqf.type = 'bandpass'; sqf.frequency.value = 900; sqf.Q.value = 2.0;
    this.squeal = [];
    for (const [mul, g] of [[1, 0.6], [1.48, 0.3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(sqf);
      o.frequency.value = 760 * mul;
      o.start();
      this.squeal.push({ o, mul });
    }
    sqf.connect(this.squealG); this.squealG.connect(this.master);
    this.squealG.connect(this.revSend);
    this.squealF = sqf;

    // ---------------- traffic: one car voice, one truck voice, two whooshes
    this.trafficBus = ctx.createGain(); this.trafficBus.gain.value = 1;
    this.trafficBus.connect(this.master);
    this.trafficBus.connect(this.revSend);
    this.nCar = new WaveEngine(ctx, this.trafficBus, ENGINES.four, { level: 0.5 });
    this.nTruck = new WaveEngine(ctx, this.trafficBus, ENGINES.diesel6, { level: 0.62, bright: 0.7 });
    this.whoosh = [];
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.trafficBus);
      src.start();
      this.whoosh.push({ g, f });
    }
    this._nCarV = null; this._nTruckV = null;

    // ---------------- siren (Martinshorn, DIN 14610: a¹ 440 Hz / d² 587 Hz,
    // a perfect fourth, alternating a little under 1 Hz per pair)
    this.sirenG = ctx.createGain(); this.sirenG.gain.value = 0;
    this.sirenG.connect(this.master);
    this.sirenG.connect(this.revSend);
    this.siren = ctx.createOscillator(); this.siren.type = 'sawtooth';
    const shorn = ctx.createBiquadFilter();          // the horn's own formant
    shorn.type = 'bandpass'; shorn.frequency.value = 1500; shorn.Q.value = 0.9;
    const sg = ctx.createGain(); sg.gain.value = 0.5;
    this.sirenAir = ctx.createBiquadFilter();        // distance = HF absorption
    this.sirenAir.type = 'lowpass'; this.sirenAir.frequency.value = 4000; this.sirenAir.Q.value = 0.4;
    this.siren.connect(shorn); shorn.connect(sg); sg.connect(this.sirenAir);
    this.sirenAir.connect(this.sirenG);
    this.siren.frequency.value = 440;
    this.siren.start();

    this.ready = true;
  }

  /** the player changed car between runs: swap the engine, keep the mixer */
  _retune() {
    const want = CAR_ENGINE[this.carId] || 'v8na40';
    if (this.eng && this.eng.engKey === want) return;
    if (this.eng) { this.eng.stop(); this.eng.sum.disconnect(); }
    this.eng = new PlayerEngine(this.ctx, this.cabLP, want, 3);
    this.eng.engKey = want;
    this.engSpec = ENGINES[want] || ENGINES.v8na40;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : MASTER; }

  /**
   * Ramp everything to silence. The mixer holds its last target value, so
   * whenever the simulation stops stepping — pause, results, back to the menu —
   * the engine would otherwise sit there droning at whatever revs it had.
   */
  hush() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, k = 0.06;
    for (const g of [this.engine, this.wind.g, this.windLow.g, this.road.g, this.roadLow.g,
                     this.tyre.g, this.rumble.g, this.squealG, this.sirenG,
                     this.trafficBus, this.revSend]) {
      g.gain.setTargetAtTime(0, t, k);
    }
    for (const w of this.whoosh) w.g.gain.setTargetAtTime(0, t, k);
    this.nCar.silence(); this.nTruck.silence();
  }

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

  /** sheet metal: a broadband crack, a bent-panel thud, and a tail of debris */
  impact(sev) {
    if (!this.ready || this.muted) return;
    const s = Math.max(0, Math.min(1, sev));
    this.burst({ freq: 900 + s * 2200, dur: 0.05 + s * 0.06, gain: 0.20 + s * 0.34, type: 'highpass', q: 0.7 });
    this.burst({ freq: 110 + s * 130, dur: 0.20 + s * 0.40, gain: 0.24 + s * 0.44, type: 'lowpass', q: 1.2 });
    if (s > 0.35) this.burst({ freq: 2600, dur: 0.30 + s * 0.5, gain: 0.05 + s * 0.10, type: 'bandpass', q: 1.4 });
    if (this.eng) this.eng.bark(0.06 + s * 0.10);
  }
  flash() { this.burst({ freq: 5200, dur: 0.10, gain: 0.42, type: 'highpass', q: 0.7 }); }
  blip() { this.burst({ freq: 1500, dur: 0.06, gain: 0.14, type: 'bandpass', q: 3 }); }

  /* ------------------------------------------------------------ per-frame mix */
  update(dt, st) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime, k = 0.05;
    const rpm = st.rpm || 900;
    const th = Math.max(0, Math.min(1, st.throttle || 0));
    const v = st.speed || 0;
    const tunnel = Math.max(0, Math.min(1, st.tunnel || 0));
    const on = st.engineOn ? 1 : 0;

    // ---- gearshift: the torque cut is audible as a beat of silence and a bark
    if (st.gear != null && st.gear !== this._gear) {
      const up = st.gear > this._gear;
      this._gear = st.gear;
      if (up && this.eng) this.eng.bark(0.11);
    }
    const cut = st.shiftT > 0 ? 1 : 0;

    // ---- engine
    if (this.eng) this.eng.set(rpm, th * (1 - cut * 0.85), st.redline || 7000, dt);
    const load = 0.24 + th * 0.76;
    // inside the car you hear less top end than the chase camera does
    const inside = st.cam === 2 || st.cam === 3 ? 1 : 0;
    this.engine.gain.setTargetAtTime(
      on * (0.28 + load * 0.23) * (1 - cut * 0.55) * (1 + tunnel * 0.25) * (inside ? 0.86 : 1),
      now, cut ? 0.02 : k);
    this.cabLP.frequency.setTargetAtTime(
      (1500 + load * 3200 + rpm * 0.22) * (inside ? 0.55 : 1) * (1 + tunnel * 0.3), now, k);

    // ---- wind. Aeroacoustic noise climbs far faster than linearly; ~v^2.7 is
    // the usual fit for cabin wind noise, and it is why 250 is loud.
    const vr = v / 72;
    const hiss = Math.min(0.42, 0.34 * Math.pow(Math.max(0, vr), 2.7));
    this.wind.g.gain.setTargetAtTime(hiss * (inside ? 1.15 : 0.8), now, k);
    this.wind.f.frequency.setTargetAtTime(560 + v * 13, now, k);
    this.windLow.g.gain.setTargetAtTime(Math.min(0.16, 0.13 * vr * vr), now, k);
    this.windLow.f.frequency.setTargetAtTime(120 + v * 1.6, now, k);

    // ---- road. Tyre roar goes as roughly v^1.5 and it is the floor of the
    // whole mix; inside a tunnel the walls hand it straight back to you.
    const rough = st.offroad ? 2.4 : 1;
    this.road.g.gain.setTargetAtTime(Math.min(0.26, 0.20 * Math.pow(v / 55, 1.5)) * rough * (1 + tunnel * 0.5), now, k);
    this.road.f.frequency.setTargetAtTime((760 + v * 5.5) * (st.offroad ? 0.55 : 1), now, k);
    this.roadLow.g.gain.setTargetAtTime(Math.min(0.15, v / 90 * 0.15) * (1 + tunnel * 0.4), now, k);

    // ---- scrub. A sliding tyre squeals: broadband noise plus a stick-slip
    // tone that climbs with slip speed.
    const slip = Math.max(0, Math.min(1, st.slip || 0));
    const slipV = slip * Math.min(1, v / 14);
    this.tyre.g.gain.setTargetAtTime(Math.min(0.26, slipV * 0.26), now, 0.03);
    this.tyre.f.frequency.setTargetAtTime(1500 + slip * 900, now, 0.05);
    const sqF = 620 + slip * 520 + Math.min(220, v * 2.2);
    for (const { o, mul } of this.squeal) o.frequency.setTargetAtTime(sqF * mul, now, 0.05);
    this.squealF.frequency.setTargetAtTime(sqF * 1.6, now, 0.05);
    this.squealG.gain.setTargetAtTime(Math.min(0.11, Math.max(0, slipV - 0.18) * 0.16), now, 0.04);

    // ---- kerb, guardrail, verge
    this.rumble.g.gain.setTargetAtTime(
      st.offroad ? Math.min(0.30, v / 60 * 0.30) : (st.scrape ? 0.22 : 0), now, 0.04);
    if (st.scrape) this.rumble.f.frequency.setTargetAtTime(2200, now, 0.05);
    else this.rumble.f.frequency.setTargetAtTime(st.offroad ? 220 : 190, now, 0.08);

    // ---- tunnel
    this.revSend.gain.setTargetAtTime(tunnel * 0.55, now, 0.25);
    for (const c of this.combs) c.damp.frequency.setTargetAtTime(2200 + tunnel * 900, now, 0.3);

    this.trafficBus.gain.setTargetAtTime(1, now, 0.1);
    this._traffic(st, now, v);
    this._siren(dt, st, now, v);
  }

  /* Neighbours. Two tonal voices (one car, one lorry) and two air whooshes,
     each locked to a vehicle until it is far enough away to swap silently.
     Doppler is the real thing: f' = f·c/(c − v_closing). At a 250 km/h closing
     speed that is a shift of a fifth across the pass, which is most of why a
     pass reads as fast. */
  _traffic(st, now, v) {
    const list = st.others;
    if (!list) return;
    const ps = st.playerS || 0;
    // nearest car and nearest lorry, plus the two nearest of anything
    let bc = null, bcd = 1e9, bt = null, btd = 1e9;
    let w0 = null, w0d = 1e9, w1 = null, w1d = 1e9;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === st.self) continue;
      const d = Math.abs(o.s - ps);
      if (d > 120) continue;
      if (o.kind === 'truck') { if (d < btd) { btd = d; bt = o; } }
      else if (d < bcd) { bcd = d; bc = o; }
      if (d < w0d) { w1 = w0; w1d = w0d; w0 = o; w0d = d; }
      else if (d < w1d) { w1d = d; w1 = o; }
    }

    const voice = (vc, tgt) => {
      // hold the current target until it is gone, then swap while quiet
      if (vc.g.gain.value < 0.02 || !vc._t || Math.abs(vc._t.s - ps) > 110) {
        vc._t = tgt;
        // safe to change wave here and only here: the voice is quiet
        if (tgt) vc.setEngine(engineFor(tgt.spec && tgt.spec.id ? tgt.spec.id : tgt.kind));
      }
      const o = vc._t;
      if (!o) { vc.set(900, 0, 0); return; }
      const d = Math.abs(o.s - ps);
      const lateral = Math.abs((o.u || 0) - (st.playerU || 0));
      const r = Math.sqrt(d * d + lateral * lateral) + 2.5;
      const gain = Math.max(0, Math.min(1, 22 / r - 0.12));
      // closing rate: +ve when the gap is shrinking
      const rel = (o.dir < 0 ? -o.v : o.v) - v;         // their speed in our frame
      const closing = (o.s > ps ? -rel : rel);
      vc.set(o.rpm || 2200, o.kind === 'truck' ? 0.55 : 0.35, gain, doppler(closing));
    };
    voice(this.nCar, bc);
    voice(this.nTruck, bt);

    // air displacement: a broad noise band that sweeps down as they go by
    const wh = (slot, o) => {
      if (!o) { slot.g.gain.setTargetAtTime(0, now, 0.08); return; }
      const d = o.s - ps;
      const ad = Math.abs(d);
      const lateral = Math.abs((o.u || 0) - (st.playerU || 0));
      const r = Math.sqrt(ad * ad + lateral * lateral) + 2.0;
      const rel = (o.dir < 0 ? -o.v : o.v) - v;
      const closing = (d > 0 ? -rel : rel);
      const speed = Math.min(1, Math.abs(rel) / 40);
      const g = Math.max(0, Math.min(0.30, (16 / r - 0.18) * (0.25 + speed * 0.95)));
      slot.g.gain.setTargetAtTime(g, now, 0.05);
      slot.f.frequency.setTargetAtTime((330 + Math.min(1, 24 / r) * 700) * doppler(closing), now, 0.05);
      slot.f.Q.setTargetAtTime(0.6 + speed * 0.8, now, 0.1);
    };
    wh(this.whoosh[0], w0);
    wh(this.whoosh[1], w1);
  }

  _siren(dt, st, now, v) {
    this._sirenT += dt;
    const want = st.siren ? Math.min(1, st.sirenNear) : 0;
    if (st.siren) {
      // two tones a perfect fourth apart, with a short glide: a real horn pair
      // takes a few tens of ms to change over
      const two = (this._sirenT % 1.12) < 0.56;
      const d = doppler((st.copV || 0) - v);
      this.siren.frequency.setTargetAtTime((two ? 440 : 587) * d, now, 0.022);
      const dist = Math.max(4, Math.abs((st.copS || 0) - (st.playerS || 0)));
      this._sirenDist = dist;
      // air absorption: high frequencies do not survive 200 m of autobahn
      this.sirenAir.frequency.setTargetAtTime(1100 + 9000 / (1 + dist / 22), now, 0.15);
    }
    this.sirenG.gain.setTargetAtTime(want * 0.42, now, 0.08);
  }
}
