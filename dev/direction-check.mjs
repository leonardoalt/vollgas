/* Regression check for the coordinate conventions shared by track, physics,
   and wheel rendering. These signs are easy to make internally consistent but
   visually backwards, so exercise the real game objects in Chromium. */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
         '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

const result = await page.evaluate(async () => {
  const g = window.__game;
  const { LANES, entryRamp, sample } = await import('/src/track.js');
  const { laneAssist } = await import('/src/vehicles.js');

  g.startRace();
  g.countdown = 0;
  const p = g.player;
  p.s = 8000; p.u = LANES[0]; p.v = 40;
  p.psi = 0; p.vy = 0; p.r = 0; p.offroad = false;
  p.fxF = 0; p.fxR = 0; p._align = 0;
  p.rack.reset();

  const front = p.mesh.userData.wheels.filter(w => w.userData.front);
  const spin0 = front.map(w => w.userData.spin.rotation.x);
  for (let i = 0; i < 30; i++) {
    p.control(1 / 60, { throttle: 0.4, brake: 0, steer: 1, handbrake: false }, null);
  }
  p.sync(1 / 60);

  const wheel = {
    physicsRight: p.steerAngle > 0,
    rendersRight: front.every(w => w.rotation.y < 0),
    rollsForward: front.every((w, i) => w.userData.spin.rotation.x > spin0[i]),
  };

  /* At zero lane error the feed-forward must steer into the bend. Track
     curvature is left-positive; steering demand is right-positive. */
  p.psi = 0; p.vy = 0;
  const curvature = sample(p.s).curv;
  const assist = laneAssist(p, p.u);
  const curve = { curvature, assist, steersIntoBend: curvature * assist < 0 };

  /* The countdown may move left because the slip road itself merges left,
     but it must leave the car on that road rather than with a stuck command. */
  g.startRace();
  for (let i = 0; i < 240; i++) g.step(1 / 60);
  const ramp = entryRamp(g.player.s);
  const start = {
    laneError: ramp ? g.player.u - ramp.centre : Infinity,
    rack: g.player.rack.pos,
    onRamp: !!ramp && Math.abs(g.player.u - ramp.centre) < 0.2,
  };

  return { wheel, curve, start };
});

await browser.close();
const ok = !errors.length
  && Object.values(result.wheel).every(Boolean)
  && result.curve.steersIntoBend
  && result.start.onRamp;
console.log(JSON.stringify({ ...result, errors }, null, 2));
if (!ok) process.exitCode = 1;
