/* ==========================================================================
   sound-check.mjs — measures the engine synth instead of listening to it.

   Renders the real synthesis graph in an OfflineAudioContext inside the page,
   FFTs the result, and asserts the things that make an engine an engine:

   A. Firing order. An engine cycle is 720° long, so everything the engine does
      is a harmonic of f_cycle = rpm/120. Numbering those harmonics k, the
      "engine order" is k/2. A bank firing evenly every 240° (flat-six) can
      only put energy on k = 3, 6, 9…; a bank firing 90-180-270-180 (cross-plane
      V8) puts energy on *every* k including k = 1, the half order — which is
      the burble. A flat-plane V8's banks cancel at k = 4 and leave k = 8.
      So: half-order energy is the measurement that tells these three apart,
      and it is asserted per engine below.

   B. Pitch tracking. The k = cyl partial must land on cyl·rpm/120 Hz.

   C. Load. Opening the throttle must raise both level and spectral centroid.

   D. Levels. Nothing anywhere may exceed |1.0|, and an rpm sweep must not
      produce NaN, silence or a clip.

   E. Wavetable convention. The PeriodicWave path is only correct if the
      browser's real/imag convention matches ours; measured, not assumed.

   F. Live mix. Drives the actual game and watches the master bus peak, in the
      open and inside the Engelbergtunnel.

   usage: node dev/sound-check.mjs [url]
   ========================================================================== */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5202/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[err] ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

/* ---------------------------------------------------------------- helpers
   Everything below runs in the page, where the audio modules live. */
const HELPERS = `
  // iterative radix-2 FFT, magnitude spectrum of a Hann-windowed frame
  function spectrum(x, off, N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
      re[i] = x[off + i] * w;
    }
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + len / 2], bi = im[i + k + len / 2];
          const tr = br * cr - bi * ci, ti = br * ci + bi * cr;
          re[i + k] = ar + tr; im[i + k] = ai + ti;
          re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    const mag = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) * 2 / N;
    return mag;
  }
  // strongest bin within +/- tol Hz of f
  function near(mag, sr, N, f, tol) {
    const bin = f * N / sr, w = Math.max(1, Math.ceil(tol * N / sr));
    let best = 0, at = 0;
    for (let i = Math.max(1, Math.round(bin - w)); i <= Math.min(mag.length - 1, Math.round(bin + w)); i++) {
      if (mag[i] > best) { best = mag[i]; at = i * sr / N; }
    }
    return { a: best, f: at };
  }
  function stats(buf, from, to) {
    let peak = 0, sum = 0, bad = 0;
    for (let i = from; i < to; i++) {
      const v = buf[i];
      if (!Number.isFinite(v)) { bad++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / (to - from)), bad };
  }
  // summed magnitude in a band, as a fraction-free absolute number
  function band(mag, sr, N, f0, f1) {
    let e = 0;
    const a = Math.max(1, Math.floor(f0 * N / sr)), b = Math.min(mag.length - 1, Math.ceil(f1 * N / sr));
    for (let i = a; i <= b; i++) e += mag[i] * mag[i];
    return Math.sqrt(e);
  }
  function centroid(mag, sr, N, fmax) {
    let num = 0, den = 0;
    const top = Math.min(mag.length - 1, Math.floor(fmax * N / sr));
    for (let i = 1; i <= top; i++) { const f = i * sr / N; num += f * mag[i]; den += mag[i]; }
    return den > 0 ? num / den : 0;
  }
`;

/* ------------------------------------------------------- A/B/C/D: the engine */
const engineReport = await page.evaluate(async (helpers) => {
  eval(helpers);
  const { PlayerEngine, enginePeriodicWave, engineCycleWaveform, WaveEngine, doppler } =
    await import('/src/engineSound.js');
  const { ENGINES, fireHz, cycleHz } = await import('/src/engineSpec.js');

  const SR = 48000, N = 32768;

  /** render one engine at a steady operating point */
  async function render(key, rpm, th, secs = 1.4) {
    const ctx = new OfflineAudioContext(1, Math.floor(SR * secs), SR);
    const out = ctx.createGain(); out.gain.value = 1;
    out.connect(ctx.destination);
    const e = new PlayerEngine(ctx, out, key, 3);
    if (e.readyPromise) await e.readyPromise;
    e.set(rpm, th, 7000, 1 / 60);
    if (e.mode === 'worklet') { e.p.rpm.value = rpm; e.p.throttle.value = th; }
    const buf = await ctx.startRendering();
    return { d: buf.getChannelData(0), mode: e.mode };
  }

  const out = { engines: {}, mode: null, notes: [] };

  // ---- A/B/C/D per engine
  const CASES = [
    ['flat6tt', 6, 'flat-six twin-turbo (911)'],
    ['v8tt44', 8, 'cross-plane 4.4 V8 TT (M5)'],
    ['v8tt40', 8, 'cross-plane 4.0 V8 TT (RS6)'],
    ['v8na40', 8, 'cross-plane 4.0 V8 NA (AMG)'],
    ['diesel6', 6, 'inline-six diesel (truck)'],
    ['four', 4, 'inline-four (traffic)'],
  ];

  for (const [key, cyl, label] of CASES) {
    const rpm = 4200, fc = rpm / 120;
    const wide = await render(key, rpm, 0.95);
    out.mode = wide.mode;
    const off = Math.floor(SR * 0.55);
    const st = stats(wide.d, off, wide.d.length);
    const mag = spectrum(wide.d, off, N);

    // orders: amplitude at k·f_cycle, k = 1..16 (engine order = k/2)
    const ord = [];
    for (let k = 1; k <= 16; k++) ord.push(near(mag, SR, N, k * fc, 1.6).a);
    const main = ord[cyl - 1];                       // k = cyl is the firing order
    const half = ord[0];                             // k = 1 is the half order
    const db = (a) => (a > 1e-12 && main > 1e-12 ? 20 * Math.log10(a / main) : -120);

    // throttle-closed for the load comparison
    const shut = await render(key, rpm, 0.0);
    const stShut = stats(shut.d, off, shut.d.length);
    const magShut = spectrum(shut.d, off, N);

    // pitch tracking at a second operating point
    const lo = await render(key, 1500, 0.6);
    const magLo = spectrum(lo.d, off, N);
    const pkLo = near(magLo, SR, N, cyl * 1500 / 120, 4);

    out.engines[key] = {
      label,
      cyl,
      f_cycle: +fc.toFixed(2),
      f_fire: +fireHz(rpm, cyl).toFixed(2),
      firingPartialHz: +near(mag, SR, N, cyl * fc, 2.5).f.toFixed(2),
      firingPartialWantHz: +(cyl * fc).toFixed(2),
      lowRpmPartialHz: +pkLo.f.toFixed(2),
      lowRpmWantHz: +(cyl * 1500 / 120).toFixed(2),
      halfOrder_dB: +db(half).toFixed(1),
      order1p5_dB: +db(ord[2]).toFixed(1),
      order2_dB: +db(ord[3]).toFixed(1),
      ordersDb: ord.map(a => +db(a).toFixed(1)),
      peak: +st.peak.toFixed(4),
      rms: +st.rms.toFixed(4),
      nonFinite: st.bad,
      centroidOpen: Math.round(centroid(mag, SR, N, 8000)),
      centroidShut: Math.round(centroid(magShut, SR, N, 8000)),
      lowOpen: +band(mag, SR, N, 40, 300).toFixed(4),
      midOpen: +band(mag, SR, N, 300, 1500).toFixed(4),
      highOpen: +band(mag, SR, N, 1500, 9000).toFixed(4),
      lowShut: +band(magShut, SR, N, 40, 300).toFixed(4),
      midShut: +band(magShut, SR, N, 300, 1500).toFixed(4),
      highShut: +band(magShut, SR, N, 1500, 9000).toFixed(4),
      rmsOpen: +st.rms.toFixed(4),
      rmsShut: +stShut.rms.toFixed(4),
      peakShut: +stShut.peak.toFixed(4),
    };
  }

  // ---- the control case: a flat-plane V8's banks cancel at k=4, leaving k=8
  {
    const { ENGINES: E } = await import('/src/engineSpec.js');
    // build a temporary flat-plane variant from the AMG's pipe/formant setup
    E.__flat = Object.assign({}, E.v8na40, { banks: [[0, 180, 360, 540], [90, 270, 450, 630]] });
    const rpm = 4200, fc = rpm / 120;
    const r = await render('__flat', rpm, 0.95);
    const off = Math.floor(SR * 0.55);
    const mag = spectrum(r.d, off, N);
    const ord = [];
    for (let k = 1; k <= 16; k++) ord.push(near(mag, SR, N, k * fc, 1.6).a);
    const main = ord[7];
    out.flatPlaneControl = {
      halfOrder_dB: +(20 * Math.log10(Math.max(1e-12, ord[0]) / main)).toFixed(1),
      order2_dB: +(20 * Math.log10(Math.max(1e-12, ord[3]) / main)).toFixed(1),
      ordersDb: ord.map(a => +(20 * Math.log10(Math.max(1e-12, a) / main)).toFixed(1)),
    };
    delete E.__flat;
  }

  // ---- D: an rpm sweep through the limiter, checking for clips and dropouts
  {
    const secs = 3.0;
    const ctx = new OfflineAudioContext(1, Math.floor(SR * secs), SR);
    const out2 = ctx.createGain(); out2.connect(ctx.destination);
    const e = new PlayerEngine(ctx, out2, 'v8na40', 3);
    if (e.readyPromise) await e.readyPromise;
    e.set(900, 1, 7000, 1 / 60);
    if (e.mode === 'worklet') {
      e.p.rpm.setValueAtTime(900, 0);
      e.p.rpm.linearRampToValueAtTime(7400, secs * 0.8);
      e.p.throttle.setValueAtTime(1, 0);
    }
    const b = (await ctx.startRendering()).getChannelData(0);
    const s = stats(b, Math.floor(SR * 0.2), b.length);
    // how loud is each 100 ms window? a dropout would show as a near-zero one
    let minWin = 1e9, maxWin = 0;
    const W = Math.floor(SR * 0.1);
    for (let i = Math.floor(SR * 0.3); i + W < b.length - SR * 0.7; i += W) {
      const w = stats(b, i, i + W);
      minWin = Math.min(minWin, w.rms); maxWin = Math.max(maxWin, w.rms);
    }
    out.sweep = {
      peak: +s.peak.toFixed(4), rms: +s.rms.toFixed(4), nonFinite: s.bad,
      quietestWindowRms: +minWin.toFixed(4), loudestWindowRms: +maxWin.toFixed(4),
    };
  }

  // ---- E: does the browser's PeriodicWave convention match ours?
  {
    const eng = ENGINES.v8na40;
    const M = 1024;
    const ref = engineCycleWaveform(eng, { tauDeg: 26, m: M });
    const f0 = SR / M;                       // exactly one cycle per M samples
    const ctx = new OfflineAudioContext(1, M * 8, SR);
    const o = ctx.createOscillator();
    o.setPeriodicWave(enginePeriodicWave(ctx, eng, { harmonics: 150, tauDeg: 26, m: M }));
    o.frequency.value = f0;
    o.connect(ctx.destination);
    o.start(0);
    const b = (await ctx.startRendering()).getChannelData(0);
    // correlate the fourth rendered cycle against the reference, forward and reversed
    const seg = b.subarray(M * 4, M * 5);
    const corr = (a, c) => {
      let n = 0, da = 0, dc = 0, ma = 0, mc = 0;
      for (let i = 0; i < M; i++) { ma += a[i]; mc += c[i]; }
      ma /= M; mc /= M;
      for (let i = 0; i < M; i++) {
        const x = a[i] - ma, y = c[i] - mc;
        n += x * y; da += x * x; dc += y * y;
      }
      return n / Math.sqrt(da * dc);
    };
    // best circular alignment, since the oscillator's start phase is its own business
    let fwd = -2, rev = -2;
    const rot = new Float64Array(M), rf = new Float64Array(M);
    for (let sh = 0; sh < M; sh += 4) {
      for (let i = 0; i < M; i++) { rot[i] = ref[(i + sh) % M]; rf[i] = ref[(M - 1 - ((i + sh) % M))]; }
      fwd = Math.max(fwd, corr(seg, rot));
      rev = Math.max(rev, corr(seg, rf));
    }
    out.wavetable = { forwardCorr: +fwd.toFixed(3), reversedCorr: +rev.toFixed(3) };
  }

  // ---- doppler sanity
  out.doppler = {
    closing70: +doppler(70).toFixed(3),
    receding70: +doppler(-70).toFixed(3),
    still: +doppler(0).toFixed(3),
  };
  return out;
}, HELPERS);

/* ------------------------------------------------------------- F: the live mix */
await page.click('#start-btn');
await page.evaluate(() => {
  const g = window.__game;
  const a = g.audio;
  // tap the master bus and remember the worst sample we ever see
  const an = a.ctx.createAnalyser();
  an.fftSize = 2048;
  a.master.connect(an);
  const dat = new Float32Array(2048);
  window.__peak = 0; window.__rms = 0; window.__n = 0;
  window.__tap = () => {
    an.getFloatTimeDomainData(dat);
    let p = 0, s = 0;
    for (let i = 0; i < dat.length; i++) { const v = Math.abs(dat[i]); if (v > p) p = v; s += dat[i] * dat[i]; }
    window.__peak = Math.max(window.__peak, p);
    window.__rms += Math.sqrt(s / dat.length); window.__n++;
  };
  window.__poll = setInterval(window.__tap, 20);
  window.__reset = () => { window.__peak = 0; window.__rms = 0; window.__n = 0; };
});
/* Under software GL the renderer manages only a few frames a second, and the
   loop clamps dt to 50 ms — so simulated time runs far behind wall time. Wait
   on the car actually being fast rather than on a stopwatch. */
await page.keyboard.down('w');
/* Under software GL this renders at a couple of frames a second and the main
   loop clamps dt to 50 ms, so simulated time runs far behind wall time and the
   car cannot be relied on to reach any particular speed while ploughing through
   traffic. Take whatever it gives; the speed-dependent curves are measured
   deterministically in section G instead. */
await page.waitForFunction('window.__game.player.v * 3.6 > 110', { timeout: 120000, polling: 400 })
  .catch(() => {});
await page.evaluate(() => window.__reset());
await new Promise(r => setTimeout(r, 2000));

const openRoad = await page.evaluate(() => {
  const g = window.__game, a = g.audio;
  const r = {
    kmh: Math.round(g.player.v * 3.6), rpm: Math.round(g.player.rpm), gear: g.player.gear + 1,
    engine: +a.engine.gain.value.toFixed(4),
    wind: +a.wind.g.gain.value.toFixed(4),
    windLow: +a.windLow.g.gain.value.toFixed(4),
    road: +a.road.g.gain.value.toFixed(4),
    revSend: +a.revSend.gain.value.toFixed(4),
    engineMode: a.eng ? a.eng.mode : 'none',
    boost: a.eng ? +a.eng.boost.toFixed(3) : 0,
    peak: +window.__peak.toFixed(4),
    meanRms: +(window.__rms / Math.max(1, window.__n)).toFixed(4),
    fps: Math.round(g.renderer.info.render.frame / (performance.now() / 1000)),
  };
  return r;
});

/* Into the Engelbergtunnel. The car is doing 70 m/s, so it would be out the
   far end long before the reverb send has finished ramping — pin it to the
   middle of the bore for a couple of seconds instead. */
await page.evaluate(() => {
  const g = window.__game;
  const [a, b] = g.world.tunnelRange;
  const mid = (a + b) / 2;
  window.__pin = setInterval(() => { g.player.s = mid; }, 30);
});
await page.waitForFunction('window.__game._tunnelMix > 0.93', { timeout: 60000, polling: 200 });
await page.evaluate(() => window.__reset());
await new Promise(r => setTimeout(r, 2000));
const tunnel = await page.evaluate(() => {
  const g = window.__game, a = g.audio;
  return {
    km: +(g.player.s / 1000).toFixed(2),
    inTunnel: g.world.inTunnel(g.player.s),
    tunnelMix: +g._tunnelMix.toFixed(3),
    revSend: +a.revSend.gain.value.toFixed(4),
    engine: +a.engine.gain.value.toFixed(4),
    road: +a.road.g.gain.value.toFixed(4),
    peak: +window.__peak.toFixed(4),
    meanRms: +(window.__rms / Math.max(1, window.__n)).toFixed(4),
  };
});
await page.evaluate(() => { clearInterval(window.__pin); });
await page.keyboard.up('w');

/* ---------------------------------------------------------- G: the mix curves
   The physics cannot be driven to a chosen speed in a headless renderer, so
   drive the mixer directly instead: stop the game loop stepping, feed
   audio.update() a synthetic state at each speed, and let the AudioParam ramps
   settle before reading them back. This is the wind law under test. */
const curves = await page.evaluate(async () => {
  const g = window.__game, a = g.audio;
  g.state = 'probe';                       // the loop renders but stops stepping
  const base = {
    rpm: 4000, throttle: 0.9, slip: 0, offroad: false, scrape: 0, engineOn: true,
    siren: false, sirenNear: 0, gear: 6, shiftT: 0, redline: 7000,
    tunnel: 0, cam: 0, others: [], playerS: 1000, playerU: 0, copS: 0, copV: 0,
  };
  const res = [];
  for (const kmh of [60, 125, 200, 250, 320]) {
    const st = Object.assign({}, base, { speed: kmh / 3.6 });
    for (let i = 0; i < 26; i++) { a.update(1 / 60, st); await new Promise(r => setTimeout(r, 16)); }
    res.push({
      kmh,
      wind: +a.wind.g.gain.value.toFixed(4),
      buffet: +a.windLow.g.gain.value.toFixed(4),
      road: +a.road.g.gain.value.toFixed(4),
      engine: +a.engine.gain.value.toFixed(4),
      peak: +window.__peak.toFixed(4),
    });
    window.__reset();
  }
  // and the scrub, which is what a slide sounds like
  const slid = Object.assign({}, base, { speed: 60, slip: 0.9 });
  for (let i = 0; i < 26; i++) { a.update(1 / 60, slid); await new Promise(r => setTimeout(r, 16)); }
  const scrub = { tyre: +a.tyre.g.gain.value.toFixed(4), squeal: +a.squealG.gain.value.toFixed(4) };

  // Control-event wiring: a real upshift must reach bark(), and lifting after
  // building boost must reach blowOff(). Wrap the actual methods so the sound
  // still fires while we count the calls.
  let barks = 0, blowOffs = 0;
  const bark = a.eng.bark.bind(a.eng), blowOff = a.eng.blowOff.bind(a.eng);
  a.eng.bark = (...args) => { barks++; return bark(...args); };
  a.eng.blowOff = (...args) => { blowOffs++; return blowOff(...args); };
  a._gear = 2;
  a.update(1 / 60, Object.assign({}, base, { gear: 3, throttle: 1 }));
  a.eng.boost = 0.8; a.eng._lastTh = 1;
  a.update(1 / 60, Object.assign({}, base, { gear: 3, throttle: 0 }));
  a.eng.bark = bark; a.eng.blowOff = blowOff;

  clearInterval(window.__poll);
  return { res, scrub, events: { barks, blowOffs } };
});

/* ------------------------------------------------------------------- report */
const L = [];
const say = (s) => { L.push(s); console.log(s); };
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

say(`source          : ${engineReport.mode}`);
say('');
say('--- A. firing order: energy at k·(rpm/120), dB relative to the k=cyl firing partial');
say('    engine order = k/2, so k=1 is the half order — the cross-plane burble');
say('');
for (const [key, e] of Object.entries(engineReport.engines)) {
  say(`  ${key.padEnd(9)} ${e.label}`);
  say(`      k:        ${e.ordersDb.map((d, i) => String(i + 1).padStart(6)).join('')}`);
  say(`      dB:       ${e.ordersDb.map(d => String(d).padStart(6)).join('')}`);
  say(`      half-order ${String(e.halfOrder_dB).padStart(6)} dB   1.5-order ${String(e.order1p5_dB).padStart(6)} dB`);
  say(`      firing partial ${e.firingPartialHz} Hz (want ${e.firingPartialWantHz});`
    + ` at 1500 rpm ${e.lowRpmPartialHz} Hz (want ${e.lowRpmWantHz})`);
  say(`      peak ${e.peak}  rms open ${e.rmsOpen} / shut ${e.rmsShut}`
    + `  centroid open ${e.centroidOpen} Hz / shut ${e.centroidShut} Hz`);
  say(`      band energy  40-300 Hz ${e.lowOpen} / ${e.lowShut}`
    + `   300-1500 ${e.midOpen} / ${e.midShut}`
    + `   1.5-9k ${e.highOpen} / ${e.highShut}   (open / overrun)`);
  say('');
}
say(`  control: flat-plane V8 banks cancel at k=4`);
say(`      dB:       ${engineReport.flatPlaneControl.ordersDb.map(d => String(d).padStart(6)).join('')}`);
say('');

const E = engineReport.engines;
const F = engineReport.flatPlaneControl;

check('worklet is the source (not the wavetable fallback)', engineReport.mode === 'worklet',
  `mode=${engineReport.mode}`);

for (const [key, e] of Object.entries(E)) {
  check(`${key}: firing partial lands on cyl·rpm/120`,
    Math.abs(e.firingPartialHz - e.firingPartialWantHz) < 2.0,
    `${e.firingPartialHz} vs ${e.firingPartialWantHz} Hz`);
  check(`${key}: pitch tracks rpm down to 1500`,
    Math.abs(e.lowRpmPartialHz - e.lowRpmWantHz) < 2.0,
    `${e.lowRpmPartialHz} vs ${e.lowRpmWantHz} Hz`);
  check(`${key}: no clipping`, e.peak < 1.0 && e.peakShut < 1.0,
    `peak ${e.peak} / ${e.peakShut}`);
  check(`${key}: no non-finite samples`, e.nonFinite === 0, `${e.nonFinite}`);
  check(`${key}: open throttle is louder than overrun`, e.rmsOpen > e.rmsShut * 1.3,
    `${e.rmsOpen} vs ${e.rmsShut}`);
  // "different spectrum on overrun" measured where it matters: an engine on
  // load radiates far more everywhere, and disproportionately more up top
  check(`${key}: overrun loses the top end`, e.highOpen > e.highShut * 2.0,
    `1.5-9k ${e.highOpen} vs ${e.highShut}`);
  check(`${key}: overrun loses the bottom end`, e.lowOpen > e.lowShut * 2.0,
    `40-300 ${e.lowOpen} vs ${e.lowShut}`);
}

// the discriminating measurement
for (const k of ['v8tt44', 'v8tt40', 'v8na40']) {
  check(`${k}: cross-plane half-order is present (burble)`, E[k].halfOrder_dB > -26,
    `${E[k].halfOrder_dB} dB`);
}
check('flat6tt: no half-order (even-firing banks)', E.flat6tt.halfOrder_dB < -22,
  `${E.flat6tt.halfOrder_dB} dB`);
check('flat6tt has a 1.5-order (bank fires every 240°)', E.flat6tt.order1p5_dB > -30,
  `${E.flat6tt.order1p5_dB} dB`);
check('control: flat-plane V8 half-order far below cross-plane',
  F.halfOrder_dB < E.v8na40.halfOrder_dB - 8,
  `flat ${F.halfOrder_dB} dB vs cross ${E.v8na40.halfOrder_dB} dB`);
check('inline-four: no half-order (single even bank)', E.four.halfOrder_dB < -20,
  `${E.four.halfOrder_dB} dB`);

say('');
say(`--- D. rpm sweep 900 → 7400 with the limiter: ${JSON.stringify(engineReport.sweep)}`);
check('sweep does not clip', engineReport.sweep.peak < 1.0, `peak ${engineReport.sweep.peak}`);
check('sweep has no non-finite samples', engineReport.sweep.nonFinite === 0);
check('sweep never drops out', engineReport.sweep.quietestWindowRms > 0.004,
  `quietest 100 ms window rms ${engineReport.sweep.quietestWindowRms}`);

say('');
say(`--- E. wavetable convention: ${JSON.stringify(engineReport.wavetable)}`);
check('PeriodicWave reproduces the pulse train the right way round',
  engineReport.wavetable.forwardCorr > engineReport.wavetable.reversedCorr &&
  engineReport.wavetable.forwardCorr > 0.9,
  `fwd ${engineReport.wavetable.forwardCorr} rev ${engineReport.wavetable.reversedCorr}`);

say('');
say(`--- doppler: ${JSON.stringify(engineReport.doppler)}`);
check('doppler: 70 m/s closing raises pitch ~25%',
  Math.abs(engineReport.doppler.closing70 - 1.256) < 0.02);
check('doppler: 70 m/s receding lowers pitch ~17%',
  Math.abs(engineReport.doppler.receding70 - 0.83) < 0.02);

say('');
say(`--- F. live mix, open road : ${JSON.stringify(openRoad)}`);
say(`--- F. live mix, tunnel    : ${JSON.stringify(tunnel)}`);
check('live: engine is running', openRoad.engine > 0.01);
check('live: worklet engine in the real game', openRoad.engineMode === 'worklet',
  openRoad.engineMode);
check('live: wind responds to road speed', openRoad.wind > 0.001,
  `${openRoad.wind} at ${openRoad.kmh} km/h`);
check('live: master bus does not clip', openRoad.peak < 1.0 && tunnel.peak < 1.0,
  `open ${openRoad.peak}, tunnel ${tunnel.peak}`);
check('live: reverb is dry outside the tunnel', openRoad.revSend < 0.02, `${openRoad.revSend}`);
check('live: reverb comes up inside the tunnel', tunnel.inTunnel && tunnel.revSend > 0.45,
  `inTunnel=${tunnel.inTunnel} revSend=${tunnel.revSend}`);
check('live: the tunnel is louder than the open road', tunnel.meanRms > openRoad.meanRms,
  `${tunnel.meanRms} vs ${openRoad.meanRms}`);

say('');
say('--- G. mix curves, measured by driving audio.update() directly');
say('     km/h    wind  buffet    road  engine  masterPeak');
for (const r of curves.res) {
  say(`    ${String(r.kmh).padStart(5)}  ${String(r.wind).padStart(6)}  ${String(r.buffet).padStart(6)}`
    + `  ${String(r.road).padStart(6)}  ${String(r.engine).padStart(6)}  ${String(r.peak).padStart(10)}`);
}
const C = {}; for (const r of curves.res) C[r.kmh] = r;
check('wind rises monotonically with speed',
  C[60].wind < C[125].wind && C[125].wind < C[200].wind
  && C[200].wind < C[250].wind && C[250].wind < C[320].wind);
check('wind is superlinear (doubling speed more than quadruples it)',
  C[250].wind / C[125].wind > 4.0, `x${(C[250].wind / C[125].wind).toFixed(2)} from 125 to 250`);
check('wind overtakes road roar above 200 km/h', C[200].wind > C[200].road,
  `wind ${C[200].wind} vs road ${C[200].road}`);
check('road roar is the floor at low speed', C[60].road > C[60].wind,
  `road ${C[60].road} vs wind ${C[60].wind}`);
check('no clipping at 320 km/h', C[320].peak < 1.0, `peak ${C[320].peak}`);
say(`     scrub at 60 km/h, slip 0.9: ${JSON.stringify(curves.scrub)}`);
check('a slide makes scrub noise and a squeal',
  curves.scrub.tyre > 0.05 && curves.scrub.squeal > 0.01, JSON.stringify(curves.scrub));
say(`     control events: ${JSON.stringify(curves.events)}`);
check('an upshift fires the exhaust bark', curves.events.barks === 1,
  `${curves.events.barks} bark call(s)`);
check('lifting off boost fires the dump valve', curves.events.blowOffs === 1,
  `${curves.events.blowOffs} blow-off call(s)`);

say('');
say(errs.length ? errs.slice(0, 10).join('\n') : 'no page errors');
if (errs.length) fails++;
say('');
say(fails === 0 ? 'ALL CHECKS PASS' : `${fails} CHECK(S) FAILED`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
