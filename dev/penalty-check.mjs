/* Penalties against the real German rules: the Bußgeldkatalog ceiling, and the
   point at which speeding stops being an administrative offence at all. */
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/pen.png';
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

const table = await page.evaluate(async () => {
  const { assessSpeeding, RACING_MULTIPLE } = await import('/src/police.js');
  const rows = [];
  for (const [limit, kmh] of [
    [120, 125], [120, 141], [120, 145], [120, 151], [120, 161], [120, 171],
    [120, 181], [120, 191], [120, 200], [120, 239], [120, 240], [120, 300],
    [100, 200], [80, 160],
  ]) {
    const a = assessSpeeding(kmh, limit);
    rows.push({ limit, kmh, over: a.excess, offence: a.criminal ? '§ 315d StGB' : 'BKat',
      fine: a.fine, days: a.days ?? '', points: a.points, ban: a.ban,
      licence: a.revoked ? 'revoked' : (a.ban ? a.ban + ' mo ban' : '—'), car: a.seized ? 'seized' : '—' });
  }
  return { rows, mult: RACING_MULTIPLE };
});
console.table(table.rows);
console.log('criminal threshold: >=', table.mult + '× the posted limit');
const bkat = table.rows.filter(r => r.offence === 'BKat');
console.log('  BKat points never exceed 2 :', Math.max(...bkat.map(r => r.points)) === 2 ? 'PASS' : 'FAIL');
console.log('  BKat fine never exceeds 700:', Math.max(...bkat.map(r => r.fine)) === 700 ? 'PASS' : 'FAIL');
console.log('  criminal tier gives 3 pts  :',
  table.rows.filter(r => r.offence !== 'BKat').every(r => r.points === 3) ? 'PASS' : 'FAIL');

/* the criminal tier must actually end the run, with its own card */
const run = await page.evaluate(async () => {
  const g = window.__game;
  g.startRace(); g.countdown = 0;
  const { LANES, SECTIONS } = await import('/src/track.js');
  const p = g.player;
  // a 120 section, doing 300 — well past twice the limit
  const sec = SECTIONS.find(s => s.limit === 120 && s.km > 12);
  p.s = sec.km * 1000 + 500; p.u = LANES[0]; p.v = 300 / 3.6;
  const cam = g.enf.cameras.reduce((a, c) =>
    Math.abs(c.s - (p.s + 120)) < Math.abs(a.s - (p.s + 120)) ? c : a);
  cam.s = p.s + 120; cam.fired = false; cam.u = 30;   // move it clear so we do not ram it
  let card = null, kind = null;
  for (let i = 0; i < 40 * 45; i++) {
    g.input.update = () => Object.assign(g.input, { throttle: 1, brake: 0, steer: 0, handbrake: false });
    g.step(1 / 40);
    if (!kind && g.ending) kind = g.ending.kind;
    if (!card && document.getElementById('busted').classList.contains('on')) {
      card = document.querySelector('#busted h2').textContent;
    }
    if (g.state !== 'race') break;
  }
  delete g.input.update;
  const tk = g.player.tickets[0] || {};
  return { kind, card, state: g.state, dnf: g.results && g.results.dnf,
           fines: g.player.fines, points: g.player.points,
           ticket: { src: tk.src, days: tk.days, revoked: tk.revoked, seized: tk.seized },
           notice: (document.getElementById('results-ticket') || {}).textContent || '' };
});
console.log('300 in a 120, caught:', JSON.stringify({ ...run, notice: undefined }));
console.log('  ends the run on its own card:',
  run.kind === 'racing' && run.state === 'results' && !!run.card ? 'PASS' : 'FAIL');
console.log('  notice states the statute   :',
  /315d/.test(run.notice) && /69 StGB|315f/.test(run.notice) ? 'PASS' : 'FAIL');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: out });
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
