/* Continuous collision and police stand-off regression checks. */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:5210/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

const report = await page.evaluate(async () => {
  const g = window.__game;
  const { footprintExtents, resolveCollisions } = await import('/src/vehicles.js');
  const { GEO, LANES, LENGTH, outerBarrier, toWorld } = await import('/src/track.js');

  // ---- full yawed body stays between both guardrail faces
  g.startRace(); g.countdown = 0;
  const p = g.player;
  p.s = 12000; p.v = 62;
  p.u = outerBarrier(p.s) - 0.25; p.psi = 0.58;
  p.stepLat(0.05, 0.8, g.traffic);
  const outerBody = footprintExtents(p);
  const outerClearance = outerBarrier(p.s) - 0.16 - (Math.abs(p.u) + outerBody.lateral);

  p.u = 1.9; p.psi = -0.58; p.v = 62;
  p.stepLat(0.05, -0.8, g.traffic);
  const innerBody = footprintExtents(p);
  const innerClearance = Math.abs(p.u) - innerBody.lateral - (1.62 + 0.16);

  // ---- a whole-frame leap through a lorry is caught and rewound to contact
  const truck = g.traffic._make('truck', 1);
  p.stoppedT = 0; p.dir = 1; p.psi = 0; p.u = LANES[1]; p.v = 80;
  p._prevS = 1000; p._prevU = p.u; p.s = 1024;
  truck.s = 1012; truck._prevS = 1012; truck.u = LANES[1]; truck._prevU = truck.u;
  truck.psi = 0; truck.v = 20; truck.active = true;
  let hits = 0;
  resolveCollisions(p, [truck], () => { hits++; }, 0.05);
  const pe = footprintExtents(p), te = footprintExtents(truck);
  const truckClearance = truck.s - p.s - pe.longitudinal - te.longitudinal;
  const truckWorld = toWorld(truck.s, truck.u);
  const truckMeshError = Math.hypot(truck.mesh.position.x - truckWorld.x, truck.mesh.position.z - truckWorld.z);
  const truckPlayerV = p.v, truckV = truck.v;

  // ---- ordinary cars already overlapping at an angle separate laterally
  const car = g.traffic._make('hatch', 1);
  p.s = 1300; p._prevS = p.s; p.u = LANES[0]; p._prevU = p.u; p.psi = 0.12; p.v = 42;
  car.s = 1300.5; car._prevS = car.s; car.u = p.u + 1.3; car._prevU = car.u;
  car.psi = -0.08; car.v = 35; car.active = true;
  let carHits = 0;
  resolveCollisions(p, [car], () => { carHits++; }, 0.016);
  const pce = footprintExtents(p), ce = footprintExtents(car);
  const carClearance = Math.abs(car.u - p.u) - pce.lateral - ce.lateral;

  // ---- traffic recycling is a teleport, never a path through the player
  const recycled = g.traffic._make('hatch', 1);
  p.s = 5000; p._prevS = p.s; p.u = LANES[1]; p._prevU = p.u; p.psi = 0; p.v = 70;
  recycled.s = p.s + 800; recycled.u = p.u; recycled.v = 35;
  recycled._prevS = p.s - 300; recycled._prevU = p.u; recycled.active = true;
  let recycleHits = 0;
  resolveCollisions(p, [recycled], () => { recycleHits++; }, 0.05);

  // ---- no recycler may be clamped into the short piece of road at the finish
  g.traffic._placeSame(recycled, LENGTH - 100, false);
  const finishRecycle = { active: recycled.active, visible: recycled.mesh.visible };

  // ---- ordinary traffic must see and follow the player, not drive through it
  const follower = g.traffic._make('hatch', 1);
  follower.s = 7000; follower.u = LANES[1]; follower.v = 38;
  p.s = follower.s + 35; p.u = LANES[1]; p.v = 22; p.active = true;
  g.traffic.player = p;
  const playerAhead = g.traffic.nearestAhead(follower, 1)?.v === p;

  // ---- a forced criminal stop may select a cop ahead; it must be staged behind
  g.startRace(); g.countdown = 0;
  const stopped = g.player;
  stopped.s = 21500; stopped.u = LANES[0]; stopped.v = 58;
  g.enf.cops.forEach((z, i) => {
    z.s = stopped.s + 12 + i * 20; z.u = LANES[i % 2]; z.v = 45;
  });
  g.enf.forceStop(stopped);
  const aheadStagedGap = stopped.s - g.enf.activeCop.s;

  // A cop that starts far behind must also be staged close enough to complete
  // the stop before the ending card, then remain clear throughout the maneuver.
  g.startRace(); g.countdown = 0;
  const stoppedFar = g.player;
  stoppedFar.s = 21500; stoppedFar.u = LANES[0]; stoppedFar.v = 58;
  g.enf.cops.forEach((z, i) => {
    z.s = stoppedFar.s - 149 - i * 20; z.u = LANES[i % 2]; z.v = 45;
  });
  g.beginEnding('racing');
  const cop = g.enf.activeCop;
  const requiredGap = stoppedFar.halfLen + cop.halfLen + 1.5;
  const summonedGap = stoppedFar.s - cop.s;
  let minGap = summonedGap, minClearance = summonedGap - stoppedFar.halfLen - cop.halfLen;
  for (let i = 0; i < 40 * 18 && g.state === 'race'; i++) {
    g.step(1 / 40);
    const gap = stoppedFar.s - cop.s;
    minGap = Math.min(minGap, gap);
    minClearance = Math.min(minClearance, gap - stoppedFar.halfLen - cop.halfLen);
    if (stoppedFar.v === 0 && cop.v === 0) break;
  }

  return {
    barriers: { outerClearance, innerClearance },
    sweptTruck: { hits, clearance: truckClearance, playerV: truckPlayerV, truckV, meshError: truckMeshError },
    car: { hits: carHits, clearance: carClearance },
    recycle: { hits: recycleHits, playerV: p.v, finishRecycle, playerAhead },
    police: {
      requiredGap, aheadStagedGap, summonedGap, minGap, minClearance,
      playerV: stoppedFar.v, copV: cop.v, playerU: stoppedFar.u, copU: cop.u,
    },
  };
});

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};
check('yawed body stays inside outer guardrail', report.barriers.outerClearance >= 0.075,
  `clearance=${report.barriers.outerClearance.toFixed(3)}m`);
check('yawed body stays outside median guardrail', report.barriers.innerClearance >= 0.075,
  `clearance=${report.barriers.innerClearance.toFixed(3)}m`);
check('swept collision catches a frame-step through a truck', report.sweptTruck.hits === 1,
  JSON.stringify(report.sweptTruck));
check('truck and player finish separated', report.sweptTruck.clearance >= 0.05,
  `clearance=${report.sweptTruck.clearance.toFixed(3)}m`);
check('heavy truck barely moves in the impact', report.sweptTruck.truckV < 24,
  `truck=${report.sweptTruck.truckV.toFixed(2)}m/s player=${report.sweptTruck.playerV.toFixed(2)}m/s`);
check('other vehicle transform is corrected in the collision frame', report.sweptTruck.meshError < 0.01,
  `mesh error=${report.sweptTruck.meshError.toFixed(4)}m`);
check('angled car-to-car overlap is fully separated', report.car.hits === 1 && report.car.clearance >= 0.05,
  JSON.stringify(report.car));
check('traffic recycle cannot create a phantom swept impact',
  report.recycle.hits === 0, JSON.stringify(report.recycle));
check('traffic retires instead of spawning on top of the finish',
  !report.recycle.finishRecycle.active && !report.recycle.finishRecycle.visible,
  JSON.stringify(report.recycle.finishRecycle));
check('traffic following includes the player', report.recycle.playerAhead,
  JSON.stringify(report.recycle));
check('police ahead is staged safely behind', report.police.aheadStagedGap >= report.police.requiredGap,
  `gap=${report.police.aheadStagedGap.toFixed(2)} required=${report.police.requiredGap.toFixed(2)}`);
check('police far behind is staged close enough to finish the stop',
  report.police.summonedGap >= report.police.requiredGap && report.police.summonedGap <= 40,
  `gap=${report.police.summonedGap.toFixed(2)}`);
check('police never enters the player while stopping', report.police.minClearance >= 1.49,
  `minimum air gap=${report.police.minClearance.toFixed(3)}m`);
check('page has no errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(failures ? 1 : 0);
