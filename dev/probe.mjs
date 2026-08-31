/* Evaluate an arbitrary expression in a bench page once it is ready. */
import puppeteer from 'puppeteer-core';
const [url, expr] = process.argv.slice(2);
const b = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1280,760'],
});
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
try { await p.waitForFunction('window.__ready === true', { timeout: 40000 }); } catch {}
await new Promise(r => setTimeout(r, 400));
console.log(JSON.stringify(await p.evaluate(expr), null, 1));
await b.close();
