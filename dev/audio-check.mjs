/* Verifies that the engine mixer actually goes silent when the simulation
   stops: on pause, and on the results screen. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await page.click('#start-btn');
await page.keyboard.down('w');
await new Promise(r => setTimeout(r, 3500));
await page.keyboard.up('w');

const gains = () => page.evaluate(() => {
  const a = window.__game.audio;
  if (!a.ready) return 'audio not started';
  const v = (g) => +g.gain.value.toFixed(4);
  return { engine: v(a.engine), wind: v(a.wind.g), tyre: v(a.tyre.g), siren: v(a.sirenG),
           state: window.__game.state, paused: window.__game.paused, frames: window.__game.renderer.info.render.frame };
});
const driving = await gains();

await page.keyboard.press('p');
await new Promise(r => setTimeout(r, 1200));
const paused = await gains();

await page.keyboard.press('p');           // unpause
await page.keyboard.down('w');
await new Promise(r => setTimeout(r, 3000));
const resumed = await gains();
await page.keyboard.up('w');

// finish the race and check the results screen
await page.evaluate(async () => {
  const g = window.__game;
  const { LENGTH } = await import('/src/track.js');
  g.player.s = LENGTH - 5;
  g.step(1 / 60);
});
await new Promise(r => setTimeout(r, 1200));
const results = await gains();

console.log('driving :', JSON.stringify(driving));
console.log('paused  :', JSON.stringify(paused));
console.log('resumed :', JSON.stringify(resumed));
console.log('results :', JSON.stringify(results));
const quiet = (s) => typeof s === 'object' && s.engine < 0.005 && s.wind < 0.005;
console.log('\nPAUSE silent :', quiet(paused) ? 'PASS' : 'FAIL');
console.log('RESULTS silent:', quiet(results) ? 'PASS' : 'FAIL');
console.log('resumes after unpause:', typeof resumed === 'object' && resumed.engine > 0.005 ? 'PASS' : 'FAIL');
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
