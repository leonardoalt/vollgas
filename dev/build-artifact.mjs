/* Packages dist/ into one self-contained HTML page for Artifact publishing:
   no external scripts or stylesheets except the Google Fonts link, which is
   the one stylesheet host the Artifact CSP admits. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const files = readdirSync(join(dist, 'assets'));
let js = readFileSync(join(dist, 'assets', files.find(f => f.endsWith('.js'))), 'utf8');
const css = readFileSync(join(dist, 'assets', files.find(f => f.endsWith('.css'))), 'utf8');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

/* Vite emits imported assets as separate hashed files, which a single-file page
   cannot fetch. Inline each one as a data URI and rewrite the reference. */
const MIME = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  // car bodies: without these the single-file page silently falls back to the
  // procedural cars, because there is no server to fetch a .glb from
  '.glb': 'model/gltf-binary',
};
for (const f of files) {
  const ext = f.slice(f.lastIndexOf('.'));
  if (!MIME[ext]) continue;
  const b64 = readFileSync(join(dist, 'assets', f)).toString('base64');
  const uri = `data:${MIME[ext]};base64,${b64}`;
  const before = js;
  js = js.split(`/vollgas/assets/${f}`).join(uri).split(`assets/${f}`).join(uri);
  console.log(`inlined ${f} (${(b64.length / 1024).toFixed(0)} kB b64)`
    + (before === js ? ' — WARNING: no reference found' : ''));
}

// the game's own DOM, between <body> and </body>
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script[^>]*><\/script>/g, '').trim();

/* charset first: the file carries German text (umlauts, €, →) and if the host
   does not send a charset header the browser decodes it as Latin-1 and every
   one of them turns to mojibake. Must land inside the first 1024 bytes. */
const out = `<meta charset="utf-8" />
<title>Vollgas</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&display=swap" />
<style>
${css}
/* The artifact frame composites over a ground the viewer paints in its own
   theme, so the cockpit has to paint its own. This page commits to one
   visual world deliberately: a dark cockpit at speed. */
html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: #05070a; }
</style>
${body}
<script type="module">
${js}
</script>
`;
writeFileSync('dist/artifact.html', out);
console.log('dist/artifact.html', (out.length / 1024).toFixed(0) + ' kB');
