import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5188/';
const outDir = process.argv[3] || '/tmp';
const seconds = Number(process.argv[4] || 60);
const LAWFUL = process.argv[5] === 'lawful';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errs = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error') errs.push('[err] ' + t); });
page.on('pageerror', e => errs.push('[pageerror] ' + e.message + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

// Drive with a simulated clock so we cover ground fast regardless of render rate.
await page.evaluate(async () => {
  const g = window.__game;
  const { LANES } = await import('/src/track.js');
  const { sample, limitAt, sectionAt } = await import('/src/track.js');
  g.startRace();
  window.__log = [];
  window.__events = [];
  // the canvas cluster is pure output; skip it so the harness runs fast
  g.hud.drawTacho = () => {}; g.hud.drawRadar = () => {};
  const origAlert = g.hud.alert.bind(g.hud);
  g.hud.alert = (t, sub, kind, ttl) => { window.__events.push(t + (sub ? ' — ' + sub : '')); return origAlert(t, sub, kind, ttl); };

  /* A crude autopilot so the harness can actually complete 42 km:
     pick the roomier lane, back off for traffic and for corners, and
     optionally respect the posted limit. */
  function autopilot(lawful) {
    const p = g.player, tr = g.traffic;
    const gapOf = (lane) => { const a = tr.nearestAhead(p, lane); return a ? { gap: a.gap - p.halfLen - a.v.halfLen, v: a.v.v } : { gap: 9999, v: 999 }; };
    const L = gapOf(0), R = gapOf(1);
    let lane = p._apLane ?? 0;
    const cur = lane === 0 ? L : R;
    const oth = lane === 0 ? R : L;
    if (cur.gap < 5 + p.v * 2.2 && oth.gap > cur.gap + 45) lane = 1 - lane;
    p._apLane = lane;
    const pick = lane === 0 ? L : R;

    let want = p.d.vmax * 0.95;
    if (lawful) { const lim = limitAt(p.s); if (lim !== Infinity) want = Math.min(want, lim / 3.6 * 0.99); }
    if (sectionAt(p.s).works) want = Math.min(want, 24);
    let kMax = 0;
    for (let d = 25; d < 110 + p.v * 1.8; d += 25) kMax = Math.max(kMax, Math.abs(sample(p.s + d).curv));
    if (kMax > 1e-6) want = Math.min(want, Math.sqrt(p.d.aMax * 0.82 / kMax));
    const safe = 12 + p.v * 1.5;
    if (pick.gap < safe) want = Math.min(want, pick.v * 0.94);

    let throttle = 0, brake = 0;
    if (p.v < want - 0.6) throttle = 1;
    else if (p.v > want + 0.6) brake = Math.min(1, (p.v - want) * 0.10);
    else throttle = 0.42;
    const err = LANES[lane] - p.u;
    const steer = Math.max(-0.75, Math.min(0.75, err * 0.30 - p.psi * 2.2));
    return { throttle, brake, steer, handbrake: false };
  }

  window.__drive = (secs, opts) => {
    const dt = 1 / 40;
    for (let i = 0; i < secs * 40; i++) {
      const c = autopilot(!!opts.lawful);
      g.input.update = () => Object.assign(g.input, c);
      g.step(dt);
      if (i % 400 === 0) {
        const p = g.player, cop = g.enf.activeCop;
        window.__log.push({
          t: +g.raceTime.toFixed(1), km: +(p.s / 1000).toFixed(2),
          kmh: Math.round(p.v * 3.6), lim: limitAt(p.s) === Infinity ? '-' : limitAt(p.s),
          u: +p.u.toFixed(1), gear: p.gear, dmg: Math.round(p.damage),
          eur: p.fines, pts: p.points,
          cop: cop ? cop.state + ':' + cop.measure.toFixed(2) : '',
        });
      }
      if (g.state !== 'race') break;
    }
    return g.state;
  };
});

const shots = [];
let elapsed = 0;
const CHUNK = 30;
while (elapsed < seconds) {
  const st = await page.evaluate((c, law) => window.__drive(c, { lawful: law }), CHUNK, LAWFUL);
  elapsed += CHUNK;
  await new Promise(r => setTimeout(r, 250));
  const f = `${outDir}/drive-${String(elapsed).padStart(3,'0')}s.png`;
  await page.screenshot({ path: f });
  shots.push(f);
  if (st !== 'race') break;
}
const log = await page.evaluate(() => window.__log);
const evs = await page.evaluate(() => window.__events);
console.log(JSON.stringify(log, null, 0).replace(/\},/g, '},\n'));
console.log('--- events ---');
console.log([...new Set(evs)].join('\n'));
console.log('--- final state:', await page.evaluate(() => window.__game.state), '| shots:', shots.length);
console.log(errs.length ? errs.slice(0, 12).join('\n') : 'no console errors');
await browser.close();
