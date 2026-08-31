/* All three ways a run ends: the card must appear with the right word, hold,
   and only then hand over to the results screen. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || '/tmp';
const langWanted = process.argv[4] || 'de';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
         '--window-size=1280,760','--hide-scrollbars','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('a81.lang', l); } catch {} }, langWanted);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

for (const kind of ['arrest', 'points', 'wreck']) {
  const res = await page.evaluate(async (k) => {
    const g = window.__game;
    g.startRace(); g.countdown = 0;
    const { LANES } = await import('/src/track.js');
    const { COP_STATE } = await import('/src/police.js');
    const p = g.player;
    p.s = 21400; p.u = LANES[0]; p.v = 62;

    // fire the real trigger for each ending
    if (k === 'arrest') {
      const z = g.enf.cops[0];
      z.s = p.s - 30; z.u = p.u; z.v = p.v; z.state = COP_STATE.PURSUE;
      z.setLights(true); z.pursueClose = 9;             // about to declare the stop
    } else if (k === 'points') {
      p.points = 8; p.fines = 900;
    } else {
      p.damage = 100;
    }

    let cardAt = null, word = null, sub = null, copInStop = false;
    let parkGap = null, mirrorNdc = null, inMirror = null;
    const dt = 1 / 40;
    for (let i = 0; i < 40 * 40; i++) {
      g.input.update = () => Object.assign(g.input, {
        throttle: 0, brake: k === 'wreck' ? 0.6 : 0,
        steer: 0, handbrake: false,
      });
      g.step(dt);
      const on = document.getElementById('busted').classList.contains('on');
      if (on && cardAt === null) {
        cardAt = +(i * dt).toFixed(1);
        word = document.querySelector('#busted h2').textContent;
        sub = document.querySelector('#busted p').textContent;
        const stopper = g.enf.cops.find(z => z.state === COP_STATE.STOP);
        copInStop = !!stopper;
        if (stopper) {
          parkGap = +(p.s - stopper.s).toFixed(1);
          // is the car that stopped you actually visible in the mirror?
          g.renderMirror();
          const v = stopper.mesh.position.clone();
          v.y += 0.7;
          const ndc = v.project(g.mirrorCam);
          mirrorNdc = [+ndc.x.toFixed(2), +ndc.y.toFixed(2)];
          inMirror = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z > -1 && ndc.z < 1;
        }
      }
      if (g.state !== 'race') break;
    }
    delete g.input.update;
    return {
      kind: k, cardAt, word, sub, copInStop, parkGap, mirrorNdc, inMirror,
      state: g.state, dnf: g.results && g.results.dnf,
      cardHiddenAfter: !document.getElementById('busted').classList.contains('on')
        || document.getElementById('hud').classList.contains('hidden'),
    };
  }, kind);
  console.log(JSON.stringify(res));
  const ok = res.cardAt !== null && res.state === 'results' && !!res.word;
  console.log(`  ${kind.padEnd(7)} card at ${res.cardAt}s "${res.word}" -> results:`, ok ? 'PASS' : 'FAIL');
  if (kind !== 'wreck') {
    console.log(`          parked ${res.parkGap} m back, ndc ${JSON.stringify(res.mirrorNdc)}`,
      '| visible in mirror:', res.inMirror ? 'PASS' : 'FAIL');
  }
}

// one screenshot of the card mid-hold
await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { LANES } = await import('/src/track.js');
  const { COP_STATE } = await import('/src/police.js');
  const p = g.player;
  p.s = 21400; p.u = LANES[0]; p.v = 60; p.fines = 1180; p.points = 5;
  const z = g.enf.cops[0];
  z.s = p.s - 28; z.u = p.u; z.v = p.v; z.state = COP_STATE.PURSUE;
  z.setLights(true); z.pursueClose = 9;
  for (let i = 0; i < 40 * 40; i++) {
    g.step(1 / 40);
    if (g.ending && g.ending.shown) { g.ending.showT = 0.6; break; }
  }
  g.state = 'frozen';
});
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: `${outDir}/busted-card.png` });
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
