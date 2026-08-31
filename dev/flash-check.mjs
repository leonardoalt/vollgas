/* Freezes a frame while oncoming traffic is mid-Lichthupe, so the flash can be
   seen rather than inferred from a log line. */
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
  g.startRace(); g.countdown = 0;
  const { LANES } = await import('/src/track.js');
  const { FLASH_DUR } = await import('/src/vehicles.js');
  const p = g.player;
  p.s = 12000; p.u = LANES[0]; p.v = 62;
  // line a few oncoming cars up just ahead on the far carriageway
  g.traffic.opp.forEach((o, i) => {
    o.s = p.s + 55 + i * 26; o.u = -(i % 2 ? 8.125 : 4.375); o.v = 40; o.isTruck = false;
  });
  // trigger the warning burst
  g.enf._warnT = 0;
  g.enf.cameras[0].s = p.s + 700; g.enf.cameras[0].warned = false;
  /* There is deliberately no HUD message for a Lichthupe — the headlights are
     the warning. So observe the event queue as step() drains it. */
  let fired = 0, litFrames = 0, maxOpacity = 0;
  const drain = g.enf.drainEvents.bind(g.enf);
  g.enf.drainEvents = () => {
    const evs = drain();
    for (const e of evs) if (e.type === 'lichthupe') fired++;
    return evs;
  };
  for (let i = 0; i < 400; i++) {
    g.step(1 / 60);
    const lit = g.traffic.opp.filter(o => o.flashOn);
    if (lit.length && fired > 0) {
      litFrames++;
      for (const o of lit) for (const sp of o.mesh.userData.glows || []) maxOpacity = Math.max(maxOpacity, sp.material.opacity);
      // freeze here so the screenshot catches the pulse
      if (litFrames > 2) { g.state = 'frozen'; break; }
    }
  }
  const flashing = g.traffic.opp.filter(o => o.flashOn);
  return {
    fired, litFrames, maxOpacity: +maxOpacity.toFixed(2),
    flashingNow: flashing.length,
    headEmissive: flashing.length ? flashing[0].mesh.userData.headMat.emissiveIntensity : null,
    glowsVisible: flashing.length ? (flashing[0].mesh.userData.glows || []).filter(s => s.visible).length : 0,
    flashDur: FLASH_DUR,
    warnAlerts: document.querySelectorAll('#hud-alerts .alert').length
      && [...document.querySelectorAll('#hud-alerts .alert')]
           .filter(e => /LICHTHUPE|FLASHING/i.test(e.textContent)).length || 0,
  };
});
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: out });
console.log(JSON.stringify(info));
console.log('lichthupe fired:', info.fired > 0 ? 'YES' : 'NO',
            '| pulses seen:', info.litFrames > 0 ? 'YES' : 'NO',
            '| glow opacity:', info.maxOpacity,
            '| no HUD message:', info.warnAlerts === 0 ? 'PASS' : 'FAIL');
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
