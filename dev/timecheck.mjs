import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const b = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1280,760'],
});
const p = await b.newPage();
p.on('console', m => console.log(m.type(), m.text()));
const t0 = Date.now();
await p.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
try { await p.waitForFunction('window.__ready === true', { timeout: 90000 }); } catch {}
console.log('ready', Date.now() - t0);
await new Promise(r => setTimeout(r, 800));
await b.close();
