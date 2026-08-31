/* Drivetrain figures for every car, straight from the game's own derive() and
   stepLong() — no reimplementation here, so the numbers cannot drift. */
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(process.argv[2] || 'http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });

const out = await page.evaluate(async () => {
  const { Vehicle, derive } = await import('/src/vehicles.js');
  const { CARS, PLAYER_CARS } = await import('/src/carFactory.js');
  const POLICE = ['zivi_touring', 'zivi_limo', 'zivi_kompakt', 'zivi_avant'];
  const dt = 1 / 200;

  /* A bare integrator: Vehicle needs a mesh, so drive stepLong on a stub that
     carries only what the longitudinal model touches. */
  const rig = (id) => {
    const spec = CARS[id];
    const o = Object.create(Vehicle.prototype);
    o.spec = spec; o.perf = spec.perf; o.d = derive(spec.perf);
    o.s = 14000; o.v = 0.5; o.gear = 0; o.rpm = 900; o.shiftT = 0;
    o.offroad = false; o.dir = 1; o.aLong = 0; o.brake = 0;
    return o;
  };
  const run = (id) => {
    const spec = CARS[id];
    const a = rig(id);
    let t = 0, t100 = null, t200 = null;
    for (let i = 0; i < 200 * 90; i++) {
      a.stepLong(dt, 1, 0, null); t += dt;
      const k = a.v * 3.6;
      if (!t100 && k >= 100) t100 = t;
      if (!t200 && k >= 200) t200 = t;
    }
    const b = rig(id); b.v = 60;
    for (let i = 0; i < 200 * 240; i++) b.stepLong(dt, 1, 0, null);
    const c = rig(id); c.v = 100 / 3.6;
    let tb = 0; while (c.v > 0.3 && tb < 20) { c.stepLong(dt, 0, 1, null); tb += dt; }
    return {
      car: spec.name, quoted: spec.perf.vmax, top: Math.round(b.v * 3.6),
      t100: t100 && +t100.toFixed(2), t200: t200 && +t200.toFixed(2),
      brake100_0: +tb.toFixed(2),
    };
  };
  return { player: PLAYER_CARS.map(run), police: POLICE.map(run) };
});

console.log('\nCARS YOU DRIVE'); console.table(out.player);
console.log('UNMARKED PATROL CARS'); console.table(out.police);
const fastestCop = Math.max(...out.police.map(p => p.top));
console.log(`\nfastest patrol car: ${fastestCop} km/h`);
for (const p of out.player) {
  const d = p.top - fastestCop;
  const secs = d > 1 ? Math.round(340 / (d / 3.6)) : null;
  console.log(`  ${p.car.padEnd(24)} top ${p.top}  margin ${String(d).padStart(4)} km/h` +
    (secs ? `  -> 340 m clear in ${secs} s flat out` : '  -> cannot out-drag them'));
}
await browser.close();
