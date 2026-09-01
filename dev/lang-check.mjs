/* Screenshots the menu and an in-race frame in both languages, and reports any
   element still showing an untranslated string. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || '/tmp';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1280,760', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
for (const want of ['de', 'en']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[err] ' + m.text()); });
  await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('a81.lang', l); } catch {} }, want);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.waitForFunction('window.__ready === true', { timeout: 90000 });
  const menu = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.querySelector('.menu-title p').textContent.slice(0, 60),
    start: document.getElementById('start-btn').textContent,
    choose: document.querySelector('.menu-label').textContent,
    tutorialHint: document.querySelector('#tutorial-entry span').textContent,
    credits: document.getElementById('credits-btn').textContent,
    detail: document.getElementById('car-detail-sub').textContent,
    stat: document.querySelector('#car-stats .sl').textContent,
    langBtn: document.getElementById('lang-btn').textContent,
    briefingRemoved: !document.getElementById('briefing'),
    photoTabsRemoved: !document.querySelector('.car-hero-tabs'),
    untranslated: [...document.querySelectorAll('[data-i18n],[data-i18n-html]')]
      .filter(e => !e.textContent.trim()).map(e => e.getAttribute('data-i18n') || e.getAttribute('data-i18n-html')),
  }));
  await page.screenshot({ path: `${outDir}/lang-${want}-menu.png` });
  await page.click('#start-btn');
  await page.keyboard.down('w');
  await new Promise(r => setTimeout(r, 4000));
  await page.keyboard.up('w');
  const hud = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#hud-race .lbl, #hud-legal .lbl')].map(e => e.textContent),
    /* Defensive lookups: these ids have drifted out of index.html over time and
       a hard reference made the whole language check throw before it printed
       anything. A missing panel should read as null, not crash the harness. */
    rear: (document.getElementById('hud-rear-title') || {}).textContent ?? null,
    sub: (document.getElementById('hud-section-sub') || {}).textContent ?? null,
  }));
  await page.screenshot({ path: `${outDir}/lang-${want}-race.png` });
  console.log(`\n=== ${want} ===`);
  console.log(JSON.stringify(menu, null, 1));
  console.log('hud:', JSON.stringify(hud));
  console.log(errs.length ? errs.slice(0, 5).join('\n') : 'no console errors');
  await page.close();
}
await browser.close();
