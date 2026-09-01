/* ==========================================================================
   textures.js — everything drawn on a 2-D canvas and uploaded as a texture.
   The signs follow the StVO catalogue reasonably closely, because the signage
   is what actually makes a road read as *German*: white discs with a fat red
   ring, the diagonally-striped "Ende aller Streckenverbote", blue gantries in
   Verkehrsblau, yellow Baustelle lane markings.
   ========================================================================== */
import * as THREE from 'three';

export const COL = {
  blue:   '#00519e',   // RAL 5017 Verkehrsblau
  red:    '#cc0d1a',   // RAL 3020 Verkehrsrot
  green:  '#00713d',   // RAL 6024 Verkehrsgrün
  yellow: '#f2c200',   // RAL 1023 Verkehrsgelb
  white:  '#f5f5f2',
  black:  '#16181b',
  grey:   '#9aa0a6',
};

const DIN = '"Roboto Condensed","Arial Narrow",Helvetica,Arial,sans-serif';
const _cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function cached(key, build) {
  if (!_cache.has(key)) _cache.set(key, build());
  return _cache.get(key);
}

/** Draw text centred, shrinking until it fits maxW. */
function fit(ctx, text, cx, cy, maxW, size, weight = '700') {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${DIN}`;
    if (ctx.measureText(text).width <= maxW || s < 6) break;
    s -= 1;
  } while (true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
  return s;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ========================================================== round signs */

/** Zeichen 274 — Zulässige Höchstgeschwindigkeit. */
export function signLimit(kmh) {
  return cached('lim' + kmh, () => {
    const D = 512, c = canvas(D, D), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, D, D);
    const r = D * 0.47;
    ctx.fillStyle = COL.red;
    ctx.beginPath(); ctx.arc(D / 2, D / 2, r, 0, 7); ctx.fill();
    ctx.fillStyle = COL.white;
    ctx.beginPath(); ctx.arc(D / 2, D / 2, r * 0.795, 0, 7); ctx.fill();
    ctx.fillStyle = COL.black;
    fit(ctx, String(kmh), D / 2, D / 2 + D * 0.012, D * 0.66, D * 0.5);
    return { tex: finish(c), aspect: 1, round: true };
  });
}

/** Zeichen 282 — Ende sämtlicher Streckenverbote. Freie Fahrt. */
export function signEndAll() {
  return cached('endall', () => {
    const D = 512, c = canvas(D, D), ctx = c.getContext('2d');
    const r = D * 0.47;
    ctx.fillStyle = COL.black;
    ctx.beginPath(); ctx.arc(D / 2, D / 2, r, 0, 7); ctx.fill();
    ctx.fillStyle = COL.white;
    ctx.beginPath(); ctx.arc(D / 2, D / 2, r * 0.94, 0, 7); ctx.fill();
    // five diagonal bars, clipped to the disc
    ctx.save();
    ctx.beginPath(); ctx.arc(D / 2, D / 2, r * 0.94, 0, 7); ctx.clip();
    ctx.strokeStyle = COL.black;
    ctx.lineWidth = D * 0.035;
    for (let i = -3; i <= 4; i++) {
      const o = i * D * 0.135;
      ctx.beginPath();
      ctx.moveTo(o, D); ctx.lineTo(o + D, 0);
      ctx.stroke();
    }
    ctx.restore();
    return { tex: finish(c), aspect: 1, round: true };
  });
}

/** Zeichen 380 — Richtgeschwindigkeit (advisory), blue square. */
export function signAdvice(kmh) {
  return cached('adv' + kmh, () => {
    const D = 512, c = canvas(D, D), ctx = c.getContext('2d');
    ctx.fillStyle = COL.white;
    roundRect(ctx, 8, 8, D - 16, D - 16, 26); ctx.fill();
    ctx.fillStyle = COL.blue;
    roundRect(ctx, 30, 30, D - 60, D - 60, 16); ctx.fill();
    ctx.fillStyle = COL.white;
    fit(ctx, String(kmh), D / 2, D / 2, D * 0.68, D * 0.44);
    return { tex: finish(c), aspect: 1 };
  });
}

/** Zeichen 333 — Ausfahrttafel. */
export function signAusfahrt(label) {
  return cached('aus' + label, () => {
    const W = 768, H = 320, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = COL.white; roundRect(ctx, 0, 0, W, H, 18); ctx.fill();
    ctx.fillStyle = COL.blue;  roundRect(ctx, 12, 12, W - 24, H - 24, 10); ctx.fill();
    ctx.fillStyle = COL.white;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `700 78px ${DIN}`;
    ctx.fillText('Ausfahrt', 40, 82);
    // the classic hooked exit arrow
    ctx.strokeStyle = COL.white; ctx.lineWidth = 26; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(58, H - 44); ctx.lineTo(58, 168); ctx.quadraticCurveTo(58, 128, 108, 128);
    ctx.lineTo(180, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(168, 100); ctx.lineTo(214, 128); ctx.lineTo(168, 156); ctx.closePath();
    ctx.fillStyle = COL.white; ctx.fill();
    fit(ctx, label, (W + 200) / 2 + 30, 190, W - 300, 84);
    return { tex: finish(c), aspect: W / H };
  });
}

/** Zeichen 439/440 style gantry — Vorwegweiser with destinations. */
export function signGantry(dests, shield = 'A 81') {
  return cached('gan' + shield + dests.join('|'), () => {
    const W = 1024, H = 420, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = COL.white; roundRect(ctx, 0, 0, W, H, 16); ctx.fill();
    ctx.fillStyle = COL.blue;  roundRect(ctx, 11, 11, W - 22, H - 22, 8); ctx.fill();
    // motorway shield
    ctx.fillStyle = COL.white; roundRect(ctx, 44, 44, 168, 96, 12); ctx.fill();
    ctx.fillStyle = COL.blue;  roundRect(ctx, 52, 52, 152, 80, 8); ctx.fill();
    ctx.fillStyle = COL.white;
    fit(ctx, shield, 128, 94, 132, 62);
    // straight-on arrow
    ctx.strokeStyle = COL.white; ctx.lineWidth = 22; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(W - 96, H - 56); ctx.lineTo(W - 96, 118); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W - 140, 126); ctx.lineTo(W - 96, 56); ctx.lineTo(W - 52, 126); ctx.closePath();
    ctx.fillStyle = COL.white; ctx.fill();
    // destination list
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const y0 = 210, step = 76;
    dests.forEach((d, i) => {
      ctx.fillStyle = COL.white;
      ctx.font = `700 62px ${DIN}`;
      let s = 62;
      while (ctx.measureText(d).width > W - 300 && s > 20) { s -= 2; ctx.font = `700 ${s}px ${DIN}`; }
      ctx.fillText(d, 60, y0 + i * step);
    });
    return { tex: finish(c), aspect: W / H };
  });
}

/** Zeichen 365 style Raststätte board with fork+fuel pictograms. */
export function signRast(name) {
  return cached('rast' + name, () => {
    const W = 700, H = 300, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = COL.white; roundRect(ctx, 0, 0, W, H, 16); ctx.fill();
    ctx.fillStyle = COL.blue;  roundRect(ctx, 11, 11, W - 22, H - 22, 8); ctx.fill();
    ctx.fillStyle = COL.white;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `700 56px ${DIN}`;
    ctx.fillText('Raststätte', 40, 62);
    fit(ctx, name, W / 2, 132, W - 90, 66);
    // white pictogram tiles: fuel pump + cutlery
    const bx = W / 2 - 130;
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = COL.white;
      roundRect(ctx, bx + i * 140, 190, 120, 80, 8); ctx.fill();
      ctx.fillStyle = COL.blue;
      if (i === 0) {                       // fuel pump
        ctx.fillRect(bx + 34, 206, 40, 52);
        ctx.fillRect(bx + 74, 214, 8, 26);
        ctx.fillRect(bx + 28, 258, 52, 8);
      } else {                             // knife & fork
        const o = bx + 140;
        ctx.fillRect(o + 40, 204, 7, 58);
        ctx.fillRect(o + 30, 204, 7, 26); ctx.fillRect(o + 50, 204, 7, 26);
        ctx.fillRect(o + 72, 204, 9, 58);
        ctx.beginPath(); ctx.arc(o + 76, 212, 11, 0, 7); ctx.fill();
      }
    }
    return { tex: finish(c), aspect: W / H };
  });
}

/** Zeichen 123 — Baustelle (roadworks warning triangle). */
export function signBaustelle() {
  return cached('bau', () => {
    const D = 512, c = canvas(D, D), ctx = c.getContext('2d');
    const p = D * 0.05, tri = (inset, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(D / 2, p + inset);
      ctx.lineTo(D - p - inset * 0.6, D - p * 1.6 - inset * 0.3);
      ctx.lineTo(p + inset * 0.6, D - p * 1.6 - inset * 0.3);
      ctx.closePath(); ctx.fill();
    };
    tri(0, COL.red);
    tri(D * 0.105, COL.white);
    // shovelling worker pictogram, abstracted
    ctx.fillStyle = COL.black;
    ctx.beginPath(); ctx.arc(D * 0.44, D * 0.46, D * 0.045, 0, 7); ctx.fill();  // head
    ctx.save();
    ctx.translate(D * 0.44, D * 0.52); ctx.rotate(0.18);
    ctx.fillRect(-D * 0.022, 0, D * 0.045, D * 0.15);                            // torso
    ctx.restore();
    ctx.lineWidth = D * 0.022; ctx.strokeStyle = COL.black; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(D * 0.46, D * 0.56); ctx.lineTo(D * 0.60, D * 0.63); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(D * 0.60, D * 0.63); ctx.lineTo(D * 0.66, D * 0.72); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(D * 0.43, D * 0.67); ctx.lineTo(D * 0.40, D * 0.76); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(D * 0.45, D * 0.67); ctx.lineTo(D * 0.52, D * 0.76); ctx.stroke();
    ctx.fillRect(D * 0.62, D * 0.71, D * 0.10, D * 0.035);                       // spoil heap
    return { tex: finish(c), aspect: 1, round: true };
  });
}

/** Small blue kilometre plate at the verge. */
export function signKm(km) {
  return cached('km' + km, () => {
    const W = 256, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = COL.white; roundRect(ctx, 0, 0, W, H, 8); ctx.fill();
    ctx.fillStyle = COL.blue;  roundRect(ctx, 7, 7, W - 14, H - 14, 4); ctx.fill();
    ctx.fillStyle = COL.white;
    fit(ctx, String(km), W / 2, H / 2 + 4, W - 30, 82);
    return { tex: finish(c), aspect: W / H };
  });
}

/** Tunnel portal board: name + length. */
export function signTunnel(name, metres) {
  return cached('tun' + name, () => {
    const W = 900, H = 240, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = COL.white; roundRect(ctx, 0, 0, W, H, 12); ctx.fill();
    ctx.fillStyle = COL.blue;  roundRect(ctx, 9, 9, W - 18, H - 18, 6); ctx.fill();
    ctx.fillStyle = COL.white;
    fit(ctx, name, W / 2, 86, W - 70, 74);
    fit(ctx, `${metres.toLocaleString('de-DE')} m`, W / 2, 176, W - 70, 56, '400');
    return { tex: finish(c), aspect: W / H };
  });
}

/* ================================================== licence plates & LEDs */

/** German plate: EU strip with 12 stars and a D, black DIN characters. */
export function plateTex(text) {
  return cached('plate' + text, () => {
    const W = 520, H = 112, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#f6f6f1';
    roundRect(ctx, 0, 0, W, H, 12); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 6;
    roundRect(ctx, 4, 4, W - 8, H - 8, 10); ctx.stroke();
    // EU field
    ctx.fillStyle = '#003399';
    roundRect(ctx, 6, 6, 62, H - 12, 8); ctx.fill();
    ctx.fillStyle = '#ffcc00';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const x = 37 + Math.cos(a) * 19, y = 44 + Math.sin(a) * 19;
      ctx.beginPath(); ctx.arc(x, y, 2.3, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 26px ${DIN}`;
    ctx.fillText('D', 37, 90);
    // Plakette stickers (Zulassung + HU)
    const parts = text.split(/\s+/);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'left';
    ctx.font = `700 66px ${DIN}`;
    let x = 84;
    const kreis = parts[0] || 'S';
    ctx.fillText(kreis, x, H / 2 + 3);
    x += ctx.measureText(kreis).width + 14;
    // round stickers
    ctx.fillStyle = '#1f7a3f'; ctx.beginPath(); ctx.arc(x + 13, 34, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#d8a400'; ctx.beginPath(); ctx.arc(x + 13, 76, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    x += 34;
    const rest = parts.slice(1).join(' ');
    let s = 66;
    ctx.font = `700 ${s}px ${DIN}`;
    while (ctx.measureText(rest).width > W - x - 16 && s > 24) { s -= 2; ctx.font = `700 ${s}px ${DIN}`; }
    ctx.fillText(rest, x, H / 2 + 3);
    return { tex: finish(c), aspect: W / H };
  });
}

/**
 * The rear-window LED matrix an unmarked German patrol car lights up:
 * "STOP POLIZEI" / "BITTE FOLGEN". `on=false` gives the dead-dark panel that
 * makes the car look like any other Passat until it decides otherwise.
 */
export function ledTex(text, on) {
  return cached('led' + text + on, () => {
    const W = 512, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = on ? '#160203' : '#0a0a0c';
    ctx.fillRect(0, 0, W, H);
    if (on) {
      // draw the text once, then resample it into a dot matrix
      const t = canvas(W, H), tc = t.getContext('2d');
      tc.fillStyle = '#fff'; tc.textAlign = 'center'; tc.textBaseline = 'middle';
      tc.font = `700 62px ${DIN}`;
      tc.fillText(text, W / 2, H / 2 + 2);
      const d = tc.getImageData(0, 0, W, H).data;
      const step = 7;
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          if (d[(y * W + x) * 4 + 3] > 110) {
            ctx.fillStyle = '#ff2a18';
            ctx.beginPath(); ctx.arc(x + step / 2, y + step / 2, step * 0.36, 0, 7); ctx.fill();
          }
        }
      }
    }
    return { tex: finish(c), aspect: W / H };
  });
}

/* ================================================== surfaces & vegetation */

/** Deterministic LCG, so every texture looks the same on every load. */
function srand(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

/**
 * Turn a greyscale height canvas into a tangent-space normal map.
 *
 * three.js uploads canvases with `flipY`, so +V runs *up* the canvas and the
 * V gradient is the negated row gradient — which is why ny takes +dy while
 * nx takes −dx. Get that backwards and every bump lights from the wrong side,
 * which on asphalt is invisible but on a bolt head or a panel joint is not.
 */
function normalFromHeight(hc, strength = 2.2) {
  const S = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, S, H).data;
  const out = canvas(S, H), octx = out.getContext('2d');
  const img = octx.createImageData(S, H);
  const at = (x, y) => src[((((y % H) + H) % H) * S + (((x % S) + S) % S)) * 4];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < S; x++) {
      const dx = ((at(x + 1, y) - at(x - 1, y)) / 255) * strength;
      const dy = ((at(x, y + 1) - at(x, y - 1)) / 255) * strength;
      const nx = -dx, ny = dy;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * S + x) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Greyscale copy of a canvas remapped into [lo,hi] — for roughness maps. */
function levels(src, lo, hi) {
  const S = src.width, H = src.height;
  const d = src.getContext('2d').getImageData(0, 0, S, H);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = (lo + (p[i] / 255) * (hi - lo)) * 255;
    p[i] = p[i + 1] = p[i + 2] = g; p[i + 3] = 255;
  }
  const out = canvas(S, H);
  out.getContext('2d').putImageData(d, 0, 0);
  return out;
}

/** Draw `fn` nine times so anything touching an edge wraps into the tile. */
function tiled(S, fn) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
}

/* ------------------------------------------------------------------ asphalt
   The close-range road is three aligned-but-differently-scaled maps:

   · `asphaltTex`         colour, one tile per ~3.9 m — tone, segregation,
                          bitumen streaks, oil. Too coarse to resolve a
                          chipping, and it does not try to.
   · `asphaltNormalTex`   one tile per ~1.3 m — the actual 8–14 mm chippings.
                          This is what stops the surface going to mush at 2 m.
   · `asphaltRoughTex`    same tile as the normal map, so chipping tops read
                          slightly polished and the mastic between them matt.

   Nothing lateral lives in these maps: the carriageway UV repeats 2.7× across
   its width, so wheel tracks drawn into a tile would come out 2.7 times over.
   Wheel tracks, repairs and the dusty hard shoulder are vertex colours and
   separate strips in world.js instead. */

/** Aggregate height field: chippings bedded in mastic. Tiles seamlessly. */
function asphaltHeight(S, seed) {
  const c = canvas(S, S), ctx = c.getContext('2d');
  const r = srand(seed);
  ctx.fillStyle = '#4c4c4c'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 24000; i++) {                 // mastic grain
    const g = 60 + r() * 30;
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(r() * S, r() * S, 1.6, 1.6);
  }
  for (let i = 0; i < 2300; i++) {                  // chippings
    const x = r() * S, y = r() * S;
    const rad = 2.4 + r() ** 1.8 * 6.2;
    const top = 150 + r() * 100;
    const n = 6 + Math.floor(r() * 3);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.35;
      const rr = rad * (0.66 + r() * 0.52);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    tiled(S, (ox, oy) => {
      const cx = x + ox, cy = y + oy;
      if (cx < -rad || cx > S + rad || cy < -rad || cy > S + rad) return;
      const g = ctx.createRadialGradient(cx - rad * 0.34, cy - rad * 0.34, 0, cx, cy, rad * 1.05);
      g.addColorStop(0, `rgb(${top},${top},${top})`);
      g.addColorStop(0.7, `rgb(${top - 40},${top - 40},${top - 40})`);
      g.addColorStop(1, 'rgb(52,52,52)');
      ctx.fillStyle = g;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(cx + px, cy + py) : ctx.moveTo(cx + px, cy + py)));
      ctx.closePath(); ctx.fill();
    });
  }
  return c;
}
const _asphH = () => cached('asphH', () => asphaltHeight(512, 8813));

export function asphaltTex(repeat = [1, 1]) {
  return cached('asph' + repeat.join(), () => {
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    const r = srand(4471);
    ctx.fillStyle = '#3b3d40'; ctx.fillRect(0, 0, S, S);
    // broad tonal blotches — separate paving runs, binder-rich patches
    for (let i = 0; i < 110; i++) {
      const x = r() * S, y = r() * S, rad = 34 + r() * 120, t = (r() - 0.5) * 22;
      tiled(S, (ox, oy) => {
        const cx = x + ox, cy = y + oy;
        if (cx < -rad || cx > S + rad || cy < -rad || cy > S + rad) return;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${Math.round(60 + t)},${Math.round(62 + t)},${Math.round(66 + t)},.34)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
      });
    }
    // chipping speckle — a hint of the aggregate the normal map really carries
    for (let i = 0; i < 17000; i++) {
      const g = 44 + r() ** 1.6 * 74;
      ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},${0.3 + r() * 0.5})`;
      ctx.fillRect(r() * S, r() * S, 1.4 + r() * 1.8, 1.4 + r() * 1.8);
    }
    // bitumen bleed: darker longitudinal streaks left by the paver screed
    for (let i = 0; i < 40; i++) {
      const x = r() * S, w = 2 + r() * 9;
      ctx.fillStyle = `rgba(24,25,27,${0.05 + r() * 0.11})`;
      ctx.fillRect(x, -4, w, S + 8);
      if (x + w > S) ctx.fillRect(x - S, -4, w, S + 8);
    }
    // the odd oil drop
    for (let i = 0; i < 7; i++) {
      const x = r() * S, y = r() * S, rad = 5 + r() * 13;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(14,14,16,.5)');
      g.addColorStop(1, 'rgba(14,14,16,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    }
    return finish(c, { repeat, aniso: 16 });
  });
}

/** Chippings, at ~3× the colour map's frequency. This is the close-range win. */
export function asphaltNormalTex(repeat = [3, 3]) {
  return cached('asphN' + repeat.join(), () =>
    finish(normalFromHeight(_asphH(), 2.6), { repeat, srgb: false, aniso: 16 }));
}

/** Chipping tops polished, mastic matt — free specular variation. */
export function asphaltRoughTex(repeat = [3, 3]) {
  return cached('asphR' + repeat.join(), () =>
    finish(levels(_asphH(), 1.0, 0.74), { repeat, srgb: false, aniso: 8 }));
}

/* ---------------------------------------------------------- lane markings
   Real Fahrbahnmarkierung is a 3 mm extruded thermoplastic band full of glass
   beads: slightly raised with a bevelled edge, chipped where the ploughs have
   been, grey with rubber down the middle of a wheel track. U runs across the
   band (so the worn edges land on the actual edges), V along the road. */
function markHeight(S) {
  const c = canvas(S, S), ctx = c.getContext('2d');
  const r = srand(60613);
  // raised band with a bevel in the outer 7 % of the width
  const g = ctx.createLinearGradient(0, 0, S, 0);
  g.addColorStop(0.00, '#000'); g.addColorStop(0.07, '#c8c8c8');
  g.addColorStop(0.93, '#c8c8c8'); g.addColorStop(1.00, '#000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // glass-bead grain
  for (let i = 0; i < 24000; i++) {
    const v = 150 + r() * 105;
    ctx.fillStyle = `rgba(${v},${v},${v},.55)`;
    ctx.fillRect(0.07 * S + r() * S * 0.86, r() * S, 1.5, 1.5);
  }
  // chips knocked out of the edges
  for (let i = 0; i < 90; i++) {
    const side = r() < 0.5, w = 3 + r() * 16, h = 4 + r() * 26;
    const x = side ? 0.07 * S - w * 0.4 : S * 0.93 - w * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,.85)';
    ctx.beginPath(); ctx.ellipse(x, r() * S, w, h, 0, 0, 7); ctx.fill();
  }
  // transverse hairline cracks
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = 'rgba(30,30,30,.75)'; ctx.lineWidth = 1 + r() * 1.6;
    const y = r() * S;
    ctx.beginPath(); ctx.moveTo(0.07 * S, y);
    ctx.lineTo(S * 0.93, y + (r() - 0.5) * 10); ctx.stroke();
  }
  return c;
}
const _markH = () => cached('markH', () => markHeight(512));

export function markingTex() {
  return cached('markT', () => {
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    const r = srand(9021);
    ctx.fillStyle = '#3b3d40'; ctx.fillRect(0, 0, S, S);   // asphalt showing at the edges
    ctx.fillStyle = '#eeece3';
    ctx.fillRect(S * 0.055, 0, S * 0.89, S);
    // grubby, unevenly worn paint
    for (let i = 0; i < 15000; i++) {
      const v = 196 + r() * 58;
      ctx.fillStyle = `rgba(${v},${v},${v - 4},${0.25 + r() * 0.4})`;
      ctx.fillRect(S * 0.055 + r() * S * 0.89, r() * S, 1.6, 1.6);
    }
    // rubber scuffed off the tyres, and road grime settling at the edges
    for (let i = 0; i < 34; i++) {
      ctx.fillStyle = `rgba(96,96,92,${0.06 + r() * 0.16})`;
      const w = 6 + r() * 40;
      ctx.fillRect(S * 0.055 + r() * (S * 0.89 - w), r() * S, w, 3 + r() * 30);
    }
    for (const x of [S * 0.055, S * 0.945]) {
      const g = ctx.createLinearGradient(x - S * 0.05, 0, x + S * 0.05, 0);
      g.addColorStop(0, 'rgba(70,72,74,.55)'); g.addColorStop(1, 'rgba(70,72,74,0)');
      ctx.fillStyle = g; ctx.fillRect(x - S * 0.05, 0, S * 0.1, S);
    }
    // the chips and cracks from the height field, so both maps agree
    const h = _markH().getContext('2d').getImageData(0, 0, S, S).data;
    const img = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const k = h[i] / 255;
      if (k < 0.4) {                            // a chip: asphalt shows through
        const t = 1 - k / 0.4;
        img.data[i] += (59 - img.data[i]) * t * 0.9;
        img.data[i + 1] += (61 - img.data[i + 1]) * t * 0.9;
        img.data[i + 2] += (64 - img.data[i + 2]) * t * 0.9;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { repeat: [1, 1], aniso: 16 });
  });
}
export function markingNormalTex() {
  return cached('markN', () => finish(normalFromHeight(_markH(), 3.4), { repeat: [1, 1], srgb: false, aniso: 16 }));
}
export function markingRoughTex() {
  return cached('markR', () => finish(levels(_markH(), 0.95, 0.42), { repeat: [1, 1], srgb: false, aniso: 8 }));
}

/* -------------------------------------------------------- Stahlschutzplanke
   Profil A W-beam: 311 mm deep section, 83 mm out of the post plane, three
   corrugations. Points are [depth toward the road, height about the beam
   centre], listed top to bottom; a tenth edge closes the section flat along
   the post plane. Geometry (world.js) and texture (below) are both laid out
   from this one list, so the bolt drawn in the texture lands exactly in the
   central valley of the pressing. */
export const W_BEAM = [
  [0.000, 0.1555], [0.048, 0.1330], [0.083, 0.0760], [0.083, 0.0420],
  [0.028, 0.0000], [0.083, -0.0420], [0.083, -0.0760], [0.048, -0.1330],
  [0.000, -0.1555],
];
/** The atlas: beam profile in V 0..0.72, post in V 0.78..1. */
export const BEAM_V_MAX = 0.72;
export const POST_V = [0.78, 1.0];
/** V of every profile vertex; the last entry closes the back plate. */
export const BEAM_V = (() => {
  const seg = [];
  let total = 0;
  for (let i = 0; i < W_BEAM.length; i++) {
    const a = W_BEAM[i], b = W_BEAM[(i + 1) % W_BEAM.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l); total += l;
  }
  const v = [0];
  for (let i = 0; i < seg.length; i++) v.push(v[i] + (seg[i] / total) * BEAM_V_MAX);
  return v;
})();

/** Height field for the rail atlas: bolt heads, spangle, post ribs. */
function railHeight(W, H) {
  const c = canvas(W, H), ctx = c.getContext('2d');
  const r = srand(31771);
  ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, W, H);
  const vy = (v) => v * H;
  // hot-dip spangle: big soft crystalline facets
  for (let i = 0; i < 340; i++) {
    const x = r() * W, y = r() * H, rad = 5 + r() * 26, g = 118 + r() * 60;
    tiled(W, (ox) => {
      ctx.fillStyle = `rgba(${g},${g},${g},.30)`;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * 6.283 + r() * 0.4, rr = rad * (0.6 + r() * 0.6);
        const px = x + ox + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    });
  }
  // bolt heads in the central valley, at each end of the tile (= each post)
  for (const bx of [0, W]) {
    const by = vy((BEAM_V[4] + BEAM_V[5]) / 2);
    const rad = H * 0.030;
    const g = ctx.createRadialGradient(bx - rad * 0.3, by - rad * 0.3, 0, bx, by, rad);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.68, '#d0d0d0'); g.addColorStop(1, '#3a3a3a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, rad, 0, 7); ctx.fill();
    ctx.fillStyle = '#6d6d6d';
    ctx.beginPath(); ctx.arc(bx, by, rad * 1.5, 0, 7); ctx.fill();   // washer
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, rad, 0, 7); ctx.fill();
  }
  // the overlap of one beam panel onto the next, at the post line
  for (const bx of [0, W]) {
    ctx.fillStyle = 'rgba(200,200,200,.45)';
    ctx.fillRect(bx - W * 0.012, vy(0), W * 0.024, vy(BEAM_V_MAX));
  }
  // fine along-road scratches
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(${r() < 0.5 ? 60 : 190},${r() < 0.5 ? 60 : 190},190,.2)`;
    ctx.lineWidth = 1;
    const y = r() * vy(BEAM_V_MAX), x = r() * W, l = 8 + r() * 90;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (r() - 0.5) * 2); ctx.stroke();
  }
  // post band: vertical ribs of a Sigma post
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, vy(BEAM_V_MAX), W, H - vy(BEAM_V_MAX));
  for (const [x0, x1, g] of [[0.30, 0.36, 190], [0.64, 0.70, 190], [0.46, 0.54, 60]]) {
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(x0 * W, vy(POST_V[0]), (x1 - x0) * W, H - vy(POST_V[0]));
  }
  return c;
}
const _railH = () => cached('railH', () => railHeight(512, 512));

export function railTex() {
  return cached('railT', () => {
    const W = 512, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
    const r = srand(5519);
    const vy = (v) => v * H;
    ctx.fillStyle = '#b2b8bc'; ctx.fillRect(0, 0, W, H);
    // spangle mottling of hot-dip galvanising
    for (let i = 0; i < 420; i++) {
      const x = r() * W, y = r() * H, rad = 6 + r() * 30;
      const g = 168 + r() * 46, b = g + 6;
      tiled(W, (ox) => {
        ctx.fillStyle = `rgba(${g},${g + 2},${b},${0.1 + r() * 0.22})`;
        ctx.beginPath(); ctx.arc(x + ox, y, rad, 0, 7); ctx.fill();
      });
    }
    for (let i = 0; i < 9000; i++) {
      const g = 150 + r() * 80;
      ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},.22)`;
      ctx.fillRect(r() * W, r() * H, 2, 2);
    }
    /* Ambient occlusion of the pressing: the two crests catch the sky, the
       valley and the return lips sit in shade. Baked, because a 20 cm deep
       section never gets a shadow map of its own. */
    for (const [v0, v1, a] of [[BEAM_V[0], BEAM_V[1], -0.14], [BEAM_V[3], BEAM_V[5], -0.20],
                               [BEAM_V[7], BEAM_V[8], -0.16], [BEAM_V[8], BEAM_V[9], -0.10]]) {
      ctx.fillStyle = `rgba(40,44,48,${-a})`;
      ctx.fillRect(0, vy(v0), W, vy(v1) - vy(v0));
    }
    // grime thrown up off the road: worst along the bottom of the pressing
    const grime = ctx.createLinearGradient(0, vy(BEAM_V[6]), 0, vy(BEAM_V[9]));
    grime.addColorStop(0, 'rgba(74,66,54,0)');
    grime.addColorStop(0.55, 'rgba(74,66,54,.34)');
    grime.addColorStop(1, 'rgba(58,52,44,.5)');
    ctx.fillStyle = grime; ctx.fillRect(0, vy(BEAM_V[6]), W, vy(BEAM_V[9]) - vy(BEAM_V[6]));
    for (let i = 0; i < 900; i++) {                    // mud splatter
      const v = BEAM_V[5] + r() ** 0.6 * (BEAM_V[9] - BEAM_V[5]);
      ctx.fillStyle = `rgba(${58 + r() * 30},${50 + r() * 26},${40 + r() * 22},${0.2 + r() * 0.5})`;
      ctx.beginPath(); ctx.arc(r() * W, vy(v), 0.8 + r() * 2.6, 0, 7); ctx.fill();
    }
    // rust weeping from the bolt, and the bolt itself
    for (const bx of [0, W]) {
      const by = vy((BEAM_V[4] + BEAM_V[5]) / 2);
      const rad = H * 0.030;
      ctx.fillStyle = 'rgba(126,84,48,.30)';
      ctx.beginPath(); ctx.ellipse(bx, by + rad * 2.6, rad * 1.5, rad * 3.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#9aa0a4';
      ctx.beginPath(); ctx.arc(bx, by, rad * 1.5, 0, 7); ctx.fill();
      const g = ctx.createRadialGradient(bx - rad * 0.4, by - rad * 0.4, 0, bx, by, rad);
      g.addColorStop(0, '#e2e6e8'); g.addColorStop(1, '#7d8388');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, rad, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(50,54,58,.8)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(bx, by, rad * 0.55, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(150,156,160,.9)';           // panel overlap edge
      ctx.fillRect(bx - W * 0.010, vy(0), W * 0.020, vy(BEAM_V_MAX));
      ctx.fillStyle = 'rgba(60,64,68,.35)';
      ctx.fillRect(bx + W * 0.010, vy(0), W * 0.006, vy(BEAM_V_MAX));
    }
    // the post band, dirtier and darker toward its foot
    ctx.fillStyle = '#9ca2a6';
    ctx.fillRect(0, vy(BEAM_V_MAX), W, H - vy(BEAM_V_MAX));
    for (let i = 0; i < 3500; i++) {
      const g = 130 + r() * 80;
      ctx.fillStyle = `rgba(${g},${g + 2},${g + 5},.3)`;
      ctx.fillRect(r() * W, vy(BEAM_V_MAX) + r() * (H - vy(BEAM_V_MAX)), 2, 2);
    }
    const pg = ctx.createLinearGradient(0, vy(POST_V[0]), 0, H);
    pg.addColorStop(0, 'rgba(70,64,52,.10)');
    pg.addColorStop(0.6, 'rgba(66,60,48,.34)');
    pg.addColorStop(1, 'rgba(44,40,32,.72)');
    ctx.fillStyle = pg; ctx.fillRect(0, vy(POST_V[0]), W, H - vy(POST_V[0]));
    for (const [x0, x1, a] of [[0.0, 0.30, 0.22], [0.36, 0.46, 0.16], [0.54, 0.64, 0.16], [0.70, 1.0, 0.22]]) {
      ctx.fillStyle = `rgba(48,52,56,${a})`;
      ctx.fillRect(x0 * W, vy(POST_V[0]), (x1 - x0) * W, H - vy(POST_V[0]));
    }
    return finish(c, { repeat: [1, 1], aniso: 16 });
  });
}
export function railNormalTex() {
  return cached('railN', () => finish(normalFromHeight(_railH(), 2.4), { repeat: [1, 1], srgb: false, aniso: 16 }));
}

/* --------------------------------------------------------- grass and verge
   The terrain is vertex-coloured per biome, so its map has to be a neutral
   *modulation* around 1.0 — anything with colour in it fights the palette. */
function grassHeight(S) {
  const c = canvas(S, S), ctx = c.getContext('2d');
  const r = srand(77213);
  ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5200; i++) {              // blade clumps
    const x = r() * S, y = r() * S, len = 5 + r() * 15, a = r() * 6.283;
    const g = 100 + r() * 130;
    tiled(S, (ox, oy) => {
      ctx.strokeStyle = `rgba(${g},${g},${g},.6)`;
      ctx.lineWidth = 1 + r() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len * 0.6);
      ctx.stroke();
    });
  }
  for (let i = 0; i < 260; i++) {               // tussocks
    const x = r() * S, y = r() * S, rad = 4 + r() * 16;
    tiled(S, (ox, oy) => {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      g.addColorStop(0, 'rgba(210,210,210,.5)');
      g.addColorStop(1, 'rgba(210,210,210,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, rad, 0, 7); ctx.fill();
    });
  }
  return c;
}
const _grassH = () => cached('grassH', () => grassHeight(512));

/** Neutral grass modulation: multiplies the biome vertex colour. */
export function grassTex(repeat = [1, 1]) {
  return cached('grassT' + repeat.join(), () => {
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    const r = srand(1201);
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 240; i++) {             // patchiness
      const x = r() * S, y = r() * S, rad = 18 + r() * 74;
      const v = r() < 0.5 ? 200 : 255;
      tiled(S, (ox, oy) => {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        g.addColorStop(0, `rgba(${v},${v},${v - 6},.3)`);
        g.addColorStop(1, `rgba(${v},${v},${v - 6},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x + ox, y + oy, rad, 0, 7); ctx.fill();
      });
    }
    for (let i = 0; i < 9000; i++) {            // blade speckle
      const v = r() < 0.42 ? 176 + r() * 40 : 244 + r() * 11;
      ctx.fillStyle = `rgba(${v},${v + 3},${v - 6},${0.3 + r() * 0.45})`;
      const len = 2 + r() * 5;
      ctx.fillRect(r() * S, r() * S, 1.5, len);
    }
    for (let i = 0; i < 40; i++) {              // bare earth
      const x = r() * S, y = r() * S, rad = 3 + r() * 11;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(196,178,150,.55)');
      g.addColorStop(1, 'rgba(196,178,150,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    }
    return finish(c, { repeat, aniso: 8 });
  });
}
export function grassNormalTex(repeat = [1, 1]) {
  return cached('grassN' + repeat.join(), () =>
    finish(normalFromHeight(_grassH(), 1.5), { repeat, srgb: false, aniso: 8 }));
}

/** Alpha-cut grass tuft for the cross-billboards along the verge. */
export function tuftTex() {
  return cached('tuft', () => {
    const W = 256, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    const r = srand(4242);
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < 74; i++) {
      const x0 = W * 0.5 + (r() - 0.5) * W * 0.86;
      const h = H * (0.30 + r() ** 1.3 * 0.68);
      const lean = (r() - 0.5) * W * 0.16;
      const wid = 1.6 + r() * 2.8;
      const g = 92 + r() * 74, br = 26 + r() * 34;
      ctx.fillStyle = `rgb(${br + (r() < 0.16 ? 60 : 0)},${g},${38 + r() * 26})`;
      ctx.beginPath();
      ctx.moveTo(x0 - wid, H);
      ctx.quadraticCurveTo(x0 - wid * 0.4 + lean * 0.5, H - h * 0.6, x0 + lean, H - h);
      ctx.quadraticCurveTo(x0 + wid * 0.5 + lean * 0.5, H - h * 0.6, x0 + wid, H);
      ctx.closePath(); ctx.fill();
    }
    // darker at the base, where a tuft is thatch rather than blades
    const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
    g.addColorStop(0, 'rgba(28,36,20,0)'); g.addColorStop(1, 'rgba(28,36,20,.65)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.6, W, H * 0.4);
    return finish(c, { aniso: 4 });
  });
}

/* ------------------------------------------------------ concrete & walls */

/** Board-marked in-situ concrete: parapets, piers, Baustelle barriers. */
export function concreteTex(repeat = [1, 1]) {
  return cached('conc' + repeat.join(), () => {
    const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
    const r = srand(3307);
    ctx.fillStyle = '#bcb9b1'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const v = 168 + r() * 46;
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 8},.3)`;
      ctx.fillRect(r() * S, r() * S, 2, 2);
    }
    for (let i = 0; i < 80; i++) {                 // blotchy curing
      const x = r() * S, y = r() * S, rad = 10 + r() * 50, v = r() < 0.5 ? 150 : 210;
      tiled(S, (ox, oy) => {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        g.addColorStop(0, `rgba(${v},${v - 2},${v - 8},.22)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x + ox, y + oy, rad, 0, 7); ctx.fill();
      });
    }
    for (let y = 0; y < S; y += S / 4) {           // formwork board joints
      ctx.fillStyle = 'rgba(126,122,114,.5)'; ctx.fillRect(0, y, S, 1.6);
      ctx.fillStyle = 'rgba(226,224,218,.35)'; ctx.fillRect(0, y + 1.6, S, 1.2);
    }
    for (let i = 0; i < 6; i++) {                  // tie-rod plugs
      ctx.fillStyle = 'rgba(140,136,128,.6)';
      ctx.beginPath(); ctx.arc(r() * S, r() * S, 2.5 + r() * 2, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 22; i++) {                 // rain streaks
      ctx.fillStyle = `rgba(122,120,112,${0.05 + r() * 0.1})`;
      ctx.fillRect(r() * S, 0, 1 + r() * 5, S);
    }
    return finish(c, { repeat, aniso: 8 });
  });
}
export function concreteNormalTex(repeat = [1, 1]) {
  return cached('concN' + repeat.join(), () => {
    const S = 256, hc = canvas(S, S), ctx = hc.getContext('2d');
    const r = srand(3307);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 14000; i++) {
      const v = 108 + r() * 40;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * S, r() * S, 2, 2);
    }
    for (let y = 0; y < S; y += S / 4) {
      ctx.fillStyle = '#4a4a4a'; ctx.fillRect(0, y, S, 1.8);
      ctx.fillStyle = '#c0c0c0'; ctx.fillRect(0, y + 1.8, S, 1.4);
    }
    return finish(normalFromHeight(hc, 1.6), { repeat, srgb: false, aniso: 8 });
  });
}

/**
 * Lärmschutzwand. Precast concrete panels stacked between steel posts:
 * V = 0 is the coping at the top, V = 1 the grubby foot, U one 4 m bay.
 * The old wall reused `facadeTex`, which meant the noise barriers along the
 * Stuttgart basin had rows of lit office windows in them.
 */
function noiseWallHeight(W, H) {
  const c = canvas(W, H), ctx = c.getContext('2d');
  const r = srand(8123);
  ctx.fillStyle = '#8c8c8c'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c4c4c4'; ctx.fillRect(0, 0, W, H * 0.055);          // coping
  ctx.fillStyle = '#3c3c3c'; ctx.fillRect(0, H * 0.055, W, H * 0.016);
  for (let i = 1; i < 6; i++) {                                          // panel joints
    const y = H * 0.07 + (i / 6) * H * 0.93;
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, y, W, H * 0.012);
    ctx.fillStyle = '#aaaaaa'; ctx.fillRect(0, y + H * 0.012, W, H * 0.008);
  }
  for (let i = 0; i < 16000; i++) {                                      // aggregate
    const v = 116 + r() * 38;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(r() * W, r() * H, 2, 2);
  }
  return c;
}
const _wallH = () => cached('wallH', () => noiseWallHeight(256, 512));

export function noiseWallTex() {
  return cached('nwall', () => {
    const W = 256, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
    const r = srand(2266);
    ctx.fillStyle = '#a9a7a0'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 12000; i++) {
      const v = 150 + r() * 46;
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 8},.32)`;
      ctx.fillRect(r() * W, r() * H, 2, 2);
    }
    // panels alternate very slightly in tone, as precast units do
    for (let i = 0; i < 6; i++) {
      const y0 = H * 0.07 + (i / 6) * H * 0.93, y1 = H * 0.07 + ((i + 1) / 6) * H * 0.93;
      ctx.fillStyle = `rgba(${r() < 0.5 ? 255 : 120},${r() < 0.5 ? 255 : 120},120,${0.03 + r() * 0.05})`;
      ctx.fillRect(0, y0, W, y1 - y0);
      ctx.fillStyle = 'rgba(96,94,88,.55)'; ctx.fillRect(0, y0, W, 3);
      ctx.fillStyle = 'rgba(232,230,224,.3)'; ctx.fillRect(0, y0 + 3, W, 2);
    }
    ctx.fillStyle = '#c2bfb7'; ctx.fillRect(0, 0, W, H * 0.055);          // coping
    ctx.fillStyle = 'rgba(70,68,62,.6)'; ctx.fillRect(0, H * 0.055, W, 5);
    // weathering: streaks off the coping, algae and spray at the foot
    for (let i = 0; i < 60; i++) {
      const x = r() * W, w = 1 + r() * 7;
      const g = ctx.createLinearGradient(0, H * 0.06, 0, H * (0.3 + r() * 0.6));
      g.addColorStop(0, `rgba(96,94,86,${0.12 + r() * 0.2})`);
      g.addColorStop(1, 'rgba(96,94,86,0)');
      ctx.fillStyle = g; ctx.fillRect(x, H * 0.06, w, H);
    }
    const foot = ctx.createLinearGradient(0, H * 0.72, 0, H);
    foot.addColorStop(0, 'rgba(74,72,58,0)');
    foot.addColorStop(1, 'rgba(60,60,46,.5)');
    ctx.fillStyle = foot; ctx.fillRect(0, H * 0.72, W, H * 0.28);
    for (let i = 0; i < 700; i++) {
      const y = H * (0.78 + r() ** 0.5 * 0.22);
      ctx.fillStyle = `rgba(${64 + r() * 26},${58 + r() * 24},${44 + r() * 20},${0.2 + r() * 0.4})`;
      ctx.beginPath(); ctx.arc(r() * W, y, 0.8 + r() * 2, 0, 7); ctx.fill();
    }
    return finish(c, { repeat: [1, 1], aniso: 16 });
  });
}
export function noiseWallNormalTex() {
  return cached('nwallN', () => finish(normalFromHeight(_wallH(), 2.6), { repeat: [1, 1], srgb: false, aniso: 16 }));
}

/**
 * Engelbergtunnel lining. U runs right across the arch (0 and 1 are the two
 * wall bases at road level), V one 9 m ring along the bore — so the grubby
 * plinth, the painted band and the ring joints can all be baked in place.
 */
export function tunnelLiningTex() {
  return cached('tunlin', () => {
    const W = 1024, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
    const r = srand(6631);
    ctx.fillStyle = '#b4b1a9'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 22000; i++) {
      const v = 156 + r() * 48;
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 8},.28)`;
      ctx.fillRect(r() * W, r() * H, 2, 2);
    }
    // the crown is painted light; the walls carry a washable panel band
    const band = ctx.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0.00, 'rgba(120,116,108,.55)');
    band.addColorStop(0.09, 'rgba(226,224,216,.35)');
    band.addColorStop(0.30, 'rgba(238,236,228,.30)');
    band.addColorStop(0.70, 'rgba(238,236,228,.30)');
    band.addColorStop(0.91, 'rgba(226,224,216,.35)');
    band.addColorStop(1.00, 'rgba(120,116,108,.55)');
    ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
    // soot and spray on the wall bases
    for (const [x0, x1] of [[0, W * 0.10], [W * 0.90, W]]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      const inner = x0 === 0 ? 1 : 0;
      g.addColorStop(inner, 'rgba(44,42,38,.62)');
      g.addColorStop(1 - inner, 'rgba(44,42,38,0)');
      ctx.fillStyle = g; ctx.fillRect(x0, 0, x1 - x0, H);
    }
    // ring joint at the tile edge, plus a longitudinal construction joint
    ctx.fillStyle = 'rgba(66,64,58,.65)'; ctx.fillRect(0, 0, W, 4);
    ctx.fillStyle = 'rgba(228,226,218,.3)'; ctx.fillRect(0, 4, W, 2);
    for (const x of [W * 0.14, W * 0.86]) {
      ctx.fillStyle = 'rgba(72,70,64,.5)'; ctx.fillRect(x, 0, 3, H);
    }
    for (let i = 0; i < 40; i++) {                  // grime streaks
      ctx.fillStyle = `rgba(84,80,72,${0.04 + r() * 0.09})`;
      ctx.fillRect(r() * W, 0, 2 + r() * 12, H);
    }
    return finish(c, { repeat: [1, 1], aniso: 16 });
  });
}

export function groundTex(base, spot, density = 6000, repeat = [60, 60]) {
  return cached('gnd' + base + spot + density + repeat.join(), () => {
    const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < density; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? spot : base;
      ctx.globalAlpha = 0.15 + Math.random() * 0.5;
      ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
    ctx.globalAlpha = 1;
    return finish(c, { repeat });
  });
}

/** Soft round blob used as a contact shadow under every vehicle. */
export function shadowTex() {
  return cached('shadow', () => {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return finish(c, { srgb: false });
  });
}

/** Additive glow blob, used to make a headlamp flash actually visible. */
export function glowTex() {
  return cached('glow', () => {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,252,236,1)');
    g.addColorStop(0.22, 'rgba(255,246,214,.72)');
    g.addColorStop(0.55, 'rgba(255,240,190,.20)');
    g.addColorStop(1.00, 'rgba(255,235,170,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return finish(c);
  });
}

/** Billboard for distant spruce — Schwarzwald filler. */
export function spruceTex() {
  return cached('spruce', () => {
    const W = 128, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#3b2a1c';
    ctx.fillRect(W / 2 - 5, H - 46, 10, 46);
    for (let tier = 0; tier < 9; tier++) {
      const t = tier / 8;
      const y = 18 + t * (H - 90);
      const halfW = 10 + t * 50;
      const g = 44 + tier * 5;
      ctx.fillStyle = `rgb(${18 + tier * 2},${g},${28 + tier * 3})`;
      ctx.beginPath();
      ctx.moveTo(W / 2, y - 26);
      ctx.lineTo(W / 2 + halfW, y + 30);
      ctx.lineTo(W / 2 + halfW * 0.35, y + 24);
      ctx.lineTo(W / 2, y + 40);
      ctx.lineTo(W / 2 - halfW * 0.35, y + 24);
      ctx.lineTo(W / 2 - halfW, y + 30);
      ctx.closePath(); ctx.fill();
    }
    return { tex: finish(c), aspect: W / H };
  });
}

/** Broadleaf blob for the Neckar valley and village edges. */
export function leafTex() {
  return cached('leaf', () => {
    const S = 192, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#41301f';
    ctx.fillRect(S / 2 - 7, S * 0.62, 14, S * 0.38);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() ** 0.6 * S * 0.34;
      const x = S / 2 + Math.cos(a) * r, y = S * 0.42 + Math.sin(a) * r * 0.82;
      const g = 70 + Math.random() * 60;
      ctx.fillStyle = `rgba(${28 + Math.random() * 30},${g},${34 + Math.random() * 26},.95)`;
      ctx.beginPath(); ctx.arc(x, y, 12 + Math.random() * 20, 0, 7); ctx.fill();
    }
    return { tex: finish(c), aspect: 1 };
  });
}

/** Windowed façade strip for industrial halls and village houses. */
export function facadeTex(base, win, rows = 3, cols = 10) {
  return cached('fac' + base + win + rows + cols, () => {
    const W = 256, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = 'rgba(0,0,0,.05)';
      ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
    }
    const pw = W / cols, ph = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        if (Math.random() < 0.12) continue;
        ctx.fillStyle = win;
        ctx.globalAlpha = 0.6 + Math.random() * 0.4;
        ctx.fillRect(k * pw + pw * 0.18, r * ph + ph * 0.22, pw * 0.64, ph * 0.42);
      }
    }
    ctx.globalAlpha = 1;
    return finish(c, { repeat: [1, 1] });
  });
}

/** Sky gradient used on a large sphere — hazy Swabian summer afternoon. */
export function skyTex() {
  return cached('sky', () => {
    const W = 32, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.00, '#1d4a86');
    g.addColorStop(0.30, '#5b95cf');
    g.addColorStop(0.52, '#9dc4e4');
    g.addColorStop(0.66, '#cfdfe9');
    g.addColorStop(0.78, '#dfe6e6');
    g.addColorStop(1.00, '#b9c3c2');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    return finish(c);
  });
}
