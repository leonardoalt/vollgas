/* Print the licence block a glTF Binary carries in `asset` / `asset.extras`.
   Sketchfab's own exporter writes author, licence and source URL in there, so
   this is the evidence CREDITS.md quotes — read from the file we actually
   ship, not from a web page that can change under us.

   Usage: node dev/glb-licence.mjs <file.glb> [more.glb ...] */
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) { console.log(`${file}: not a GLB`); continue; }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const a = json.asset || {};
  const x = a.extras || {};
  console.log(`\n${file}  (${(buf.length / 1024).toFixed(0)} KB)`);
  console.log(`  generator : ${a.generator || '-'}`);
  console.log(`  title     : ${x.title || '-'}`);
  console.log(`  author    : ${x.author || '-'}`);
  console.log(`  licence   : ${x.license || '(none recorded)'}`);
  console.log(`  source    : ${x.source || '-'}`);
  const mats = (json.materials || []).map(m => m.name).filter(Boolean);
  console.log(`  materials : ${mats.join(', ')}`);
}
