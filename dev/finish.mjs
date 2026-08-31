import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
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
const info = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace();
  const { LENGTH, LANES } = await import('/src/track.js');
  const { penaltyFor } = await import('/src/police.js');
  const p = g.player;
  g.countdown = 0;
  g.raceTime = 431.7;
  p.vmaxSeen = 318;
  // a plausible sheet of offences collected along the way
  for (const [where, lim, kmh] of [
    ['Blitzer · Stuttgart-Zuffenhausen', 100, 148],
    ['ProViDa · Horb am Neckar', 120, 197],
    ['Blitzer · Empfingen', 80, 121],
  ]) {
    const pen = penaltyFor(kmh - lim);
    p.fines += pen.fine; p.points += pen.points;
    p.tickets.push({ where, limit: lim, speed: kmh, excess: pen.excess, fine: pen.fine, points: pen.points, ban: pen.ban });
  }
  // give the rivals sensible progress, then run the player over the line
  g.traffic.rivals.forEach((r, i) => { r.s = LENGTH - 400 - i * 900; r.v = 70; r.fines = i * 40; });
  p.s = LENGTH - 260; p.u = LANES[0]; p.v = 82;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 20; i++) {
    g.input.update = () => Object.assign(g.input, { throttle: 1, brake: 0, steer: (LANES[0] - p.u) * 0.25 - p.psi * 2, handbrake: false });
    g.step(dt);
    if (g.state !== 'race') break;
  }
  delete g.input.update;
  return { state: g.state, place: g.results && g.results.place, time: +g.raceTime.toFixed(1), fines: p.fines, points: p.points };
});
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: out });
console.log(JSON.stringify(info), errs.length ? errs.slice(0, 5).join(' ; ') : 'no errors');
await browser.close();
