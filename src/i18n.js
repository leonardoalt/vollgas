/* ==========================================================================
   i18n.js — UI language. German is the default; English is a full alternative.

   Deliberately NOT translated: the road signs, gantries, licence plates and
   place names in the world itself. A German Autobahn has German signage, and
   reading "Ausfahrt", "Ende aller Streckenverbote" and "Raststätte Neckarburg"
   off the verge is most of what makes the route feel like the A81. Only the
   interface around it changes.
   ========================================================================== */

const DE = {
  'lang.other': 'EN',
  'load': 'Strecke wird gebaut',
  'pause': 'PAUSE',
  'pause.hint': 'P zum Fortsetzen',

  'hud.time': 'Zeit',
  'hud.pos': 'Platz',
  'hud.goal': 'Ziel',
  'hud.vmax': 'V max',
  'hud.fine': 'Bußgeld',
  'hud.points': 'Flensburg',
  'hud.damage': 'Schaden',
  'hud.best': 'Best',
  'hud.dir': 'Richtung Singen (Bodensee)',
  'hud.gear': 'GANG',

  'pv.head': 'MESSUNG LÄUFT',
  'pv.close': 'Zivilfahrzeug hinter dir — abbremsen oder abhängen',
  'pv.far': 'Zu weit für die Messung — sie bleiben aber dran',

  'menu.tagline': 'Stuttgart → Singen (Bodensee) · {km} km · Streckenabschnitte ohne Limit',
  'menu.controls': 'Steuerung',
  'menu.c1': '<b>W</b> / <b>↑</b> Gas · <b>S</b> / <b>↓</b> Bremse',
  'menu.c2': '<b>A</b> <b>D</b> / <b>←</b> <b>→</b> Lenken',
  'menu.c3': '<b>Leer</b> Handbremse · <b>C</b> Kamera wechseln',
  'menu.c4': '<b>M</b> Ton · <b>R</b> Neustart · <b>P</b> Pause',
  'menu.police': 'Zivile Streifen & Blitzer',
  'menu.p1': '<b>Zivilstreifen</b> fahren unauffällig mit — Blaulicht hinter dem Grill, bis 300 km/h schnell.',
  'menu.p2': '<b>ProViDa</b> misst dich per Video von hinten. Abbremsen oder abhängen, sonst Anzeige.',
  'menu.p3': '<b>Blitzer</b> im Seitenstreifen. Einzige Warnung: <b>Lichthupe</b> vom Gegenverkehr.',
  'menu.start': 'RENNEN STARTEN',
  'menu.again': 'NOCH EINMAL',

  'car.awd': 'Allrad',
  'car.rwd': 'Hinterrad',
  'car.gears': '{n}-Gang',
  'stat.vmax': 'V max',
  'stat.power': 'Leistung',
  'stat.kgkw': 'kg / kW',
  'stat.grip': 'Grip',
  'stat.mass': 'Gewicht',

  'go': 'LOS!',
  'a.route': 'A 81 · STUTTGART → SINGEN',
  'a.route.sub': '{km} km · freie Abschnitte nutzen',
  'a.start': 'BIS BÖBLINGEN GILT EIN LIMIT',
  'a.start.sub': 'Danach freie Fahrt',
  'a.measure': 'ZIVILSTREIFE HÄNGT DRAN',
  'a.measure.sub': 'ProViDa-Messung beginnt',
  'a.abort': 'MESSUNG ABGEBROCHEN',
  'a.abort.sub': 'Rechtzeitig vom Gas gegangen',
  'a.lost': 'ABGEHÄNGT',
  'a.lost.sub': 'Die Messung ist nicht verwertbar',
  'a.freed': 'ENDE DER BESCHRÄNKUNG',
  'a.freed.sub': 'Kein Limit mehr — es gibt nichts zu messen',
  'a.charge': 'ANZEIGE · {fine} €',
  'a.charge.sub': '{speed} statt {limit} km/h · {points} Punkt{pl}',
  'a.charge.ban': ' · {n} Mon. Fahrverbot',
  'a.follow': 'STOP POLIZEI — BITTE FOLGEN',
  'a.follow.sub': 'Abhängen oder anhalten',
  'a.flash': 'GEBLITZT · {fine} €',
  'a.flash.sub': '{speed} statt {limit} km/h',
  'a.flash.points': ' · {n} Punkte',
  'a.escaped': 'VERFOLGUNG ABGEBROCHEN',
  'a.escaped.sub': 'Sie sind weg',
  'a.stopped': 'VERKEHRSKONTROLLE',
  'a.stopped.sub': 'Rechts ranfahren · Führerschein und Fahrzeugpapiere',
  'a.crash': 'AUFFAHRUNFALL',
  'a.crash.sub': 'Schaden am Fahrzeug',

  'res.stopped': 'ANGEHALTEN',
  'res.newbest': 'NEUE BESTZEIT',
  'res.time.l': 'Zeit',
  'res.best.l': 'Bestzeit',
  'res.vmax.l': 'V max',
  'res.avg.l': 'Ø Tempo',
  'res.fines.l': 'Bußgeld',
  'res.points.l': 'Punkte',
  'res.damage.l': 'Schaden',
  'res.none': '—',
  'a.arrest': 'ANHALTEN · RECHTS RANFAHREN',
  'a.arrest.sub': 'Die Streife bleibt hinter dir stehen',
  'dnf.stopped': 'Von der Polizei angehalten · Fahrt beendet',
  'busted.arrest': 'ERWISCHT',
  'busted.arrest.sub': 'Verkehrskontrolle · Fahrt beendet',
  'busted.points': 'FÜHRERSCHEIN WEG',
  'busted.points.sub': 'Acht Punkte in Flensburg',
  'busted.wreck': 'SCHROTT',
  'busted.wreck.sub': 'Abschleppdienst unterwegs',
  'busted.rammed': 'GERAMMT',
  'busted.rammed.sub': 'Messfahrzeug der Polizei · Fahrt beendet',
  'dnf.rammed': 'Polizeifahrzeug gerammt · Fahrt beendet',
  'src.collision': 'Unfall',
  'ticket.rammed': 'Messfahrzeug der Polizei gerammt',
  'res.rowplain': '{where}',
  'a.points6': 'SECHS PUNKTE IN FLENSBURG',
  'a.points6.sub': 'Noch zwei — dann ist der Führerschein weg',
  'a.revoked': 'FAHRERLAUBNIS ENTZOGEN',
  'a.revoked.sub': 'Acht Punkte in Flensburg · Fahrt beendet',
  'a.wrecked': 'FAHRZEUG NICHT MEHR FAHRBEREIT',
  'a.wrecked.sub': 'Der Abschleppdienst ist unterwegs',
  'res.finish': 'ZIEL · SINGEN (BODENSEE)',
  'res.over': 'RENNEN BEENDET',
  'res.place': ['SIEG', 'ZWEITER', 'DRITTER', 'VIERTER'],
  'res.vmax': '{n}. · V max {v} km/h',
  'res.placevmax': '{place} · V max {v} km/h',
  'res.pos': 'Pos',
  'res.driver': 'Fahrer',
  'res.car': 'Fahrzeug',
  'res.fine': 'Bußgeld',
  'res.time': 'Zeit',
  'res.me': 'DU',
  'res.clean': 'Kein Bußgeldbescheid',
  'res.clean.sub': 'Sauber durchgekommen. Keine Messung, kein Blitzer, keine Punkte.',
  'res.ticket': 'Bußgeldbescheid · Regierungspräsidium Karlsruhe',
  'res.row': '{where} — {speed} statt {limit} km/h (+{excess})',
  'res.pointsrow': 'Punkte im Fahreignungsregister Flensburg',
  'res.ban': 'Fahrverbot',
  'res.month': '{n} Monat',
  'res.months': '{n} Monate',
  'res.total': 'Gesamt',
  'dnf.wreck': 'Fahrzeug nicht mehr fahrbereit · Abschleppdienst',
  'dnf.points': '8 Punkte in Flensburg · Fahrerlaubnis entzogen',
  'src.provida': 'ProViDa',
  'src.blitzer': 'Blitzer',
};

const EN = {
  'lang.other': 'DE',
  'load': 'Building the route',
  'pause': 'PAUSED',
  'pause.hint': 'P to resume',

  'hud.time': 'Time',
  'hud.pos': 'Place',
  'hud.goal': 'To go',
  'hud.vmax': 'Top',
  'hud.fine': 'Fines',
  'hud.points': 'Points',
  'hud.damage': 'Damage',
  'hud.best': 'Best',
  'hud.dir': 'Southbound · Singen (Lake Constance)',
  'hud.gear': 'GEAR',

  'pv.head': 'MEASUREMENT RUNNING',
  'pv.close': 'Unmarked car behind you — brake or lose it',
  'pv.far': 'Too far to measure — but they are still on you',

  'menu.tagline': 'Stuttgart → Singen (Lake Constance) · {km} km · sections with no speed limit',
  'menu.controls': 'Controls',
  'menu.c1': '<b>W</b> / <b>↑</b> throttle · <b>S</b> / <b>↓</b> brake',
  'menu.c2': '<b>A</b> <b>D</b> / <b>←</b> <b>→</b> steer',
  'menu.c3': '<b>Space</b> handbrake · <b>C</b> change camera',
  'menu.c4': '<b>M</b> sound · <b>R</b> restart · <b>P</b> pause',
  'menu.police': 'Unmarked patrols & speed cameras',
  'menu.p1': '<b>Unmarked patrols</b> run with the traffic — blue lights behind the grille, good for 300 km/h.',
  'menu.p2': '<b>ProViDa</b> measures you on video from behind. Brake or lose them, or you are reported.',
  'menu.p3': '<b>Speed cameras</b> in the hard shoulder. Your only warning: oncoming drivers <b>flashing</b>.',
  'menu.start': 'START THE RACE',
  'menu.again': 'RACE AGAIN',

  'car.awd': 'all-wheel drive',
  'car.rwd': 'rear-wheel drive',
  'car.gears': '{n}-speed',
  'stat.vmax': 'Top speed',
  'stat.power': 'Power',
  'stat.kgkw': 'kg / kW',
  'stat.grip': 'Grip',
  'stat.mass': 'Weight',

  'go': 'GO!',
  'a.route': 'A 81 · STUTTGART → SINGEN',
  'a.route.sub': '{km} km · use the open sections',
  'a.start': 'LIMIT UNTIL BÖBLINGEN',
  'a.start.sub': 'Then it opens up',
  'a.measure': 'UNMARKED CAR ON YOU',
  'a.measure.sub': 'ProViDa measurement starting',
  'a.abort': 'MEASUREMENT ABORTED',
  'a.abort.sub': 'You lifted off in time',
  'a.lost': 'YOU LOST THEM',
  'a.lost.sub': 'The measurement will not stand',
  'a.freed': 'RESTRICTION ENDS',
  'a.freed.sub': 'No limit any more — nothing left to measure',
  'a.charge': 'REPORTED · €{fine}',
  'a.charge.sub': '{speed} in a {limit} · {points} point{pl}',
  'a.charge.ban': ' · {n}-month ban',
  'a.follow': 'STOP POLIZEI — FOLLOW US',
  'a.follow.sub': 'Lose them or pull over',
  'a.flash': 'CAMERA · €{fine}',
  'a.flash.sub': '{speed} in a {limit}',
  'a.flash.points': ' · {n} points',
  'a.escaped': 'PURSUIT BROKEN OFF',
  'a.escaped.sub': 'You are clear',
  'a.stopped': 'TRAFFIC STOP',
  'a.stopped.sub': 'Pull onto the shoulder · licence and papers',
  'a.crash': 'REAR-END COLLISION',
  'a.crash.sub': 'Car damaged',

  'res.stopped': 'PULLED OVER',
  'res.newbest': 'NEW BEST TIME',
  'res.time.l': 'Time',
  'res.best.l': 'Best time',
  'res.vmax.l': 'Top speed',
  'res.avg.l': 'Average',
  'res.fines.l': 'Fines',
  'res.points.l': 'Points',
  'res.damage.l': 'Damage',
  'res.none': '—',
  'a.arrest': 'PULL OVER NOW',
  'a.arrest.sub': 'The patrol car is stopping behind you',
  'dnf.stopped': 'Stopped by the police · run over',
  'busted.arrest': 'BUSTED',
  'busted.arrest.sub': 'Traffic stop · run over',
  'busted.points': 'LICENCE GONE',
  'busted.points.sub': 'Eight points in Flensburg',
  'busted.wreck': 'WRECKED',
  'busted.wreck.sub': 'Recovery truck on its way',
  'busted.rammed': 'RAMMED',
  'busted.rammed.sub': 'Police speed-camera van · run over',
  'dnf.rammed': 'Rammed a police vehicle · run over',
  'src.collision': 'Collision',
  'ticket.rammed': 'Rammed a police speed-camera van',
  'res.rowplain': '{where}',
  'a.points6': 'SIX POINTS ON YOUR LICENCE',
  'a.points6.sub': 'Two more and it is gone',
  'a.revoked': 'LICENCE REVOKED',
  'a.revoked.sub': 'Eight points in Flensburg · run over',
  'a.wrecked': 'CAR UNDRIVABLE',
  'a.wrecked.sub': 'The recovery truck is on its way',
  'res.finish': 'FINISH · SINGEN (LAKE CONSTANCE)',
  'res.over': 'RACE OVER',
  'res.place': ['WON', 'SECOND', 'THIRD', 'FOURTH'],
  'res.vmax': '{n}. · top {v} km/h',
  'res.placevmax': '{place} · top {v} km/h',
  'res.pos': 'Pos',
  'res.driver': 'Driver',
  'res.car': 'Car',
  'res.fine': 'Fines',
  'res.time': 'Time',
  'res.me': 'YOU',
  'res.clean': 'No penalty notice',
  'res.clean.sub': 'Got through clean. No measurement, no camera, no points.',
  'res.ticket': 'Penalty notice · Regierungspräsidium Karlsruhe',
  'res.row': '{where} — {speed} in a {limit} (+{excess})',
  'res.pointsrow': 'Points on your licence (Flensburg)',
  'res.ban': 'Driving ban',
  'res.month': '{n} month',
  'res.months': '{n} months',
  'res.total': 'Total',
  'dnf.wreck': 'Car undrivable · towed away',
  'dnf.points': '8 points in Flensburg · licence revoked',
  'src.provida': 'ProViDa',
  'src.blitzer': 'Camera',
};

const TABLES = { de: DE, en: EN };
const STORE = 'a81.lang';

/* German is the default: the game is set on a German motorway and the signage
   is German either way. English is a deliberate choice, not a fallback. */
function detect() {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && TABLES[saved]) return saved;
  } catch { /* private mode */ }
  return 'de';
}

export let lang = detect();

/** Look a string up in the current language, filling {placeholders}. */
export function t(key, vars) {
  const table = TABLES[lang] || EN;
  let s = table[key];
  if (s === undefined) s = EN[key];
  if (s === undefined) return key;
  if (Array.isArray(s) || vars === undefined) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

export function setLang(l) {
  if (!TABLES[l]) return;
  lang = l;
  try { localStorage.setItem(STORE, l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  applyDom();
}
export function toggleLang() { setLang(lang === 'de' ? 'en' : 'de'); }

/**
 * Fill every element carrying data-i18n (text) or data-i18n-html (markup).
 * Placeholder values shared by static markup live in `GLOBALS`.
 */
export const GLOBALS = {};
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'), GLOBALS);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.getAttribute('data-i18n-html'), GLOBALS);
  }
  const btn = document.getElementById('lang-btn');
  if (btn) btn.textContent = t('lang.other');
}
