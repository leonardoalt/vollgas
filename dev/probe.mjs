/* dev/probe.mjs <url> <expr> [out.png]
   Loads a page, waits for __ready, evaluates an expression and prints the JSON
   result. Handy for asking the live scene questions (section positions, pixel
   colours, material params) without adding debug code to src/.

   <expr> may be either a bare expression ("window.__game.state") or a statement
   body containing `return` / `await`, in which case it is run as an async IIFE
   ("const t = await import('/src/track.js'); return t.SECTIONS.length;"). */
import puppeteer from 'puppeteer-core';
const [url, expr, out] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push('[err] ' + m.text()); });
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
try { await page.waitForFunction('window.__ready === true', { timeout: 40000 }); } catch { errs.push('[timeout]'); }
await new Promise(r => setTimeout(r, 900));
// A statement body needs a function wrapper; a bare expression must not get one
// (`(async () => { window.foo })()` evaluates to undefined).
const body = /\breturn\b|;/.test(expr) ? expr : `return (${expr});`;
const res = await page.evaluate(`(async () => { ${body} })()`);
console.log(JSON.stringify(res, null, 1));
if (out) { await new Promise(r => setTimeout(r, 400)); await page.screenshot({ path: out }); }
if (errs.length) console.log(errs.slice(0, 10).join('\n'));
await browser.close();
