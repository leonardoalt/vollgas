/* ==========================================================================
   fleet-check — every vehicle, measured, not looked at.

   A fleet is exactly the thing you cannot eyeball. Four traffic cars shipped
   with one of them facing backwards and two with wheels outside the arches,
   through a review that consisted of opening a screenshot of all four side by
   side. So: build every id in CARS plus the truck through the real path, and
   assert.

     facing    the nose points +Z. Derived from the shape — the roofline and
               the wing mirrors — not from what the fitting recipe claimed,
               so this catches a recipe that lies as well as a transform that
               is wrong. `src/carFit.js` does the deriving and this page runs
               it on the finished car, after every scale and translate.
     arches    each wheel sits inside the bodywork at its own axle, and near
               the axle position the rig declares. Lateral, because a wheel
               standing proud of the flank is the thing you cannot unsee;
               longitudinal, because the physics believes CARS[id].axleF.
     ground    the lowest point of every wheel is on the road, and the body is
               not under it.
     envelope  the body is the size CARS[id].dims says it is.
     contract  userData still has what police.js, vehicles.js, hud.js and the
               collision code read out of it.

   Usage:  node dev/fleet-check.mjs [url] [--shots <dir>]
   Exits non-zero on any FAIL.
   ========================================================================== */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const url = args.find(a => a.startsWith('http')) || 'http://localhost:5301/';
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const base = url.replace(/\/$/, '');

/* Tolerances. Wide enough that a real model's proportions are allowed to
   differ from the rig's nominal box — they always do, and the rig's numbers
   were drawn for a procedural loft — but tight enough that the failures we
   actually shipped are caught. */
const TOL = {
  archLateral: 0.02,     // m the tyre's outer wall may stand proud of the flank
  axleZ: 0.06,           // m a wheel may sit from its declared axle
  ground: 0.03,          // m the lowest wheel point may be off the road
  sink: 0.005,           // m of bodywork allowed below the road
  length: 0.10,          // fraction
  width: 0.10,
  height: 0.20,          // the rig's van is a Sprinter; the model is an MPV
  noseConf: 0.12,        // below this the shape genuinely does not say
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1600,900', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message.slice(0, 200)));
/* The bare "Failed to load resource" console line does not say which resource,
   and the only one that ever fails is /favicon.ico, which predates all of this.
   Watch the responses instead, where the URL is visible. */
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource/i.test(t)) return;
  errs.push('[console] ' + t.slice(0, 200));
});
page.on('response', (res) => {
  if (res.status() < 400) return;
  if (/favicon/i.test(res.url())) return;
  errs.push(`[http ${res.status()}] ${res.url().slice(0, 160)}`);
});

await page.goto(`${base}/dev/fleet.html?ids=all&layout=stack&env=road`, { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 120000 });

const rows = await page.evaluate(async (TOL) => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { noseSign, bboxOf, halfWidthAt, envelopeOf } = await import('/src/carFit.js');
  const { CARS } = await import('/src/carFactory.js');

  const SKIP = new Set(['plates', 'shadow', 'blue', 'ledSign']);
  const out = [];

  for (const { id, obj } of window.__fleet) {
    obj.updateMatrixWorld(true);
    const spec = CARS[id] || null;
    const ud = obj.userData || {};
    const wheels = ud.wheels || [];
    const wheelSet = new Set();
    for (const w of wheels) w.traverse(o => wheelSet.add(o));

    /* The body is what is left once the things we bolted on are removed:
       wheels, plates, the fake contact shadow, blue lights and the LED sign.
       Everything else is the model (or the loft). */
    const bodyGeos = [];
    let bodyTris = 0;
    obj.traverse(o => {
      if (!o.isMesh || wheelSet.has(o)) return;
      for (let p = o; p && p !== obj; p = p.parent) if (SKIP.has(p.name)) return;
      if (SKIP.has(o.name)) return;
      const g = o.geometry.clone();
      o.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(o.matrixWorld);
      // positions may be quantised/interleaved; go through the accessor
      const src = g.attributes.position;
      const arr = new Float32Array(src.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < src.count; i++) {
        v.set(src.getX(i), src.getY(i), src.getZ(i)).applyMatrix4(m);
        arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      /* Keep the index. Without it `forEachTriangle` reads the vertex array in
         storage order and invents triangles between unrelated corners of the
         car — which is how the 911's wing aerial ended up joined to its roof
         and the vehicle measured 29% too tall. */
      if (g.index) {
        const src2 = g.index;
        const ia = new Uint32Array(src2.count);
        for (let i = 0; i < src2.count; i++) ia[i] = src2.getX(i);
        gg.setIndex(new THREE.BufferAttribute(ia, 1));
      }
      bodyGeos.push(gg);
      bodyTris += (o.geometry.index ? o.geometry.index.count : src.count) / 3;
    });

    const r = { id, model: !!ud.model, fails: [], warns: [], tris: Math.round(bodyTris) };
    if (!bodyGeos.length) { r.fails.push('no body geometry'); out.push(r); continue; }

    /* Sizes come from `envelopeOf`, not from a bounding box: a 911 wears an
       aerial 43 cm above its roof and an artic carries fuel tanks wider than
       its trailer, and neither should decide how big the vehicle is. */
    const bb = bboxOf(bodyGeos);
    const env = envelopeOf(bodyGeos);
    const waist = env.waist;
    r.len = +env.length.toFixed(3);
    r.hgt = +env.height.toFixed(3);
    r.wid = +env.width.toFixed(3);
    r.floor = +bb.min.y.toFixed(3);

    /* ---- facing ---------------------------------------------------- */
    const ns = noseSign(bodyGeos);
    r.nose = ns.sign > 0 ? '+Z' : '-Z';
    r.noseConf = +ns.conf.toFixed(2);
    r.cues = ns.cues;
    if (ns.sign < 0) r.fails.push(`facing: nose derives to -Z (conf ${r.noseConf}, cues ${JSON.stringify(ns.cues)})`);
    else if (ns.conf < TOL.noseConf) r.warns.push(`facing weak (conf ${r.noseConf}, cues ${JSON.stringify(ns.cues)})`);

    /* ---- wheels ------------------------------------------------------ */
    const nWanted = id === 'truck' ? 6 : 4;
    r.nWheels = wheels.length;
    if (wheels.length < nWanted) r.fails.push(`wheels: ${wheels.length}, wanted at least ${nWanted}`);

    let worstLat = -Infinity, worstAxle = 0, worstGround = 0;
    for (const w of wheels) {
      w.updateMatrixWorld(true);
      const local = new THREE.Vector3().setFromMatrixPosition(
        new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(w.matrixWorld));
      // the wheel's own extents, in the car's frame
      const wb = new THREE.Box3();
      w.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const m = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(o.matrixWorld);
        wb.union(g.boundingBox.clone().applyMatrix4(m));
      });
      if (wb.isEmpty()) continue;
      const outer = Math.max(Math.abs(wb.min.x), Math.abs(wb.max.x));

      // how wide is the bodywork beside this wheel, below the waist
      const flank = halfWidthAt(bodyGeos, local.z, Math.max(0.22, (wb.max.y - wb.min.y) * 0.45), waist);
      worstLat = Math.max(worstLat, outer - flank);
      worstGround = Math.max(worstGround, Math.abs(wb.min.y));

      if (spec) {
        const front = w.userData.front !== undefined
          ? w.userData.front : local.z > (spec.axleF + spec.axleR) / 2;
        const want = front ? spec.axleF : spec.axleR;
        worstAxle = Math.max(worstAxle, Math.abs(local.z - want));
      }
    }
    r.proud = Number.isFinite(worstLat) ? +worstLat.toFixed(3) : null;
    r.axleErr = +worstAxle.toFixed(3);
    r.groundErr = +worstGround.toFixed(3);
    if (worstLat > TOL.archLateral) r.fails.push(`arches: a tyre stands ${(worstLat * 100).toFixed(1)} cm proud of the flank`);
    if (spec && worstAxle > TOL.axleZ) r.fails.push(`arches: a wheel is ${(worstAxle * 100).toFixed(1)} cm from its declared axle`);
    if (worstGround > TOL.ground) r.fails.push(`ground: lowest wheel point is ${(worstGround * 100).toFixed(1)} cm off the road`);
    if (bb.min.y < -TOL.sink) r.fails.push(`ground: body is ${(-bb.min.y * 100).toFixed(1)} cm under the road`);

    /* ---- envelope ----------------------------------------------------- */
    const dims = ud.dims || (spec && spec.dims);
    if (dims) {
      const eL = (r.len - dims.length) / dims.length;
      const eW = (r.wid - dims.width) / dims.width;
      const eH = (r.hgt - dims.height) / dims.height;
      r.env = `${(eL * 100).toFixed(0)}/${(eW * 100).toFixed(0)}/${(eH * 100).toFixed(0)}`;
      if (Math.abs(eL) > TOL.length) r.fails.push(`envelope: length ${(eL * 100).toFixed(0)}% off ${dims.length} m`);
      if (Math.abs(eW) > TOL.width) r.fails.push(`envelope: width ${(eW * 100).toFixed(0)}% off ${dims.width} m`);
      if (Math.abs(eH) > TOL.height) r.fails.push(`envelope: height ${(eH * 100).toFixed(0)}% off ${dims.height} m`);
    } else r.fails.push('envelope: no dims');

    /* ---- contract ----------------------------------------------------- */
    const need = ['wheels', 'halfLen', 'halfWid'];
    for (const k of need) if (ud[k] === undefined || ud[k] === null) r.fails.push(`contract: userData.${k} missing`);
    for (const w of wheels) {
      if (!w.userData.spin) { r.fails.push('contract: a wheel has no userData.spin'); break; }
      if (!w.userData.radius) { r.fails.push('contract: a wheel has no userData.radius'); break; }
    }
    const police = id.startsWith('zivi') || id === 'messwagen';
    if (police) {
      if (!ud.blues || ud.blues.length < 4) r.fails.push(`contract: police blues = ${ud.blues ? ud.blues.length : 'none'}`);
      if (!ud.led) r.fails.push('contract: police led missing');
      else if (!ud.led.userData || !ud.led.userData.on || !ud.led.userData.off) r.fails.push('contract: led has no on/off textures');
    }
    if (spec) {
      if (!ud.paintMat) r.fails.push('contract: paintMat missing');
      if (!ud.headMat || !ud.tailMat) r.fails.push('contract: headMat/tailMat missing');
    }
    out.push(r);
  }
  return out;
}, TOL);

/* ------------------------------------------------------------------ report */
const fit = await page.evaluate(() => window.__fit || {});
const modelOf = await page.evaluate(() => window.__model || {});

const W = [14, 6, 8, 7, 6, 6, 6, 7, 7, 8, 8, 5];
const head = ['vehicle', 'body', 'nose', 'conf', 'len', 'wid', 'hgt', 'L/W/H%', 'proud', 'axleErr', 'ground', 'wh'];
const line = (c) => c.map((v, i) => String(v).padEnd(W[i])).join(' ');
console.log(line(head));
console.log(W.map(w => '-'.repeat(w)).join(' '));

let failed = 0;
for (const r of rows) {
  console.log(line([
    r.id, modelOf[r.id] ? 'model' : 'proc', r.nose ?? '?', r.noseConf ?? '-',
    r.len ?? '-', r.wid ?? '-', r.hgt ?? '-', r.env ?? '-',
    r.proud === null || r.proud === undefined ? '-' : r.proud.toFixed(3),
    r.axleErr === undefined ? '-' : r.axleErr.toFixed(3),
    r.groundErr === undefined ? '-' : r.groundErr.toFixed(3),
    r.nWheels ?? '-',
  ]) + '  ' + (r.fails.length ? 'FAIL' : r.warns.length ? 'PASS*' : 'PASS'));
  for (const f of r.fails) console.log(`  ${' '.repeat(6)}FAIL  ${f}`);
  for (const w of r.warns) console.log(`  ${' '.repeat(6)}warn  ${w}`);
  if (r.fails.length) failed++;
}

if (Object.keys(fit).length) {
  console.log('\nfitted models:');
  for (const [id, f] of Object.entries(fit)) {
    /* The lorry is scaled on length and width, not on a wheelbase — it has
       four axles and nothing that answers to that name. */
    const how = f.wheelbase !== undefined
      ? `wb=${f.wheelbase}/${f.rigWheelbase}` : `wheels=${f.wheels}`;
    console.log(`  ${id.padEnd(13)} yaw=${String(f.yaw).padStart(7)}deg nose=${f.nose > 0 ? '+Z' : '-Z'} conf=${f.noseConf} `
      + `${how} scale=${f.scale} tris=${f.tris}` + (f.notes.length ? `  [${f.notes.join('; ')}]` : ''));
  }
}

if (errs.length) {
  console.log('\npage errors:');
  for (const e of [...new Set(errs)].slice(0, 12)) console.log('  ' + e);
}

if (shotDir) {
  fs.mkdirSync(shotDir, { recursive: true });
  for (const [name, qs, w, h] of [
    ['fleet-side-players', 'ids=turbo,m5,rs6,amg&layout=row&mode=side&env=road', 1800, 620],
    ['fleet-side-police', 'ids=zivi_limo,zivi_touring,zivi_avant,zivi_kompakt,messwagen&layout=row&mode=side&env=road', 1800, 620],
    ['fleet-side-traffic', 'ids=kombi,hatch,taxi,van&layout=row&mode=side&env=road', 1800, 620],
    ['fleet-f34', 'ids=turbo,m5,rs6,amg,zivi_limo,zivi_touring,zivi_avant,zivi_kompakt,messwagen,kombi,hatch,taxi,van&layout=grid&mode=front34&env=road', 1600, 1000],
    ['fleet-players', 'ids=turbo,m5,rs6,amg&layout=row&mode=front34&env=road', 1600, 900],
    ['fleet-police', 'ids=zivi_limo,zivi_touring,zivi_avant,zivi_kompakt,messwagen&layout=row&mode=front34&env=road', 1600, 900],
    ['fleet-truck', 'ids=truck&layout=row&mode=side&env=road', 1600, 700],
  ]) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: h });
    await p.goto(`${base}/dev/fleet.html?${qs}`, { waitUntil: 'networkidle0', timeout: 120000 });
    await p.waitForFunction('window.__ready === true', { timeout: 120000 });
    await new Promise(r => setTimeout(r, 900));
    await p.screenshot({ path: `${shotDir}/${name}.png` });
    await p.close();
    console.log('shot', `${shotDir}/${name}.png`);
  }
}

await browser.close();
const nerr = errs.length;
console.log(`\n${rows.length} vehicles, ${failed} failing, ${nerr} page errors`);
if (failed || nerr) process.exit(1);
