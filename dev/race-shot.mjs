import puppeteer from 'puppeteer-core';
const [url, out, kmTarget, cam] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1280,760', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[err] ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await page.evaluate(async (km, camMode) => {
  const g = window.__game;
  g.startRace();
  g.camMode = Number(camMode) || 0;
  const jump = Number(new URLSearchParams(location.search).get('jump') || 0);
  const { LANES, limitAt, sample, sectionAt } = await import('/src/track.js');
  const dt = 1 / 40;
  if (Number(km) > 3) {
    // teleport most of the way, then drive the last stretch for real
    const { LANES } = await import('/src/track.js');
    g.player.s = Math.max(60, (Number(km) - 0.6) * 1000);
    g.player.u = LANES[0]; g.player.v = 55;
    g.countdown = 0;
    g.traffic.same.forEach(t => { t.s = g.player.s + 120 + Math.random() * 1400; });
    g.traffic.opp.forEach(t => { t.s = g.player.s + 200 + Math.random() * 1600; });
    g.traffic.rivals.forEach((r, i) => { r.s = g.player.s + 40 + i * 60; });
    g.enf.cops.forEach((z, i) => { z.s = g.player.s + 700 + i * 900; });
  }
  const noDraw = { drawTacho: g.hud.drawTacho, drawRadar: g.hud.drawRadar };
  g.hud.drawTacho = () => {}; g.hud.drawRadar = () => {};
  for (let i = 0; i < 40 * 900; i++) {
    const p = g.player, tr = g.traffic;
    const gapOf = (lane) => { const a = tr.nearestAhead(p, lane); return a ? { gap: a.gap - p.halfLen - a.v.halfLen, v: a.v.v } : { gap: 9999, v: 999 }; };
    const L = gapOf(0), R = gapOf(1);
    let lane = p._apLane ?? 0;
    const cur = lane === 0 ? L : R, oth = lane === 0 ? R : L;
    if (cur.gap < 8 + p.v * 2.0 && oth.gap > cur.gap + 40) lane = 1 - lane;
    p._apLane = lane;
    const pick = lane === 0 ? L : R;
    let want = p.d.vmax * 0.95;
    if (sectionAt(p.s).works) want = Math.min(want, 26);
    let kMax = 0;
    for (let d = 25; d < 120 + p.v * 1.8; d += 25) kMax = Math.max(kMax, Math.abs(sample(p.s + d).curv));
    if (kMax > 1e-6) want = Math.min(want, Math.sqrt(p.d.aMax * 0.8 / kMax));
    if (pick.gap < 14 + p.v * 1.5) want = Math.min(want, pick.v * 0.93);
    let throttle = 0, brake = 0;
    if (p.v < want - 0.6) throttle = 1; else if (p.v > want + 0.6) brake = Math.min(1, (p.v - want) * 0.10); else throttle = 0.42;
    const err = LANES[lane] - p.u;
    g.input.update = () => Object.assign(g.input, { throttle, brake, steer: Math.max(-0.75, Math.min(0.75, err * 0.30 - p.psi * 2.2)), handbrake: false });
    g.step(dt);
    if (p.s / 1000 >= Number(km) || g.state !== 'race') break;
  }
  g.hud.drawTacho = noDraw.drawTacho; g.hud.drawRadar = noDraw.drawRadar;
  g.input.update = undefined;
  delete g.input.update;
}, kmTarget, cam);
// render a few real frames so the HUD canvases paint
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: out });
console.log('km', await page.evaluate(() => (window.__game.player.s / 1000).toFixed(2)),
            '| kmh', await page.evaluate(() => Math.round(window.__game.player.v * 3.6)),
            '|', errs.length ? errs.slice(0, 5).join(' ; ') : 'no errors');
await browser.close();
