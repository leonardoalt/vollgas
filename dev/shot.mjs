import puppeteer from 'puppeteer-core';
const [url, out, ...rest] = process.argv.slice(2);
const cam = rest.length ? rest.map(Number) : null;
const bench = process.env.BENCH ? process.env.BENCH.split(',') : null;
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
const errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('[' + m.type() + '] ' + m.text()); });
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
if (bench) await page.evaluateOnNewDocument(b => { window.__BENCH__ = b; }, bench);
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
try { await page.waitForFunction('window.__ready === true', { timeout: 40000 }); } catch { errs.push('[timeout] __ready never set'); }
if (cam) await page.evaluate(c => window.__setCam(...c), cam);
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: out });
console.log(errs.length ? errs.slice(0, 30).join('\n') : 'no console errors');
await browser.close();
