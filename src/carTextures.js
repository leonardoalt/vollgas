/* ==========================================================================
   carTextures.js — canvas textures that exist only to make the cars read as
   cars. Nothing here is loaded; it is all drawn at startup.

   The important one is `bodyDetail`. The lofted hull has a completely regular
   parameterisation — u runs once around the cross-section, v runs from the
   tail (0) to the nose (1) — which means panel gaps can be *drawn* in UV space
   instead of modelled. Door shut lines, the bonnet and boot lid outlines and
   the sill shadow are the difference between "a car-shaped solid" and "a car",
   and they cost one texture per body style rather than a single triangle.

   Everything else is small: a flake/orange-peel normal for the clearcoat, a
   tyre tread normal, and a contact shadow that is car-shaped instead of a
   circle in a rectangle.
   ========================================================================== */
import * as THREE from 'three';

const _cache = new Map();
const cached = (k, f) => { if (!_cache.has(k)) _cache.set(k, f()); return _cache.get(k); };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, { srgb = false, repeat = null, wrap = THREE.ClampToEdgeWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* ===================================================== body detail maps ==
   Two canvases off one drawing pass:
     albedo — white panels, dark gaps, soft AO. Multiplies the paint colour.
     rough  — panels glassy, gaps and sills matt, plus large-scale blotching
              so a panel is not perfectly uniform.                          */
export function bodyDetail(o) {
  const key = 'body|' + JSON.stringify([o.sec, o.lines, o.cabin, o.belt, o.arch]);
  return cached(key, () => {
    const W = 512, H = 512;
    const { nB, nS, nG, nR } = o.sec;
    const P = nB + (nS - 1) + (nG - 1) + (nR - 1) + (nG - 1) + (nS - 2);
    // region boundaries in u (see section() in carFactory.js)
    const b1 = (nB - 1) / P;                          // floor  | right flank
    const b2 = (nB + nS - 2) / P;                     // flank  | right glasshouse
    const b3 = (nB + nS + nG - 3) / P;                // glass  | top
    const b4 = (nB + nS + nG + nR - 4) / P;           // top    | left glasshouse
    const b5 = (nB + nS + 2 * nG + nR - 5) / P;       // glass  | left flank

    const ca = canvas(W, H), cr = canvas(W, H);
    const A = ca.getContext('2d'), R = cr.getContext('2d');
    A.fillStyle = '#ffffff'; A.fillRect(0, 0, W, H);
    R.fillStyle = '#6b6b6b'; R.fillRect(0, 0, W, H);   // 0.42 -> glossy panel

    const X = (u) => u * W;
    const Y = (v) => (1 - v) * H;   // v=1 (nose) at the top of the canvas

    /* ---- large-scale roughness blotching: clearcoat is never uniform */
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = 26 + Math.random() * 90;
      const g = R.createRadialGradient(x, y, 0, x, y, r);
      const v = 0.5 + Math.random() * 0.5;
      g.addColorStop(0, `rgba(255,255,255,${0.05 * v})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      R.fillStyle = g; R.fillRect(x - r, y - r, 2 * r, 2 * r);
    }

    /* ---- underbody: nobody should see it, but if they do it is not paint */
    A.fillStyle = '#2b2b2b'; A.fillRect(0, 0, X(b1) + 1, H);
    A.fillRect(X(b5) + (1 - b5) * W * 0.72, 0, W, H);
    R.fillStyle = '#d8d8d8'; R.fillRect(0, 0, X(b1) + 1, H);

    /* ---- sill shading: the bottom of a flank is always in shadow */
    for (const [u0, u1] of [[b1, b2], [b5, 1]]) {
      const flip = u0 === b1;
      const g = A.createLinearGradient(X(u0), 0, X(u0 + (u1 - u0) * 0.42), 0);
      g.addColorStop(0, 'rgba(0,0,0,0.42)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      A.fillStyle = g;
      if (flip) A.fillRect(X(u0), 0, (u1 - u0) * W * 0.42, H);
      else {
        // mirrored: the sill is at the *end* of the left flank span
        const g2 = A.createLinearGradient(X(1), 0, X(1 - (u1 - u0) * 0.42), 0);
        g2.addColorStop(0, 'rgba(0,0,0,0.42)');
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        A.fillStyle = g2;
        A.fillRect(X(1 - (u1 - u0) * 0.42), 0, (u1 - u0) * W * 0.42, H);
      }
    }

    /* ---- a shut line: dark core with a lit lip on one side, which is what a
       real panel gap looks like and what makes it survive being mip-mapped. */
    const gap = (x0, y0, x1, y1, strength = 1) => {
      const horiz = Math.abs(x1 - x0) > Math.abs(y1 - y0);
      const wide = 3.0 * strength;
      A.save();
      A.lineCap = 'butt';
      // lit lip, offset half a pixel towards the nose / towards centre
      A.strokeStyle = `rgba(255,255,255,${0.30 * strength})`;
      A.lineWidth = wide * 0.9;
      A.beginPath();
      A.moveTo(x0 + (horiz ? 0 : 2.2), y0 + (horiz ? 2.2 : 0));
      A.lineTo(x1 + (horiz ? 0 : 2.2), y1 + (horiz ? 2.2 : 0));
      A.stroke();
      A.strokeStyle = `rgba(0,0,0,${0.86 * strength})`;
      A.lineWidth = wide;
      A.beginPath(); A.moveTo(x0, y0); A.lineTo(x1, y1); A.stroke();
      A.restore();
      R.save();
      R.strokeStyle = `rgba(255,255,255,${0.85 * strength})`;
      R.lineWidth = wide * 1.4;
      R.beginPath(); R.moveTo(x0, y0); R.lineTo(x1, y1); R.stroke();
      R.restore();
    };

    /* ---- door shut lines, both sides, sill to roof edge */
    for (const v of o.lines) {
      gap(X(b1 + 0.010), Y(v), X(b3), Y(v));
      gap(X(b4), Y(v), X(1 - 0.010), Y(v));
    }

    /* ---- bonnet: two longitudinal lines plus the leading edge */
    const [c0, c1] = o.cabin;
    const bonnetV0 = Math.min(0.96, c1 + 0.010), bonnetV1 = 0.955;
    if (bonnetV1 > bonnetV0 + 0.02) {
      for (const f of [0.17, 0.83]) {
        const u = b3 + (b4 - b3) * f;
        gap(X(u), Y(bonnetV0), X(u), Y(bonnetV1), 0.85);
      }
      gap(X(b3 + (b4 - b3) * 0.17), Y(bonnetV0), X(b3 + (b4 - b3) * 0.83), Y(bonnetV0), 0.85);
    }
    /* ---- boot lid, only where there is a boot to have a lid */
    if (c0 > 0.11) {
      const v0 = 0.055, v1 = c0 - 0.012;
      for (const f of [0.16, 0.84]) {
        const u = b3 + (b4 - b3) * f;
        gap(X(u), Y(v0), X(u), Y(v1), 0.8);
      }
      gap(X(b3 + (b4 - b3) * 0.16), Y(v1), X(b3 + (b4 - b3) * 0.84), Y(v1), 0.8);
    } else {
      // hatch / estate tailgate: one line across the roof just ahead of the glass
      gap(X(b3), Y(0.045), X(b4), Y(0.045), 0.7);
    }

    /* ---- shoulder crease down the flank, and the beltline join */
    for (const u of [b2 - (b2 - b1) * 0.18, b2]) {
      const g = A.createLinearGradient(X(u) - 3, 0, X(u) + 3, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.17)');
      g.addColorStop(1, 'rgba(255,255,255,0.16)');
      A.fillStyle = g; A.fillRect(X(u) - 3, Y(0.95), 6, H * 0.9);
    }
    for (const u of [b5, b5 + (1 - b5) * 0.18]) {
      const g = A.createLinearGradient(X(u) - 3, 0, X(u) + 3, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.17)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      A.fillStyle = g; A.fillRect(X(u) - 3, Y(0.95), 6, H * 0.9);
    }

    /* ---- soft ambient darkening into the wheel arch tops and under the tail */
    const ao = A.createLinearGradient(0, Y(0.02), 0, Y(0.10));
    ao.addColorStop(0, 'rgba(0,0,0,0.22)');
    ao.addColorStop(1, 'rgba(0,0,0,0)');
    A.fillStyle = ao; A.fillRect(X(b1), Y(0.10), (b5 - b1) * W, H * 0.08);

    return {
      albedo: tex(ca, { srgb: true }),
      rough: tex(cr),
    };
  });
}

/* ======================================================= flake / peel ==
   Metallic paint has two scales of detail: a very fine sparkle in the
   basecoat, and a slow ripple in the clearcoat ("orange peel"). Both are
   nearly invisible on their own and together they stop panels looking like
   perfect mathematical surfaces. */
export function flakeNormal() {
  return cached('flake', () => {
    const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    // height field: fine speckle over a slow ripple
    const hf = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const peel = Math.sin(x * 0.19 + Math.sin(y * 0.11) * 2.3) * Math.sin(y * 0.17 + 1.7);
        hf[y * S + x] = peel * 0.35 + (Math.random() - 0.5) * 1.0;
      }
    }
    const at = (x, y) => hf[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = at(x + 1, y) - at(x - 1, y);
        const dy = at(x, y + 1) - at(x, y - 1);
        const o = (y * S + x) * 4;
        d[o] = Math.max(0, Math.min(255, 128 - dx * 26));
        d[o + 1] = Math.max(0, Math.min(255, 128 - dy * 26));
        d[o + 2] = 255;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = tex(c, { wrap: THREE.RepeatWrapping });
    t.repeat.set(1, 1);
    return t;
  });
}

/* ============================================================== tyres ==
   A tyre with no tread reads as a black doughnut. Circumferential grooves and
   lateral blocks in a normal map cost nothing and catch the sun. */
export function tyreNormal() {
  return cached('tyre', () => {
    const W = 128, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    const hf = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        let h = 0;
        // two circumferential grooves across the tread band
        for (const gv of [0.34, 0.66]) h -= Math.exp(-((v - gv) / 0.045) ** 2) * 1.0;
        // lateral blocks, staggered either side of the centre rib
        const rowPhase = v < 0.5 ? 0 : 0.5;
        const bu = ((u * 9 + rowPhase) % 1);
        h -= Math.exp(-((bu - 0.5) / 0.09) ** 2) * 0.65;
        // shoulder lugs
        if (v < 0.14 || v > 0.86) h -= (((u * 26) % 1) < 0.42 ? 0.5 : 0);
        h += (Math.random() - 0.5) * 0.10;
        hf[y * W + x] = h;
      }
    }
    const img = ctx.createImageData(W, H), d = img.data;
    const at = (x, y) => hf[((y + H) % H) * W + ((x + W) % W)];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = at(x + 1, y) - at(x - 1, y);
        const dy = at(x, y + 1) - at(x, y - 1);
        const o = (y * W + x) * 4;
        d[o] = Math.max(0, Math.min(255, 128 - dx * 92));
        d[o + 1] = Math.max(0, Math.min(255, 128 - dy * 92));
        d[o + 2] = 240;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return tex(c, { wrap: THREE.RepeatWrapping });
  });
}

/* ==================================================== contact shadow ==
   The old one was a radial gradient on a rectangle, so a car sat on a visible
   circle. This is car-shaped: an elongated ellipse with the ends falling away
   and a darker core under each axle. */
export function contactShadow() {
  return cached('contact', () => {
    const W = 128, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const paint = (cx, cy, rx, ry, a0) => {
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0.00, `rgba(0,0,0,${a0})`);
      g.addColorStop(0.45, `rgba(0,0,0,${a0 * 0.62})`);
      g.addColorStop(0.80, `rgba(0,0,0,${a0 * 0.16})`);
      g.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    // body umbra
    paint(W / 2, H / 2, W * 0.40, H * 0.40, 0.52);
    // axles
    paint(W / 2, H * 0.255, W * 0.44, H * 0.115, 0.42);
    paint(W / 2, H * 0.745, W * 0.44, H * 0.115, 0.42);
    return tex(c);
  });
}
