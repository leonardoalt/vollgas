/* Handbrake feel, traffic clearing during a stop, and hitting a parked van. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/p2.png';
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

/* ---- 1. handbrake vs footbrake from 200 km/h ---- */
const brakes = await page.evaluate(async () => {
  const { Vehicle, derive } = await import('/src/vehicles.js');
  const { CARS } = await import('/src/carFactory.js');
  const spec = CARS.turbo, dt = 1 / 200;
  const rig = () => {
    const o = Object.create(Vehicle.prototype);
    o.spec = spec; o.perf = spec.perf; o.d = derive(spec.perf);
    o.s = 14000; o.v = 200 / 3.6; o.gear = 5; o.rpm = 4000; o.shiftT = 0;
    o.offroad = false; o.dir = 1; o.aLong = 0; o.brake = 0; o.hand = 0;
    return o;
  };
  const timeTo = (hand, brake, target) => {
    const o = rig(); o.hand = hand;
    let t = 0, peak = 0;
    while (o.v * 3.6 > target && t < 40) {
      o.stepLong(dt, 0, brake, null); t += dt;
      peak = Math.max(peak, -o.aLong);
    }
    return { secs: +t.toFixed(2), peakG: +(peak / 9.81).toFixed(2) };
  };
  return {
    handbrakeOnly: timeTo(1, 0, 5),
    footbrake: timeTo(0, 1, 5),
    coasting: timeTo(0, 0, 5),
  };
});
console.log('from 200 km/h to 5:', JSON.stringify(brakes));
console.log('  handbrake strong but not instant:',
  brakes.handbrakeOnly.secs > 3 && brakes.handbrakeOnly.secs < 14 ? 'PASS' : 'FAIL');
console.log('  footbrake still much stronger   :',
  brakes.footbrake.secs < brakes.handbrakeOnly.secs * 0.55 ? 'PASS' : 'FAIL');

/* ---- 2. traffic clears the shoulder for a stop ---- */
const clear = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { LANES, GEO } = await import('/src/track.js');
  const { COP_STATE } = await import('/src/police.js');
  const p = g.player;
  p.s = 21400; p.u = LANES[0]; p.v = 58;
  // deliberately park traffic in the space we are about to need
  g.traffic.same.forEach((tc, i) => {
    tc.s = p.s + (i - 3) * 9; tc.u = GEO.kerbOut + 1.0; tc.lane = 1; tc.v = 40;
  });
  const z = g.enf.cops[0];
  z.s = p.s - 26; z.u = p.u; z.v = p.v; z.state = COP_STATE.PURSUE;
  z.setLights(true); z.pursueClose = 9;
  let worstInTheWay = 0, hits = 0;
  const shoulderU = GEO.kerbOut;
  for (let i = 0; i < 40 * 40; i++) {
    g.step(1 / 40);
    if (p.stoppedT > 0) {
      const near = g.traffic.same.filter(tc =>
        Math.abs(tc.s - p.s) < 14 && tc.u > shoulderU - 0.5).length;
      worstInTheWay = Math.max(worstInTheWay, near);
    }
    if (g.state !== 'race') break;
  }
  return { worstInTheWay, damage: Math.round(p.damage), playerU: +p.u.toFixed(1), state: g.state };
});
console.log('pull-over with traffic on the shoulder:', JSON.stringify(clear));
console.log('  nothing left in the way        :', clear.worstInTheWay === 0 ? 'PASS' : 'FAIL');

/* ---- 3. hitting a parked measuring van ---- */
const van = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { GEO } = await import('/src/track.js');
  const p = g.player;
  const cam = g.enf.cameras[0];
  p.s = cam.s - 140; p.u = cam.u; p.v = 55;      // aimed straight at it
  let card = null, hitAt = null;
  for (let i = 0; i < 40 * 40; i++) {
    g.input.update = () => Object.assign(g.input, { throttle: 0.5, brake: 0, steer: 0, handbrake: false });
    g.step(1 / 40);
    if (hitAt === null && g.ending) hitAt = g.ending.kind;
    if (document.getElementById('busted').classList.contains('on') && !card) {
      card = document.querySelector('#busted h2').textContent;
    }
    if (g.state !== 'race') break;
  }
  delete g.input.update;
  return { endingKind: hitAt, card, state: g.state, dnf: g.results && g.results.dnf,
           fines: g.player.fines, points: g.player.points, tickets: g.player.tickets.length };
});
console.log('driving into a parked van:', JSON.stringify(van));
console.log('  run ends with its own card     :',
  van.endingKind === 'rammed' && van.state === 'results' && !!van.card ? 'PASS' : 'FAIL');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: out });
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
