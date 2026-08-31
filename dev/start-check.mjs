import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
         '--window-size=1280,760','--hide-scrollbars','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil:'networkidle0', timeout:90000 });
await page.waitForFunction('window.__ready === true', { timeout:90000 });
await page.click('#start-btn');
// step the sim a little so we are mid-slip-road, then freeze for the shot
const info = await page.evaluate(async () => {
  const g = window.__game;
  const { entryRamp, pavedRange } = await import('/src/track.js');
  for (let i = 0; i < 60 * 2.2; i++) g.step(1/60);
  const p = g.player;
  const e = entryRamp(p.s);
  return { s: Math.round(p.s), u: +p.u.toFixed(2), kmh: Math.round(p.v*3.6),
           ramp: e ? { inner:+e.inner.toFixed(1), outer:+e.outer.toFixed(1), centre:+e.centre.toFixed(2) } : null,
           onRamp: e ? (p.u > e.inner - 0.5 && p.u < e.outer + 0.5) : false,
           offroad: p.offroad, countdown: +g.countdown.toFixed(1) };
});
await new Promise(r=>setTimeout(r,700));
await page.screenshot({ path: process.argv[2] });
console.log(JSON.stringify(info));
console.log(errs.length?errs.join('\n'):'no page errors');
await browser.close();
