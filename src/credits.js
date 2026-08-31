/* ==========================================================================
   credits.js — the attribution line in the menu.

   The car bodies are CC-BY-4.0. That licence is not a formality: it requires
   the author to be credited wherever the work is shared, which for a game
   means visibly in the game and not only in a file on GitHub. So the credit
   goes in the menu footer, and the full text with source URLs and licence
   links lives in CREDITS.md.

   If the models fail to load the line still shows, because the licence terms
   apply to what we redistribute, not to what happened to render.
   ========================================================================== */

import { lang } from './i18n.js';

/** One entry per third-party work we redistribute. */
export const ATTRIBUTIONS = [
  {
    title: 'FREE 1975 Porsche 911 (930) Turbo',
    author: 'Lionsharp Studios',
    authorUrl: 'https://sketchfab.com/lionsharp',
    source: 'https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: 'Generic passenger car pack',
    author: 'Comrade1280',
    authorUrl: 'https://sketchfab.com/comrade1280',
    source: 'https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
];

const CSS = 'margin:12px 0 0;padding-top:9px;'
  + 'border-top:1px solid rgba(255,255,255,.07);font-size:10px;line-height:1.55;'
  + 'letter-spacing:.02em;color:rgba(198,212,226,.42);';
const LINK = 'color:rgba(198,212,226,.62);text-decoration:none;'
  + 'border-bottom:1px solid rgba(198,212,226,.22);';

/**
 * Mount (once) the attribution line into a container.
 * Safe to call repeatedly — it replaces its own node rather than stacking.
 */
export function mountCredits(container) {
  if (!container) return;
  let el = container.querySelector('.model-credits');
  if (!el) {
    el = document.createElement('div');
    el.className = 'model-credits';
    el.style.cssText = CSS;
    container.appendChild(el);
  }
  const a = (href, text) => `<a href="${href}" target="_blank" rel="noopener" style="${LINK}">${text}</a>`;
  el.innerHTML = (lang === 'en' ? 'Car models: ' : 'Fahrzeugmodelle: ')
    + ATTRIBUTIONS.map(x =>
      `${a(x.source, x.title)} — ${a(x.authorUrl, x.author)}, ${a(x.licenceUrl, x.licence)}`
    ).join(' · ');
}
