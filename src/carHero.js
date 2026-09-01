/* ==========================================================================
   carHero.js — the still photograph in the car-select panel.

   The menu has always shown live renders of the actual cars, which is the
   honest thing to do and sidesteps the licensing question entirely. Where we
   have a real photograph of the car, though, a still beats a turntable for
   *selling* it — so the 911 gets the photo as its hero image and a FOTO / 3D
   toggle to drop back to the live model.

   All four player cars have one. A car with no photo falls through to the
   turntable with no toggle shown, rather than pretending there is a photo.

   The images are imported, so Vite hashes and emits them and
   `dev/build-artifact` can inline them into the single-file build. An import
   yields a *URL*, not bytes — the fetch happens when the img is mounted, so
   only the selected car's photo is ever downloaded and none of them delay
   first paint.
   ========================================================================== */
import turboHero from './assets/turbo-hero.webp';
import m5Hero from './assets/m5-hero.webp';
import rs6Hero from './assets/rs6-hero.webp';
import amgHero from './assets/amg-hero.webp';

/**
 * `paint` is the body colour of the car in the photograph. It is also the
 * first entry in that car's paint list, so the car you drive is the car in the
 * picture — a red car sitting next to a blue photograph would just look like a
 * mistake.
 */
export const HERO = {
  turbo: { src: turboHero, paint: 0x0e1013 },
  m5: { src: m5Hero, paint: 0x9d1016 },
  rs6: { src: rs6Hero, paint: 0x1e3d78 },
  amg: { src: amgHero, paint: 0xb4b8bd },
};

const BAR = 'position:absolute;left:8px;bottom:7px;z-index:3;display:flex;gap:4px;';
const BTN = 'font:600 9px/1 inherit;letter-spacing:.10em;padding:4px 7px;'
  + 'border-radius:3px;cursor:pointer;border:1px solid rgba(255,255,255,.18);'
  + 'background:rgba(8,11,15,.55);color:#cfd8e2;';

/**
 * Show either the still or the turntable inside `stage`.
 *
 * Hiding the canvas with display:none is deliberate: the caller's render loop
 * already skips the turntable when its canvas has no layout width, so the
 * second WebGL context stops doing work with no extra wiring.
 *
 * @returns true if a still is being shown.
 */
export function mountHero(stage, canvas, id, showPhoto = false) {
  if (!stage || !canvas) return false;
  const hero = HERO[id];
  let img = stage.querySelector('.car-hero-img');
  let bar = stage.querySelector('.car-hero-tabs');

  if (!hero) {
    if (img) img.style.display = 'none';
    if (bar) bar.style.display = 'none';
    canvas.style.display = '';
    return false;
  }

  if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

  if (!img) {
    img = document.createElement('img');
    img.className = 'car-hero-img';
    img.alt = '';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
      + 'object-fit:cover;display:block;z-index:1;';
    stage.appendChild(img);
  }
  if (img.getAttribute('src') !== hero.src) img.src = hero.src;

  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'car-hero-tabs';
    bar.style.cssText = BAR;
    const mk = (label, photo) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = BTN;
      b.onclick = (e) => {
        e.stopPropagation();
        mountHero(stage, canvas, id, photo);
      };
      return b;
    };
    bar.appendChild(mk('FOTO', true));
    bar.appendChild(mk('3D', false));
    stage.appendChild(bar);
  }
  bar.style.display = '';

  const tabs = bar.children;
  tabs[0].style.opacity = showPhoto ? '1' : '0.55';
  tabs[1].style.opacity = showPhoto ? '0.55' : '1';

  img.style.display = showPhoto ? 'block' : 'none';
  canvas.style.display = showPhoto ? 'none' : '';
  return showPhoto;
}
