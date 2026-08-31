/* Report every failed request and console message for a page. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const b = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1280,760'],
});
const p = await b.newPage();
p.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
p.on('requestfailed', r => console.log('FAIL', r.failure().errorText, r.url()));
p.on('console', m => console.log(m.type().toUpperCase(), m.text().slice(0, 400)));
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 600)));
await p.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
await b.close();
