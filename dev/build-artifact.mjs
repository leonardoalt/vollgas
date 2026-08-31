/* Packages dist/ into one self-contained HTML page for Artifact publishing:
   no external scripts or stylesheets except the Google Fonts link, which is
   the one stylesheet host the Artifact CSP admits. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const files = readdirSync(join(dist, 'assets'));
const js = readFileSync(join(dist, 'assets', files.find(f => f.endsWith('.js'))), 'utf8');
const css = readFileSync(join(dist, 'assets', files.find(f => f.endsWith('.css'))), 'utf8');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

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
