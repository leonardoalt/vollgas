/* Start a race, then break the frame's triangle count down by vehicle so it is
   obvious what is actually expensive. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5201/';
const b = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1280,760',
    '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 760 });
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 300)));
await p.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
await p.waitForFunction('window.__ready === true', { timeout: 90000 });
await p.click('#start-btn');
await new Promise(r => setTimeout(r, 6000));
const out = await p.evaluate(() => {
  const g = window.__game;
  const tri = (o) => {
    let n = 0;
    o.traverse(m => {
      if (!m.isMesh) return;
      n += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
    });
    return Math.round(n);
  };
  const meshCount = (o) => { let n = 0; o.traverse(m => { if (m.isMesh) n++; }); return n; };
  const rows = [];
  if (g.player) rows.push(['player:' + g.player.mesh.name, tri(g.player.mesh), meshCount(g.player.mesh)]);
  const byKind = {};
  for (const t of g.traffic.all) {
    const k = t.mesh.name || 'truck';
    if (!byKind[k]) byKind[k] = { n: 0, tris: 0, meshes: 0 };
    byKind[k].n++; byKind[k].tris += tri(t.mesh); byKind[k].meshes += meshCount(t.mesh);
  }
  for (const c of (g.enf ? g.enf.cops : [])) {
    const k = 'cop:' + (c.mesh.name || '?');
    if (!byKind[k]) byKind[k] = { n: 0, tris: 0, meshes: 0 };
    byKind[k].n++; byKind[k].tris += tri(c.mesh); byKind[k].meshes += meshCount(c.mesh);
  }
  let sceneTotal = 0;
  g.scene.traverse(m => {
    if (!m.isMesh) return;
    sceneTotal += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
  });
  return {
    frame: g.frameStats, sceneTotal: Math.round(sceneTotal), rows,
    byKind: Object.entries(byKind).map(([k, v]) =>
      `${k} x${v.n} = ${v.tris} tris (${Math.round(v.tris / v.n)} ea, ${Math.round(v.meshes / v.n)} meshes ea)`),
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
