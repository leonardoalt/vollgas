/* Lichthupe. Verifies that oncoming drivers actually flash (bright, pulsing,
   with glow), that they keep it up until the player is past them, that they
   stop afterwards, and that there is no HUD message spelling it out. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/flash.png';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
         '--window-size=1280,760','--hide-scrollbars','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

const info = await page.evaluate(async () => {
  const g = window.__game;
  const { FLASH_DUR } = await import('/src/vehicles.js');
  const setup = () => {
    g.startRace(); g.countdown = 0;
    const p = g.player;
    p.s = 12000; p.u = 4.375; p.v = 62;
    g.traffic.opp.forEach((o, i) => {
      o.s = p.s + 90 + i * 24; o.u = -(i % 2 ? 8.125 : 4.375); o.v = 40;
      o.warnFlash = false; o.flashHold = 0;
    });
    g.enf.cameras.forEach(c => { c.warned = true; });
    g.enf.cameras[0].s = p.s + 800; g.enf.cameras[0].warned = false;
    g.enf._warnT = 0;
  };

  // --- 1. does it fire, and does it look like anything?
  setup();

  /* There is deliberately no HUD message for a Lichthupe, so watch the event
     queue as step() drains it. Hook after setup(), which is what creates enf. */
  let fired = 0;
  const drain = g.enf.drainEvents.bind(g.enf);
  g.enf.drainEvents = () => {
    const evs = drain();
    for (const e of evs) if (e.type === 'lichthupe') fired++;
    return evs;
  };
  let litFrames = 0, maxOpacity = 0, headEmissive = 0;
  for (let i = 0; i < 60 * 6 && !fired; i++) g.step(1 / 60);
  // the furthest warner has the longest approach left: the honest subject
  const warner = g.traffic.opp.filter(o => o.warnFlash).sort((a, b) => b.s - a.s)[0] || null;
  const warners = g.traffic.opp.filter(o => o.warnFlash).length;

  // --- 2. persistence: keep going until they stop, and note where we were
  let persistT = 0, stoppedAt = null;
  if (warner) {
    for (let i = 0; i < 60 * 40; i++) {
      g.step(1 / 60);
      if (warner.flashOn) {
        litFrames++;
        for (const sp of warner.mesh.userData.glows || []) maxOpacity = Math.max(maxOpacity, sp.material.opacity);
        headEmissive = Math.max(headEmissive, warner.mesh.userData.headMat.emissiveIntensity);
      }
      if (warner.warnFlash) persistT += 1 / 60;
      else { stoppedAt = +(g.player.s - warner.s).toFixed(1); break; }
    }
  }
  const warnMsgs = [...document.querySelectorAll('#hud-alerts .alert')]
    .filter(e => /LICHTHUPE|FLASHING/i.test(e.textContent)).length;

  // --- 3. set a fresh flash up and freeze it for the screenshot
  setup();
  for (let i = 0; i < 60 * 6; i++) {
    g.step(1 / 60);
    if (g.traffic.opp.some(o => o.flashOn)) { g.state = 'frozen'; break; }
  }
  return {
    fired, warners, persistSeconds: +persistT.toFixed(2), stoppedAtRelativeS: stoppedAt,
    litFrames, maxOpacity: +maxOpacity.toFixed(2), headEmissive, warnMsgs, flashDur: FLASH_DUR,
  };
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: out });
console.log(JSON.stringify(info));
const pass = (b) => b ? 'PASS' : 'FAIL';
console.log('  warning fires                :', pass(info.fired > 0), `(${info.warners} drivers)`);
console.log('  flash is bright and pulsing  :', pass(info.litFrames > 3 && info.maxOpacity > 0.9 && info.headEmissive > 8));
console.log('  keeps flashing until passed  :', pass(info.persistSeconds > 2), `(${info.persistSeconds}s)`);
console.log('  stops once past              :', pass(info.stoppedAtRelativeS !== null && info.stoppedAtRelativeS > -8), `(at ${info.stoppedAtRelativeS} m)`);
console.log('  no HUD message               :', pass(info.warnMsgs === 0));
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
