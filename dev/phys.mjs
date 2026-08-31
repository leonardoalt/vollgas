import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(process.argv[2] || 'http://localhost:5188/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
const out = await page.evaluate(async () => {
  const { Player } = await import('/src/vehicles.js');
  const { CARS, PLAYER_CARS } = await import('/src/carFactory.js');
  const rows = [];
  for (const id of PLAYER_CARS) {
    const p = new Player(id, 0x888888);
    p.s = 14000;                       // a flat, unrestricted stretch
    p.v = 0.5; p.u = 4.375;
    const dt = 1 / 200;
    let t = 0, t100 = null, t200 = null, t300 = null;
    for (let i = 0; i < 200 * 90; i++) {
      p.stepLong(dt, 1, 0, null);
      t += dt;
      const kmh = p.v * 3.6;
      if (!t100 && kmh >= 100) t100 = t;
      if (!t200 && kmh >= 200) t200 = t;
      if (!t300 && kmh >= 300) t300 = t;
    }
    // braking 100-0
    p.v = 100 / 3.6; let tb = 0;
    while (p.v > 0.3 && tb < 20) { p.stepLong(dt, 0, 1, null); tb += dt; }
    rows.push({
      car: CARS[id].name.split(' ').slice(1).join(' '),
      quoted: CARS[id].perf.vmax,
      vmax: Math.round(p.v * 3.6) && 0,
      t100: t100 && +t100.toFixed(2), t200: t200 && +t200.toFixed(2), t300: t300 && +t300.toFixed(2),
      brake100_0: +tb.toFixed(2),
    });
    // top speed after 90 s
    const q = new Player(id, 0x888888); q.s = 14000; q.v = 60;
    for (let i = 0; i < 200 * 240; i++) q.stepLong(dt, 1, 0, null);
    rows[rows.length - 1].vmax = Math.round(q.v * 3.6);
  }
  return rows;
});
console.table(out);
await browser.close();
