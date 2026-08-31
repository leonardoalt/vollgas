/* Verifies the built bundle: loads dist/, starts a race, drives on real frames
   (no dev module imports), and reports any console error. */
import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
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
const t0 = Date.now();
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
const loadMs = Date.now() - t0;

await page.click('#start-btn');
// hold the throttle down for real, through the real key handler
await page.keyboard.down('w');
await new Promise(r => setTimeout(r, 14000));
await page.keyboard.up('w');
const st = await page.evaluate(() => {
  const g = window.__game;
  return {
    state: g.state, km: +(g.player.s / 1000).toFixed(2), kmh: Math.round(g.player.v * 3.6),
    gear: g.player.gear + 1, damage: Math.round(g.player.damage),
    traffic: g.traffic.all.length, cops: g.enf.cops.length, cameras: g.enf.cameras.length,
    tris: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls,
    geoms: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures,
  };
});
await page.screenshot({ path: out });
console.log('load', loadMs + 'ms |', JSON.stringify(st));
console.log(errs.length ? errs.slice(0, 8).join('\n') : 'no console errors');
await browser.close();
