/* Verifies the compact front-page hierarchy at representative viewport sizes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = process.argv[3] || '/tmp';
await fs.mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--hide-scrollbars'],
});

for (const view of [
  { name: 'desktop', width: 1280, height: 760 },
  { name: 'mobile', width: 430, height: 860 },
  { name: 'short', width: 1024, height: 640 },
]) {
  const page = await browser.newPage();
  await page.setViewport({ width: view.width, height: view.height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument(() => localStorage.setItem('a81.lang', 'de'));
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.waitForFunction('window.__ready === true', { timeout: 90000 });

  const state = await page.evaluate(() => {
    const start = document.getElementById('start-btn').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.car-card')];
    return {
      briefing: !!document.getElementById('briefing'),
      photoControls: !!document.querySelector('.car-hero-tabs,.car-hero-img'),
      cards: cards.length,
      selected: cards.filter(x => x.getAttribute('aria-pressed') === 'true').length,
      startVisible: start.top >= 0 && start.bottom <= innerHeight,
      horizontalOverflow: document.querySelector('.menu-inner').scrollWidth
        > document.querySelector('.menu-inner').clientWidth + 1,
    };
  });
  assert.deepEqual(errors, []);
  assert.equal(state.briefing, false);
  assert.equal(state.photoControls, false);
  assert.equal(state.cards, 4);
  assert.equal(state.selected, 1);
  assert.equal(state.startVisible, true);
  assert.equal(state.horizontalOverflow, false);

  await page.click('.car-card:nth-child(2)');
  assert.equal(await page.$eval('.car-card:nth-child(2)', e => e.getAttribute('aria-pressed')), 'true');

  if (view.name === 'desktop') {
    await page.click('#credits-btn');
    assert.equal(await page.$eval('#credits-dialog', e => e.open), true);
    assert.ok(await page.$$eval('#credits-content a', links => links.length) >= 8);
    await page.click('#credits-close');
  }
  await page.screenshot({ path: `${outDir}/menu-${view.name}.png` });
  await page.close();
}

console.log('menu layout: ok');
await browser.close();
