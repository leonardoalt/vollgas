/* Fires the kind of burst that used to bury the car — several speed-camera
   fines plus a warning, a measurement and a crash — and reports how many alert
   rows survive. Coalescing by key should keep it to one row per category. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/alerts.png';
const langWanted = process.argv[4] || 'de';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1280,760', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('a81.lang', l); } catch {} }, langWanted);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await page.click('#start-btn');
await page.keyboard.down('w');
await new Promise(r => setTimeout(r, 2500));
await page.keyboard.up('w');

const info = await page.evaluate(async () => {
  const g = window.__game;
  const { penaltyFor } = await import('/src/police.js');
  g.countdown = 0;
  // three camera hits in quick succession, plus the other categories
  for (const [limit, kmh] of [[100, 148], [100, 131], [120, 166]]) {
    g.enf.events.push({ type: 'flash', penalty: penaltyFor(kmh - limit), limit, speed: kmh });
    g.handleEvents();
  }
  g.enf.events.push({ type: 'lichthupe', threat: { kind: 'blitzer', rel: 800 } });
  g.enf.events.push({ type: 'measure-start' });
  g.handleEvents();
  g.enf.events.push({ type: 'stopped' });
  g.handleEvents();
  return {
    rows: [...document.querySelectorAll('#hud-alerts .alert')].map(e => e.textContent.trim()),
    domRows: document.querySelectorAll('#hud-alerts .alert').length,
    keys: g.hud.alerts.map(a => a.key + (a.reps > 1 ? '×' + a.reps : '')),
    rect: (() => { const r = document.getElementById('hud-alerts').getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })(),
  };
});
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: out });
console.log('alert box:', JSON.stringify(info.rect));
console.log('keys     :', info.keys.join(', '));
info.rows.forEach(r => console.log('  •', r.replace(/\s+/g, ' ')));
console.log('rows:', info.rows.length, '| centre of screen clear:', info.rect.left + info.rect.w < 420 ? 'YES' : 'NO');
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
