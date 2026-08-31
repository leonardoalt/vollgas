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

export function asphaltTex(repeat = [1, 400]) {
  return cached('asph' + repeat.join(), () => {
    const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#3b3d40'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const g = 30 + Math.random() * 55;
      ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},${0.25 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    // faint longitudinal tyre polishing in the wheel tracks
    const grad = ctx.createLinearGradient(0, 0, S, 0);
    grad.addColorStop(0.00, 'rgba(0,0,0,0)');
    grad.addColorStop(0.28, 'rgba(20,20,22,.07)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.74, 'rgba(20,20,22,.07)');
    grad.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
    return finish(c, { repeat });
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
