/* Walks the deterministic tutorial sequence and screenshots every callout.
   The long driving stretches are advanced by moving the player to the trigger
   point; physics and enforcement themselves remain live in the browser. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = process.argv[3] || '/tmp';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await page.click('#tutorial-btn');

const expectStage = async (stage, shot) => {
  const actual = await page.evaluate(() => window.__game.tutorial?.stage);
  assert.equal(actual, stage);
  await page.screenshot({ path: `${outDir}/tutorial-${shot}.png` });
};
const next = () => page.evaluate(() => window.__game.tutorial.advance());

await expectStage('intro', '01-mission');
await next();
assert.match(await page.$eval('#tutorial-title', e => e.textContent), /Regeln|law/i);
await page.screenshot({ path: `${outDir}/tutorial-02-law.png` });
await next();
await page.evaluate(() => window.__game.tutorial.update(4));
await expectStage('limit', '03-limit');
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.player.s = g.enf.tutorialCamera.s - 430;
  g._camPos.set(0, 0, 0); g._camLook.set(0, 0, 0);
  g.enf._warnT = 0;
  g.step(0.05);
  g.step(0.05);
});
await expectStage('flash', '04-headlights');
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.player.s = g.enf.tutorialCamera.s - 78;
  g._camPos.set(0, 0, 0); g._camLook.set(0, 0, 0);
  g.step(0.05);
});
await expectStage('camera', '05-camera');
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.player.s = g.enf.tutorialCamera.s + 40;
  g.player.v = 35;
  g._camPos.set(0, 0, 0); g._camLook.set(0, 0, 0);
  g.step(0.05);
});
await expectStage('camera-result', '05b-flashed');
assert.equal(await page.evaluate(() => window.__game.tutorial.target?.element?.isConnected), true);
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.player.s = g.tutorial.route.providaS + 5;
  g._camPos.set(0, 0, 0); g._camLook.set(0, 0, 0);
  g.step(0.05);
  g.step(0.05);
});
await expectStage('measure', '06-provida');
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.enf.dismissTutorialCop();
  g.enf.events.push({ type: 'measure-abort' });
  g.handleEvents();
  g.tutorial.update(0.05);
});
await expectStage('provida-result', '06b-resolved');
assert.equal(await page.evaluate(() => window.__game.tutorial.target?.element?.isConnected), true);
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.player.s = g.tutorial.route.freeSignS - 82;
  g._camPos.set(0, 0, 0); g._camLook.set(0, 0, 0);
  g.step(0.05);
});
await expectStage('free', '07-unrestricted');
assert.equal(await page.evaluate(() => {
  const g = window.__game;
  return g.tutorial.route.freeSignS > g.player.s && g.hud._lastLimit === '80|false';
}), true);
await next();
await page.evaluate(() => {
  const g = window.__game;
  g.player.s += 430;
  g.tutorial.update(0.1);
});
await expectStage('complete', '08-complete');

assert.deepEqual(errors, []);
console.log('tutorial flow: ok');
await browser.close();
