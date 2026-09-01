/* ==========================================================================
   credits.js — the attribution line in the menu.

   The car bodies are CC-BY-4.0. That licence is not a formality: it requires
   the author to be credited wherever the work is shared, which for a game
   means visibly in the game and not only in a file on GitHub. A compact menu
   entry opens the full attribution sheet; CREDITS.md carries the same source
   and licence details in the repository.

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
    title: 'Generic sedan 2010',
    author: 'Daniel Zhabotinsky',
    authorUrl: 'https://sketchfab.com/DanielZhabotinsky',
    source: 'https://sketchfab.com/3d-models/generic-sedan-2010-low-poly-model-7fd6e15785fa4aa9bfd6e31eb7c97ba6',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: 'Bmw M5 F90',
    author: 'RES1N',
    authorUrl: 'https://sketchfab.com/Res1n',
    source: 'https://sketchfab.com/3d-models/bmw-m5-f90-5478e978bd634337adc8e3dc413fbfa3',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: 'Audi RS6',
    author: '3DCars4U',
    authorUrl: 'https://sketchfab.com/3dcarsforyou',
    source: 'https://sketchfab.com/3d-models/audi-rs6-b2e41d08880a4e72b31cf366f2e0dd2b',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: '2010 Mercedes SLS AMG',
    author: 'Dave Love',
    authorUrl: 'https://sketchfab.com/Tyler_Dave',
    source: 'https://sketchfab.com/3d-models/2010-mercedes-sls-amg-fa3fd5eeea674f37bb03283f2c53d563',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: 'Modern Hatchback',
    author: 'Daniel Zhabotinsky',
    authorUrl: 'https://sketchfab.com/DanielZhabotinsky',
    source: 'https://sketchfab.com/3d-models/modern-hatchback-low-poly-model-055ff8a21b8d4d279debca089e2fafcd',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: "Light Commercial Truck '07",
    author: 'Daniel Zhabotinsky',
    authorUrl: 'https://sketchfab.com/DanielZhabotinsky',
    source: 'https://sketchfab.com/3d-models/light-commercial-truck-07-low-poly-model-3be03b6a43aa41898c9ca806b8787052',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: 'Generic SUV',
    author: 'Daniel Zhabotinsky',
    authorUrl: 'https://sketchfab.com/DanielZhabotinsky',
    source: 'https://sketchfab.com/3d-models/generic-suv-low-poly-model-2866efdfa943484391ef8313768e074d',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    title: 'Generic USA/EU Station wagon',
    author: 'Anserkon',
    authorUrl: 'https://sketchfab.com/anserkon',
    source: 'https://sketchfab.com/3d-models/generic-usaeu-station-wagon-c14f271c9d414b8e8d25e7cec3bb44f5',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    /* The author's handle was `roy.gearloft.in` when Objaverse snapshotted the
       file, and that is still what `asset.extras` says; the account is at
       `roy.3dartist` now. Credit the live profile — an attribution nobody can
       follow is not an attribution. CREDITS.md records both. */
    title: 'Truck',
    author: 'ROY',
    authorUrl: 'https://sketchfab.com/roy.3dartist',
    source: 'https://sketchfab.com/3d-models/truck-eda924f23ba04cd5b1e5160abf2320fa',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
];

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
    container.appendChild(el);
  }
  const a = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

  /* Grouped by author. One model per author was a readable line; a dozen is a
     paragraph of repeated names. CC BY asks for the author, the title and the
     licence — grouping keeps all three and stays legible. */
  const byAuthor = [];
  for (const x of ATTRIBUTIONS) {
    let g = byAuthor.find(q => q.author === x.author && q.licence === x.licence);
    if (!g) { g = { ...x, titles: [] }; byAuthor.push(g); }
    g.titles.push(x);
  }
  el.innerHTML = (lang === 'en' ? 'Car models: ' : 'Fahrzeugmodelle: ')
    + byAuthor.map(g =>
      `${g.titles.map(t => a(t.source, t.title)).join(', ')} — `
      + `${a(g.authorUrl, g.author)}, ${a(g.licenceUrl, g.licence)}`
    ).join(' · ');
}
