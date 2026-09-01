/* The player model is intentionally arcade-stable. A full high-speed reversal
   must settle for every selectable car, especially the rear-drive AMG. */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

const rows = await page.evaluate(async () => {
  const g = window.__game;
  const { LANES } = await import('/src/track.js');
  const { PLAYER_CARS } = await import('/src/carFactory.js');
  const R2D = 180 / Math.PI;
  const out = [];

  for (let ci = 0; ci < PLAYER_CARS.length; ci++) {
    g.selected = ci; g.startRace(); g.countdown = 0;
    const p = g.player;
    p.s = 8000; p.u = LANES[0]; p.v = 75;
    p.psi = 0; p.vy = 0; p.r = 0; p.offroad = false;
    p.rack.reset();
    let peak = 0, latePeak = 0;
    for (let i = 0; i < 600; i++) {
      /* Pin only lateral position so this is a steering-state test rather
         than a guardrail collision after deliberately holding full lock. */
      p.u = LANES[0]; p.offroad = false;
      const steer = i < 45 ? 1 : i < 90 ? -1 : 0;
      p.control(1 / 100, { throttle: 0.45, brake: 0, steer, handbrake: false }, null);
      peak = Math.max(peak, Math.abs(p.psi));
      if (i >= 190) latePeak = Math.max(latePeak, Math.abs(p.psi));
    }
    out.push({
      car: p.id, arcade: p.arcade,
      peakDeg: peak * R2D, latePeakDeg: latePeak * R2D,
      finalDeg: Math.abs(p.psi) * R2D,
    });
  }
  return out;
});

await browser.close();
let failures = errors.length;
for (const r of rows) {
  const ok = r.arcade && r.peakDeg < 8 && r.latePeakDeg < 0.5 && r.finalDeg < 0.05;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.car} settles after reversal  `
    + `peak=${r.peakDeg.toFixed(2)}° late=${r.latePeakDeg.toFixed(3)}° final=${r.finalDeg.toFixed(3)}°`);
}
if (errors.length) console.log(errors.join('\n'));
process.exit(failures ? 1 : 0);
