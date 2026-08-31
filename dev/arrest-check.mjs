/* Drives the whole pursuit -> pull-over -> run-over sequence, and separately
   asserts that no Lichthupe warning fires inside the tunnel. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/arrest.png';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1280,760', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[err] ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

/* ---------- 1. tunnel: no oncoming traffic to flash at you ---------- */
const tunnel = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { sectionAt, SECTIONS } = await import('/src/track.js');
  const sec = SECTIONS.find(s => s.tunnel);
  const p = g.player;
  p.s = sec.km * 1000 + 400; p.v = 60;
  // park a camera and a patrol car within warning range ahead
  g.enf.cameras[0].s = p.s + 700; g.enf.cameras[0].warned = false;
  g.enf.cops[0].s = p.s + 600;
  g.traffic.opp.forEach((o, i) => { o.s = p.s + 60 + i * 20; });
  let warns = 0;
  const seen = [];
  for (let i = 0; i < 40 * 8; i++) {
    g.step(1 / 40);
    for (const e of g.enf.events) if (e.type === 'lichthupe') warns++;
    g.handleEvents();
  }
  return { inTunnel: !!sectionAt(g.player.s).tunnel, warnsInTunnel: warns };
});
console.log('tunnel:', JSON.stringify(tunnel));

/* ---------- 1b. the bar must never fill while the car is out of sight ----- */
const vis = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { LANES } = await import('/src/track.js');
  const { COP_STATE } = await import('/src/police.js');
  const p = g.player;
  p.s = 21400; p.u = LANES[0]; p.v = 58;
  const z = g.enf.cops[0];
  z.s = p.s - 45; z.u = LANES[0]; z.v = 57; z.state = COP_STATE.CRUISE;
  const RADAR = 200;
  let maxGapWhileMeasuring = 0, samples = 0, offRadar = 0, peakBar = 0;
  for (let i = 0; i < 40 * 60; i++) {
    // flat out: try to run away from the measurement
    g.input.update = () => Object.assign(g.input, {
      throttle: 1, brake: 0, steer: (LANES[0] - p.u) * 0.25 - p.psi * 2, handbrake: false,
    });
    g.step(1 / 40);
    if (z.state === COP_STATE.MEASURE && z.measure > 0.15) {
      const gap = p.s - z.s;
      samples++;
      peakBar = Math.max(peakBar, z.measure);
      maxGapWhileMeasuring = Math.max(maxGapWhileMeasuring, gap);
      if (gap > RADAR) offRadar++;
    }
    if (g.state !== 'race' || z.state === COP_STATE.DONE || z.state === COP_STATE.PURSUE) break;
  }
  delete g.input.update;
  return {
    outcome: z.state, peakBar: +peakBar.toFixed(2), samples,
    maxGapWhileMeasuring: Math.round(maxGapWhileMeasuring),
    framesOffRadar: offRadar, playerKmh: Math.round(p.v * 3.6),
  };
});
console.log('measuring visibility:', JSON.stringify(vis));
console.log('  -> bar never fills off-radar:', vis.framesOffRadar === 0 ? 'PASS' : 'FAIL');

/* ---------- 1c. escaping must be earned ---------- */
const escape = await page.evaluate(async () => {
  const g = window.__game;
  const { LANES } = await import('/src/track.js');
  const { COP_STATE } = await import('/src/police.js');
  // scenario runner: `mode` decides how the player reacts to being measured
  const run = (mode) => {
    g.startRace(); g.countdown = 0;
    const p = g.player;
    p.s = 21400; p.u = LANES[0]; p.v = 58;
    const z = g.enf.cops[0];
    z.s = p.s - 45; z.u = LANES[0]; z.v = 57; z.state = COP_STATE.CRUISE;
    let maxGap = 0, barPeak = 0, offRadar = 0, barSamples = 0;
    for (let i = 0; i < 40 * 70; i++) {
      const measuring = z.state === COP_STATE.MEASURE;
      // flat out, or lift off to the limit once they are on you
      const thr = (mode === 'run' || !measuring) ? 1 : 0;
      const brk = (mode === 'lift' && measuring && p.v > 34) ? 0.55 : 0;
      g.input.update = () => Object.assign(g.input, {
        throttle: thr, brake: brk, steer: (LANES[0] - p.u) * 0.25 - p.psi * 2, handbrake: false,
      });
      g.step(1 / 40);
      if (measuring) {
        const gap = p.s - z.s;
        maxGap = Math.max(maxGap, gap);
        if (z.measure > 0.15) { barSamples++; if (gap > 200) offRadar++; }
        barPeak = Math.max(barPeak, z.measure);
      }
      if (g.state !== 'race') break;
      if (z.state === COP_STATE.DONE || z.state === COP_STATE.PURSUE || z.state === COP_STATE.STOP) break;
    }
    delete g.input.update;
    return { mode, outcome: z.state, barPeak: +barPeak.toFixed(2),
             maxGap: Math.round(maxGap), barSamples, offRadar,
             playerKmh: Math.round(p.v * 3.6) };
  };
  return [run('run'), run('lift')];
});
escape.forEach(r => console.log('escape', JSON.stringify(r)));
// past twice the limit the measurement becomes a § 315d charge, which forces a
// stop rather than a pursuit — either way you did not get away with it
console.log('  flat out still gets caught  :',
  ['pursue', 'stop'].includes(escape[0].outcome) ? 'PASS' : 'FAIL (' + escape[0].outcome + ')');
console.log('  lifting off still saves you :', escape[1].outcome === 'done' ? 'PASS' : 'FAIL (' + escape[1].outcome + ')');
console.log('  bar never fills off-radar   :', escape.every(r => r.offRadar === 0) ? 'PASS' : 'FAIL');

/* ---------- 2. full arrest sequence ---------- */
const arrest = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { LANES } = await import('/src/track.js');
  const { COP_STATE } = await import('/src/police.js');
  const p = g.player;
  p.s = 21400; p.u = LANES[0]; p.v = 64;
  const z = g.enf.cops[0];
  z.s = p.s - 55; z.u = LANES[0]; z.v = 62; z.state = COP_STATE.CRUISE;
  const log = [];
  let lastState = '';
  for (let i = 0; i < 40 * 90; i++) {
    // hold speed until reported, then give up and coast (as a player would)
    const held = z.state === COP_STATE.MEASURE || z.state === COP_STATE.CRUISE;
    g.input.update = () => Object.assign(g.input, {
      throttle: held ? 0.66 : 0, brake: held ? 0 : 0.45,
      steer: (LANES[0] - p.u) * 0.25 - p.psi * 2, handbrake: false,
    });
    g.step(1 / 40);
    if (z.state !== lastState) {
      lastState = z.state;
      log.push(`${g.raceTime.toFixed(1)}s ${z.state} gap=${(p.s - z.s).toFixed(0)}m playerV=${Math.round(p.v * 3.6)}`);
    }
    // hold the frame while both cars sit on the shoulder, for the screenshot
    // hold the frame while both cars sit on the shoulder, for the screenshot
    if (z.state === COP_STATE.STOP && p.v < 2 && z.v < 2) {
      if (g.ending) g.ending.showT = -999;      // keep the card from advancing
      break;
    }
    if (g.state !== 'race') break;
  }
  delete g.input.update;
  return {
    log, gameState: g.state,
    copState: z.state, copSpeed: Math.round(z.v * 3.6), playerSpeed: Math.round(p.v * 3.6),
    copU: +z.u.toFixed(1), playerU: +p.u.toFixed(1), gap: Math.round(p.s - z.s),
    dnf: g.results && g.results.dnf, fines: p.fines, points: p.points,
    copStillThere: !!z.mesh.parent,
    endingKind: g.ending && g.ending.kind,
    bustedShown: document.getElementById('busted').classList.contains('on'),
    bustedWord: (document.querySelector('#busted h2') || {}).textContent,
  };
});
console.log('arrest transitions:');
arrest.log.forEach(l => console.log('  ', l));
console.log('final:', JSON.stringify({ ...arrest, log: undefined }));
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: out });            // both stopped on the shoulder
// now let it finish and capture the time-trial result
await page.evaluate(() => {
  const g = window.__game;
  if (g.ending) { g.ending.shown = true; g.ending.showT = 3.0; }
  g.step(1 / 40);
});
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: out.replace('.png', '-results.png') });
console.log(errs.length ? errs.slice(0, 5).join('\n') : 'no page errors');
await browser.close();
