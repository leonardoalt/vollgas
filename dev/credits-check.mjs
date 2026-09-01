/* ==========================================================================
   credits-check — every URL in CREDITS.md must actually resolve, and every
   shipped model must carry the licence CREDITS.md claims for it.

   Provenance is the one part of this work that cannot be verified by looking
   at the screen, and a fabricated source URL is worse than no source URL: it
   looks like diligence. Twice while writing these entries a uid or a shard
   path was typed from memory and was wrong. Hence a check.

   Usage: node dev/credits-check.mjs [--offline]
   ========================================================================== */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const offline = process.argv.includes('--offline');
const md = fs.readFileSync('CREDITS.md', 'utf8');
let bad = 0;

/* ---- 1. every shipped GLB declares a licence we accept ------------------ */
const OK_LICENCE = /CC-?BY-?4\.0|CC0|CC-?BY-?3\.0/i;
const models = fs.readdirSync('src/assets/models').filter(f => f.endsWith('.glb'));
console.log('shipped models');
for (const f of models) {
  const buf = fs.readFileSync(`src/assets/models/${f}`);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const x = (json.asset || {}).extras || {};
  const lic = x.license || '';
  const okLic = OK_LICENCE.test(lic);
  const okShare = !/share.?alike|-SA\b|GPL/i.test(lic);
  // the model's source URL has to appear in CREDITS.md
  const cited = x.source ? md.includes(x.source) : false;
  const status = okLic && okShare && cited ? 'ok  ' : 'FAIL';
  if (status === 'FAIL') bad++;
  console.log(`  ${status} ${f.padEnd(26)} ${lic || '(no licence recorded)'}`
    + `${cited ? '' : '  [source URL not cited in CREDITS.md]'}`);
}

/* ---- 2. every URL in CREDITS.md resolves --------------------------------

   Except the ones inside an inline code span. Those are transcriptions of what
   some file or API literally says, quoted so a reader can check the claim
   against the artefact — and a transcription has to stay faithful even when
   the thing it quotes has rotted. ROY renamed his Sketchfab account after
   Objaverse took its snapshot, so `asset.extras` in the lorry we ship still
   names a profile that 404s; that is a fact about the file, and rewriting the
   quote to make a link checker happy would be falsifying evidence.

   The teeth are elsewhere and are not loosened by this: rule 1 above reads the
   source URL out of each shipped GLB and requires CREDITS.md to cite it, and
   every URL we assert in our own prose is still fetched. Quoted URLs are
   listed as `quot` so they stay visible rather than silently dropped.        */
const RX = /https:\/\/[A-Za-z0-9./_?=&:%-]+/g;
if (!offline) {
  const clean = (u) => u.replace(/[.,)>]+$/, '');
  /* A URL is exempt only if it appears NOWHERE outside a code span. Asserting
     it in prose anywhere in the file puts it back on the hook. */
  const asserted = new Set((md.replace(/`[^`\n]*`/g, ' ').match(RX) || []).map(clean));
  const found = (md.match(RX) || [])
    .map(clean)
    // `<shard>/<uid>` in the worked example is a placeholder, not a claim
    .filter(u => !u.endsWith('/glbs/'));
  const urls = [...new Set(found)].filter((u) => {
    if (asserted.has(u)) return true;
    console.log(`  quot      ${u}  [quoted verbatim, not asserted]`);
    return false;
  });
  console.log(`\n${urls.length} URLs`);
  for (const u of urls) {
    let code = '000';
    try {
      code = execFileSync('curl', ['-sIL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', u],
        { encoding: 'utf8' }).trim();
    } catch { /* leave as 000 */ }
    const ok = code.startsWith('2') || code === '403';   // 403 = alive, hotlink-guarded
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${code}  ${u}`);
  }
}

console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exit(bad ? 1 : 0);
