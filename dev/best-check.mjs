import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
         '--window-size=1280,760','--hide-scrollbars','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(process.env.URL || 'http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
console.log('default language with empty storage:', await page.evaluate(() => document.documentElement.lang));
const run = async (raceTime) => page.evaluate(async (rt) => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { LENGTH, LANES } = await import('/src/track.js');
  const p = g.player;
  g.raceTime = rt; p.vmaxSeen = 305; p.s = LENGTH - 40; p.u = LANES[0]; p.v = 78;
  for (let i = 0; i < 60 * 8; i++) {
    g.input.update = () => Object.assign(g.input, { throttle: 1, brake: 0, steer: 0, handbrake: false });
    g.step(1/60);
    if (g.state !== 'race') break;
  }
  delete g.input.update;
  return { isBest: g.results.isBest, prev: g.results.prev, time: +g.results.time.toFixed(1),
           stored: localStorage.getItem('a81.best.' + g.carId),
           headline: document.getElementById('results-place').textContent };
}, raceTime);
console.log('run 1 (8:00):', JSON.stringify(await run(480)));
await page.evaluate(() => { document.getElementById('again-btn').click(); });
console.log('run 2 (7:20):', JSON.stringify(await run(440)));
await page.evaluate(() => { document.getElementById('again-btn').click(); });
console.log('run 3 (9:00):', JSON.stringify(await run(540)));
await page.screenshot({ path: process.argv[2] });
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
