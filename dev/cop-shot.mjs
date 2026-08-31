import puppeteer from 'puppeteer-core';
const [url, out, phase] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1280,760', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
const info = await page.evaluate(async (ph) => {
  const g = window.__game;
  g.startRace();
  const { LANES, limitAt } = await import('/src/track.js');
  const { COP_STATE } = await import('/src/police.js');
  const p = g.player;
  // put the player deep in a restricted section, going far too fast
  p.s = 21400; p.u = LANES[0]; p.v = 62;      // ~223 km/h in a 120 zone
  g.countdown = 0;
  // plant a patrol car just behind
  const z = g.enf.cops[0];
  z.s = p.s - 60; z.u = LANES[0]; z.v = 60; z.state = COP_STATE.CRUISE;
  const dt = 1 / 40;
  // hold speed and let the measurement run
  for (let i = 0; i < 40 * 40; i++) {
    g.input.update = () => Object.assign(g.input, { throttle: 0.62, brake: 0, steer: (LANES[0] - p.u) * 0.25 - p.psi * 2, handbrake: false });
    g.step(dt);
    if (ph === 'measure' && z.measure > 0.55) break;
    if (ph === 'pursue' && z.state === COP_STATE.PURSUE && z.pursueClose > 0.6) break;
  }
  // rear-facing look at the car behind
  if (ph === 'pursue') g.camMode = 4;
  delete g.input.update;
  return { limit: limitAt(p.s), kmh: Math.round(p.v * 3.6), state: z.state, measure: +z.measure.toFixed(2), gap: Math.round(p.s - z.s), fines: p.fines, points: p.points };
}, phase);
await new Promise(r => setTimeout(r, 900));
// for the pursue shot, freeze the sim and look back at the patrol car
if (phase === 'pursue') {
  await page.evaluate(async () => {
    const g = window.__game;
    const { toWorld } = await import('/src/track.js');
    const p = g.player;
    g.state = 'frozen';                       // stop the loop reclaiming the camera
    const eye = toWorld(p.s + 13, p.u - 1.0);
    const at = toWorld(p.s - 34, p.u);
    g.camera.position.set(eye.x, eye.y + 2.2, eye.z);
    g.camera.lookAt(at.x, at.y + 1.0, at.z);
  });
  await new Promise(r => setTimeout(r, 600));
}
await page.screenshot({ path: out });
console.log(JSON.stringify(info), errs.length ? errs.slice(0,4).join(' ; ') : 'no errors');
await browser.close();
