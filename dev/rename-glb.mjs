/* ==========================================================================
   rename-glb — give a downloaded model's materials and nodes usable names.

   Every fitting decision in src/carModels.js keys off names: which material is
   paint to tint, which is glass, which meshes are the wheels. Most authors
   name things sensibly. Some do not: one estate here arrives with its
   materials called `.001`, `.002`, `material`, `Material` and its node names
   in Cyrillic that survives neither a terminal nor a regex written by hand.

   Rather than encode mojibake in a recipe, rename once, offline, and commit
   the result. The GLB's JSON chunk is patched in place and the chunk lengths
   recomputed; nothing else in the file is touched.

   Usage:
     node dev/rename-glb.mjs in.glb out.glb --list
     node dev/rename-glb.mjs in.glb out.glb --mat '.002=paint' --mat '.007=glass'
                                            --node '18=wheels_a' --node '19=wheels_b'

   `--mat` matches the existing material name exactly. `--node` takes the mesh
   index printed by `--list`, because that is the only stable handle when the
   existing name is unusable.
   ========================================================================== */
import fs from 'node:fs';

const [inFile, outFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const args = process.argv.slice(2);
const list = args.includes('--list');
const pick = (flag) => args.reduce((acc, a, i) => (a === flag ? [...acc, args[i + 1]] : acc), []);

const buf = fs.readFileSync(inFile);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const jsonStart = 20;
const json = JSON.parse(buf.subarray(jsonStart, jsonStart + jsonLen).toString('utf8'));
const rest = buf.subarray(jsonStart + jsonLen);          // BIN chunk header + data

if (list) {
  console.log('materials:');
  (json.materials || []).forEach((m, i) => console.log(`  [${i}] ${JSON.stringify(m.name)}`));
  console.log('nodes with meshes:');
  (json.nodes || []).forEach((n, i) => {
    if (n.mesh === undefined) return;
    const mesh = json.meshes[n.mesh];
    const mats = (mesh.primitives || []).map(p => (json.materials[p.material] || {}).name);
    console.log(`  [${i}] ${JSON.stringify(n.name)}  mesh=${n.mesh} mats=${JSON.stringify(mats)}`);
  });
  process.exit(0);
}

let changed = 0;
for (const spec of pick('--mat')) {
  const eq = spec.indexOf('=');
  const from = spec.slice(0, eq), to = spec.slice(eq + 1);
  const m = (json.materials || []).find(x => x.name === from);
  if (!m) { console.error(`  no material named ${JSON.stringify(from)}`); continue; }
  m.name = to; changed++;
  console.log(`  material ${JSON.stringify(from)} -> ${to}`);
}
for (const spec of pick('--node')) {
  const eq = spec.indexOf('=');
  const idx = Number(spec.slice(0, eq)), to = spec.slice(eq + 1);
  const n = (json.nodes || [])[idx];
  if (!n) { console.error(`  no node [${idx}]`); continue; }
  n.name = to; changed++;
  console.log(`  node [${idx}] -> ${to}`);
}
/* Meshes carry names too, and GLTFLoader prefers the mesh name when a node has
   none — rename both so whichever one surfaces is the one we asked for. */
for (const spec of pick('--node')) {
  const eq = spec.indexOf('=');
  const n = (json.nodes || [])[Number(spec.slice(0, eq))];
  if (n && n.mesh !== undefined && json.meshes[n.mesh]) json.meshes[n.mesh].name = spec.slice(eq + 1);
}

const outJson = Buffer.from(JSON.stringify(json), 'utf8');
const pad = (4 - (outJson.length % 4)) % 4;
const jsonChunk = Buffer.concat([outJson, Buffer.alloc(pad, 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);                      // 'glTF'
header.writeUInt32LE(2, 4);                               // version
header.writeUInt32LE(12 + 8 + jsonChunk.length + rest.length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);                     // 'JSON'
fs.writeFileSync(outFile, Buffer.concat([header, jsonChunk, rest]));
console.log(`${changed} rename(s) -> ${outFile}`);
