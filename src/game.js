/* ==========================================================================
   game.js — states, camera, and the wiring between world, cars, police, HUD.
   ========================================================================== */
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { initMaterials, CARS, PLAYER_CARS } from './carFactory.js';
import { roadEnv } from './carEnv.js';
import { createPostFX } from './postfx.js';
import { mountHero } from './carHero.js';
import { mountCredits } from './credits.js';
import { preloadCarModels } from './carModels.js';
import {
  Player, Traffic, resolveCollisions,
} from './vehicles.js';
import { Enforcement, COP_STATE } from './police.js';
import { Hud } from './hud.js';
import { Showroom } from './showroom.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { LENGTH, LANES, toWorld, rng, STAGE_KM, entryRamp } from './track.js';
import { t, lang, toggleLang, applyDom, GLOBALS } from './i18n.js';

const KMH = 3.6;
const $ = (id) => document.getElementById(id);

/* Rivals are switched off: the stage is a time trial against your own best. */
const RIVALS = false;

const CAM_MODES = [
  { name: 'Verfolgung', dist: 8.4, height: 2.75, look: 46, lookY: 1.55, lag: 7.5, fov: 62, uf: 0.94 },
  { name: 'Nah', dist: 5.6, height: 2.05, look: 40, lookY: 1.35, lag: 10, fov: 66, uf: 0.97 },
  { name: 'Cockpit', cockpit: [-0.36, 1.14, 0.10], look: 130, lookY: 1.20, fov: 70 },
  { name: 'Motorhaube', cockpit: [0, 1.02, 1.55], look: 150, lookY: 1.15, fov: 74 },
  { name: 'Kino', dist: 15.5, height: 4.6, look: 70, lookY: 2.0, lag: 4.0, fov: 48, uf: 0.7 },
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.input = new Input();
    this.audio = new Audio();
    this.hud = new Hud();
    this.camMode = 0;
    this.selected = 0;
    this.paintIdx = 0;
    this.shake = 0;
    this.raceTime = 0;
    this.countdown = 0;
    this.paused = false;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._tunnelMix = 0;
  }

  /* ------------------------------------------------------------- bootstrap */
  async init() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // accumulate stats across all passes of a frame rather than per render()
    renderer.info.autoReset = false;
    this.frameStats = { calls: 0, tris: 0 };
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.32, 5200);
    this.setupMirror();

    const setText = (stage) => { const el = $('load-text'); if (el) el.textContent = `${t('load')} · ${stage} …`; };
    await new Promise(r => requestAnimationFrame(r));
    this.world = buildWorld(this.scene, renderer, setText);
    /* [car visuals] The cars get their own procedurally generated HDR sky to
       reflect — sun disc, crisp horizon, dark ground bounce (see carEnv.js) —
       instead of a PMREM of the flat background gradient, which carries no
       information and makes clearcoat pointless. Kept as a separate env map so
       the world's own materials are left exactly as they were. */
    this.carEnv = roadEnv(renderer);
    initMaterials(this.carEnv);

    /* [car visuals] Real car bodies. This is a network fetch, so it reports
       into the loading screen and never throws — any model that fails to
       arrive simply leaves that car on its procedural body. */
    setText('Fahrzeuge');
    this.modelStats = await preloadCarModels(this.carEnv, (f, label) => {
      setText(`${label} ${Math.round(f * 100)} %`);
    });

    // baseline lighting values, so the tunnel can dim them
    this.baseHemi = this.scene.children.find(o => o.isHemisphereLight);
    this.baseSun = this.world.sun;
    this.lightBase = {
      hemi: this.baseHemi.intensity, sun: this.baseSun.intensity,
      fogNear: this.scene.fog.near, fogFar: this.scene.fog.far,
      fogCol: this.scene.fog.color.clone(),
    };

    /* [car visuals] Bloom. Five small passes of our own rather than
       EffectComposer, which would tone-map a second time on top of the scene
       pass — see postfx.js. Returns null if the device cannot give us a float
       target, in which case we just render straight to the canvas as before. */
    this.post = createPostFX(renderer, innerWidth, innerHeight);

    addEventListener('resize', () => this.onResize());
    GLOBALS.km = STAGE_KM;
    document.documentElement.lang = lang;
    applyDom();
    // [car visuals] CC-BY on the car models requires a visible credit
    mountCredits($('car-detail'));
    /* The car pictures are live renders, which means a second WebGL context.
       Creating it here delayed the loading screen clearing by well over a
       second, so it is built on the first menu frame instead and the list is
       redrawn once it exists. */
    this.showroom = null;
    this._needShowroom = true;
    const langBtn = $('lang-btn');
    if (langBtn) langBtn.onclick = () => { toggleLang(); this.buildMenu(); };
    this.buildMenu();
    $('loading').classList.add('done');
    this.state = 'menu';
    this.startLoop();
  }

  onResize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(innerWidth, innerHeight);   // [car visuals]
    this.layoutMirror();
  }

  /* ------------------------------------------------------- rear-view mirror
     A game about being followed has to let you look behind you. The rear view
     is rendered to a small target with a narrow field of view (so most of the
     world culls away) and then drawn as a horizontally mirrored quad in a
     screen-space overlay pass — mirrored via the quad, not the camera, so no
     winding or culling tricks are needed. */
  setupMirror() {
    const MW = 640, MH = 176;
    this.mirrorRT = new THREE.WebGLRenderTarget(MW, MH, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, samples: 0,
    });
    this.mirrorRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.mirrorCam = new THREE.PerspectiveCamera(36, MW / MH, 0.5, 900);

    this.overlay = new THREE.Scene();
    this.overlayCam = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 10);
    this.overlayCam.position.z = 5;

    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x0a0d11, transparent: true, opacity: 0.92 })
    );
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture, side: THREE.DoubleSide, toneMapped: false })
    );
    glass.scale.x = -1;                      // the actual mirroring
    bezel.renderOrder = 0; glass.renderOrder = 1;
    this.overlay.add(bezel, glass);
    this.mirrorBezel = bezel; this.mirrorGlass = glass;
    this.layoutMirror();
  }

  layoutMirror() {
    if (!this.mirrorGlass) return;
    const ASPECT = 640 / 176;
    const wFrac = innerWidth < 900 ? 0.44 : 0.34;
    const w = wFrac;
    const h = (w * innerWidth) / (ASPECT * innerHeight);
    const cx = 0.5, cy = 1 - (0.021 + h / 2) - 0.128;
    this.mirrorGlass.scale.set(-w, h, 1);
    this.mirrorGlass.position.set(cx, cy, 0.2);
    const bw = w + 0.008, bh = h + (0.008 * innerWidth) / innerHeight;
    this.mirrorBezel.scale.set(bw, bh, 1);
    this.mirrorBezel.position.set(cx, cy, 0.1);
  }

  renderMirror() {
    const p = this.player;
    if (!p) return;
    /* Just above and behind the roofline. Sitting inside the cabin puts our
       own bodywork through the near plane and fills half the mirror with it. */
    const d = p.spec.dims;
    // the main render is what normally refreshes matrixWorld, and it happens
    // after this pass — so bring the car's transform up to date first
    p.mesh.updateMatrixWorld(true);
    const eye = new THREE.Vector3(0, d.height * 1.04, -d.length * 0.28);
    p.mesh.localToWorld(eye);
    const back = toWorld(p.s - 120, p.u * 0.72);
    this.mirrorCam.position.copy(eye);
    this.mirrorCam.up.set(0, 1, 0);
    this.mirrorCam.lookAt(back.x, back.y + 1.1, back.z);
    // the bezel goes red while a patrol car is on you
    const cop = this.enf && this.enf.activeCop;
    const hot = !!cop && (cop.state === COP_STATE.MEASURE || cop.state === COP_STATE.PURSUE);
    this.mirrorBezel.material.color.setHex(hot ? 0x5a0e08 : 0x0a0d11);
    const r = this.renderer;
    r.setRenderTarget(this.mirrorRT);
    r.clear();
    r.render(this.scene, this.mirrorCam);
    r.setRenderTarget(null);
  }

  /* ------------------------------------------------------------- the menu */
  buildMenu() {
    const list = $('car-list');
    list.innerHTML = '';
    PLAYER_CARS.forEach((id, i) => {
      const spec = CARS[id];
      const card = document.createElement('div');
      card.className = 'car-card' + (i === this.selected ? ' sel' : '');
      // use a cached render if we have one; otherwise a swatch that gets
      // swapped for the render a frame or two later (see scheduleThumbs)
      const thumb = this.showroom && this.showroom.ok
        ? this.showroom.cachedThumb(id, spec.paints[0].c) : null;
      const pic = thumb
        ? `<img class="car-thumb" src="${thumb}" alt="">`
        : `<div class="car-swatch" style="background:#${spec.paints[0].c.toString(16).padStart(6, '0')}"></div>`;
      card.innerHTML = `${pic}
        <div><div class="car-name">${spec.name}</div><div class="car-marque">${spec.marque}</div></div>
        <div class="car-vmax">${spec.perf.vmax}<small>km/h</small></div>`;
      card.onclick = () => { this.selected = i; this.paintIdx = 0; this.buildMenu(); };
      list.appendChild(card);
    });
    const id = PLAYER_CARS[this.selected];
    const spec = CARS[id];
    if (this.showroom) this.showroom.setCar(id, spec.paints[this.paintIdx % spec.paints.length].c);
    // [car visuals] still photograph as the hero image where we have one
    /* The live model is the default view: it is the car you actually drive,
       and making that look right is the point. The photo is one click away. */
    mountHero($('car-stage'), $('car-canvas'), id, this._heroPhoto === true);
    $('car-detail-name').textContent = spec.name;
    $('car-detail-sub').textContent =
      `${spec.marque} · ${t(spec.perf.awd ? 'car.awd' : 'car.rwd')} · ${t('car.gears', { n: spec.perf.gears })}`;
    const p = spec.perf;
    const hp = lang === 'en' ? `${Math.round(p.power * 1.341)} hp` : `${Math.round(p.power * 1.36)} PS`;
    const stats = [
      [t('stat.vmax'), p.vmax, 340, `${p.vmax} km/h`],
      [t('stat.power'), p.power, 500, hp],
      [t('stat.kgkw'), 1 - (p.mass / p.power) / 6, 1, `${(p.mass / p.power).toFixed(1)}`],
      [t('stat.grip'), p.grip, 1.5, `${p.grip.toFixed(2)} g`],
      [t('stat.mass'), 1 - (p.mass - 1500) / 800, 1, `${p.mass} kg`],
    ];
    $('car-stats').innerHTML = stats.map(([l, v, max, txt]) =>
      `<div class="stat"><span class="sl">${l}</span><span class="sb"><i style="width:${Math.max(4, Math.min(100, (v / max) * 100)).toFixed(0)}%"></i></span><span class="sv">${txt}</span></div>`
    ).join('');
    $('car-blurb').textContent = (lang === 'en' && spec.blurbEn) ? spec.blurbEn : spec.blurb;
    this.scheduleThumbs();
  }

  /**
   * Render the list thumbnails one per frame after the menu is already up.
   * Doing all four before the loading screen clears cost about three seconds.
   */
  scheduleThumbs() {
    if (!this.showroom || !this.showroom.ok || this._thumbJob) return;
    let i = 0;
    const step = () => {
      if (i >= PLAYER_CARS.length) { this._thumbJob = false; return; }
      const id = PLAYER_CARS[i];
      const spec = CARS[id];
      const url = this.showroom.thumbnail(id, spec.paints[0].c);
      const card = document.querySelectorAll('#car-list .car-card')[i];
      if (card && url && card.firstElementChild && !card.firstElementChild.matches('img')) {
        const img = document.createElement('img');
        img.className = 'car-thumb'; img.src = url; img.alt = '';
        card.firstElementChild.replaceWith(img);
      }
      i++;
      requestAnimationFrame(step);
    };
    this._thumbJob = true;
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------ the race */
  startRace() {
    const id = PLAYER_CARS[this.selected];
    const spec = CARS[id];
    this.carId = id;

    if (this.player) this.teardown();

    this.player = new Player(id, spec.paints[this.paintIdx % spec.paints.length].c);
    // join the A81 from the Auffahrt rather than appearing in a running lane
    this.startS = 30;
    const ramp = entryRamp(this.startS);
    this.player.s = this.startS;
    this.player.u = ramp ? ramp.centre : LANES[1];
    this.player.v = 17;                        // ~61 km/h up the slip road
    this.player.headlights = true;
    this.scene.add(this.player.mesh);
    this.player.mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });

    this.traffic = new Traffic(this.scene, rng);
    this.traffic.build(this.player.s, { same: 12, opp: 10 });
    // Time trial: no rival field. The Rival AI is still in vehicles.js — call
    // traffic.addRivals(this.player.s, id) to put a field back on the road.
    if (RIVALS) this.traffic.addRivals(this.player.s, id);

    this.enf = new Enforcement(this.scene, rng);
    this.enf.build(this.player.s, 4);
    for (const z of this.enf.cops) this.traffic.all.push(z);

    for (const v of this.traffic.all) {
      v.mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
    }

    this.raceTime = 0;
    this.countdown = 3.999;
    this.ending = null;
    this._warned6 = false;
    this.hud.clearBusted();
    this.best = this.loadBest(id);
    this.hud.countdown(null);
    this.finished = false;
    this.results = null;
    this.state = 'race';
    this.hud.show(true);
    $('menu').classList.add('hidden');
    $('results').classList.add('hidden');
    this.audio.start();
    this.audio.resume();
    this.hud.alert(t('a.route'), t('a.route.sub', { km: STAGE_KM }), 'info', 4.5, 'route');
  }

  teardown() {
    const rm = (o) => { this.scene.remove(o); };
    if (this.player) rm(this.player.mesh);
    if (this.traffic) for (const v of [...this.traffic.same, ...this.traffic.opp, ...this.traffic.rivals]) rm(v.mesh);
    if (this.enf) {
      for (const z of this.enf.cops) rm(z.mesh);
      for (const c of this.enf.cameras) rm(c.mesh);
    }
    this.player = null; this.traffic = null; this.enf = null;
  }

  /* --------------------------------------------------------------- camera */
  updateCamera(dt) {
    const p = this.player;
    const mode = CAM_MODES[this.camMode];
    const speedF = Math.min(1, p.v / 80);

    if (mode.cockpit) {
      const local = new THREE.Vector3(...mode.cockpit);
      p.mesh.localToWorld(local);
      this._camPos.copy(local);
    } else {
      const back = toWorld(p.s - mode.dist, p.u * mode.uf);
      const target = new THREE.Vector3(back.x, back.y + mode.height, back.z);
      if (this._camPos.lengthSq() === 0) this._camPos.copy(target);
      const a = 1 - Math.exp(-dt * mode.lag);
      this._camPos.lerp(target, a);
    }

    const look = toWorld(p.s + mode.look * (0.55 + speedF * 0.45), p.u * 0.55);
    const lookT = new THREE.Vector3(look.x, look.y + mode.lookY, look.z);
    if (this._camLook.lengthSq() === 0) this._camLook.copy(lookT);
    this._camLook.lerp(lookT, 1 - Math.exp(-dt * 6.5));

    this.camera.position.copy(this._camPos);
    if (this.shake > 0.001) {
      const k = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.position.z += (Math.random() - 0.5) * k;
      this.shake *= Math.exp(-dt * 5.5);
    }
    this.camera.lookAt(this._camLook);
    if (!mode.cockpit) this.camera.rotateZ(-p.aLat * 0.0016);

    const fov = mode.fov + speedF * 7 + Math.min(6, p.slip * 6);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  /* ------------------------------------------------------- tunnel ambience */
  updateTunnel(dt) {
    const inside = this.world.inTunnel(this.player.s);
    const want = inside ? 1 : 0;
    this._tunnelMix += (want - this._tunnelMix) * Math.min(1, dt * 3.2);
    const m = this._tunnelMix;
    const L = this.lightBase;
    this.baseHemi.intensity = L.hemi * (1 - m * 0.72);
    this.baseSun.intensity = L.sun * (1 - m * 0.94);
    this.scene.fog.near = L.fogNear * (1 - m) + 40 * m;
    this.scene.fog.far = L.fogFar * (1 - m) + 340 * m;
    this.scene.fog.color.copy(L.fogCol).lerp(new THREE.Color(0x14161a), m);
    this.renderer.toneMappingExposure = 1.06 + m * 0.5;
  }

  /* --------------------------------------------------------------- endings
     All three ways a run can end share one flow: let the situation come to
     rest, hold on a full-screen card so the player sees *why*, then show the
     numbers. Snapping straight to a results table reads like a bug. */
  beginEnding(kind) {
    if (this.ending) return;
    this.ending = { kind, t: 0, shown: false, showT: 0 };
    this.camMode = 4;                        // pull back so you can see it
    if (kind !== 'wreck' && kind !== 'rammed') this.enf.forceStop(this.player);
  }

  stepEnding(dt) {
    const e = this.ending, p = this.player;
    e.t += dt;
    // make room on the shoulder rather than dragging the car through traffic
    if (p.stoppedT > 0) this.traffic.clearPath(p);
    const cop = this.enf.activeCop;
    const settled = (e.kind === 'wreck' || e.kind === 'rammed')
      ? p.v < 2.0
      : (p.pulledOver && (!cop || cop.v < 0.8));
    if (!e.shown && (settled || e.t > 15)) {
      e.shown = true;
      this.hud.busted(e.kind);
      this.audio.hush();
    }
    if (e.shown) {
      e.showT += dt;
      if (e.showT > 2.9) {
        const reason = {
          arrest: 'dnf.stopped', points: 'dnf.points',
          wreck: 'dnf.wreck', rammed: 'dnf.rammed', racing: 'dnf.racing',
        }[e.kind];
        this.outOfRace(t(reason));
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------ best times */
  bestKey(id) { return `a81.best.${id}`; }
  loadBest(id) {
    try { const v = parseFloat(localStorage.getItem(this.bestKey(id))); return Number.isFinite(v) ? v : null; }
    catch { return null; }
  }
  saveBest(id, secs) {
    try { localStorage.setItem(this.bestKey(id), String(secs)); } catch { /* ignore */ }
  }

  /* --------------------------------------------------------- race scoring */
  finish() {
    this.finished = true;
    const secs = this.raceTime;
    this.player.finishT = secs;
    const prev = this.loadBest(this.carId);
    const isBest = prev == null || secs < prev;
    if (isBest) this.saveBest(this.carId, secs);
    this.results = { time: secs, prev, isBest, dnf: null };
    this.endRun();
  }

  outOfRace(reason) {
    this.finished = true;
    this.results = { time: null, prev: this.loadBest(this.carId), isBest: false, dnf: reason };
    this.endRun();
  }

  endRun() {
    this.state = 'results';
    this.hud.show(false);
    this.audio.hush();
    this.showResults();
  }

  showResults() {
    const r = this.results;
    const p = this.player;
    const fmt = (x) => (x == null || x === Infinity) ? t('res.none')
      : `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
    // German writes 320,00 € after the number; English writes €320.00 before it
    const money = (n) => lang === 'de'
      ? `${n.toLocaleString('de-DE')},00 €`
      : `€${n.toLocaleString('en-GB')}.00`;

    $('results-title').textContent = r.dnf
      ? (r.dnf === t('dnf.stopped') ? t('res.stopped') : t('res.over'))
      : t('res.finish');
    $('results-place').textContent = r.dnf ? r.dnf
      : (r.isBest ? t('res.newbest') : `${t('res.best.l')} ${fmt(r.prev)}`);

    const avg = r.time ? (LENGTH / 1000) / (r.time / 3600) : null;
    // a § 315d case is a prosecution, not an administrative penalty notice
    const criminal = p.tickets.some(x => x.criminal);
    const rows = [
      [t('res.time.l'), fmt(r.time)],
      [t('res.best.l'), fmt(r.isBest ? r.time : r.prev)],
      [t('res.vmax.l'), `${Math.round(p.vmaxSeen)} km/h`],
      [t('res.avg.l'), avg ? `${Math.round(avg)} km/h` : t('res.none')],
      [criminal ? t('res.fines.crim') : t('res.fines.l'), money(p.fines)],
      [t('res.points.l'), String(p.points)],
      [t('res.damage.l'), `${Math.round(p.damage)} %`],
    ];
    $('results-table').innerHTML = rows.map(([k, v], i) =>
      `<tr class="${i === 0 ? 'me' : ''}"><td>${k}</td><td class="n">${v}</td></tr>`).join('');

    const tk = $('results-ticket');
    if (p.tickets.length === 0) {
      tk.className = 'clean';
      tk.innerHTML = `<h4>${t('res.clean')}</h4>${t('res.clean.sub')}
        <div class="tk-total"><span>${t('res.total')}</span><span>${money(0)}</span></div>`;
    } else {
      tk.className = 'dirty';
      const ban = Math.max(...p.tickets.map(x => x.ban));
      tk.innerHTML = `<h4>${t(criminal ? 'res.ticket.crim' : 'res.ticket')}</h4>` +
        p.tickets.map(x =>
          `<div class="tk-row"><span>${x.plain
            ? t('res.rowplain', { where: `${t('src.' + x.src)} · ${x.place}` })
            : t('res.row', {
                where: `${t('src.' + x.src)} · ${x.place}`,
                speed: x.speed, limit: x.limit, excess: x.excess,
              })}</span><span>${x.days ? `${t('res.days', { n: x.days })} · ${money(x.fine)}` : money(x.fine)}</span></div>`
        ).join('') +
        `<div class="tk-row"><span>${t('res.pointsrow')}</span><span>${p.points}</span></div>` +
        (ban > 0 ? `<div class="tk-row"><span>${t('res.ban')}</span><span>${t(ban > 1 ? 'res.months' : 'res.month', { n: ban })}</span></div>` : '') +
        (p.tickets.some(x => x.revoked) ? `<div class="tk-row"><span>${t('res.revoked')}</span><span>§ 69 StGB</span></div>` : '') +
        (p.tickets.some(x => x.seized) ? `<div class="tk-row"><span>${t('res.seized')}</span><span>§ 315f StGB</span></div>` : '') +
        `<div class="tk-total"><span>${t('res.total')}</span><span>${money(p.fines)}</span></div>`;
    }
    $('results').classList.remove('hidden');
  }

  /* ---------------------------------------------------------- event pump */
  handleEvents() {
    for (const ev of this.enf.drainEvents()) {
      switch (ev.type) {
        case 'measure-start':
          this.hud.alert(t('a.measure'), t('a.measure.sub'), 'bad', 4.5, 'provida');
          this.audio.blip();
          break;
        case 'measure-abort':
          this.hud.alert(t('a.abort'), t('a.abort.sub'), 'good', 3, 'provida');
          break;
        case 'measure-lost':
          this.hud.alert(t('a.lost'), t('a.lost.sub'), 'good', 3, 'provida');
          break;
        case 'measure-freed':
          this.hud.alert(t('a.freed'), t('a.freed.sub'), 'good', 3, 'provida');
          break;
        case 'measure-done': {
          const p = ev.penalty;
          const sub = t('a.charge.sub', {
            speed: Math.round(ev.speed), limit: ev.limit, points: p.points,
            pl: p.points === 1 ? '' : (lang === 'de' ? 'e' : 's'),
          }) + (p.ban ? t('a.charge.ban', { n: p.ban }) : '');
          this.hud.alert(t('a.charge', { fine: p.fine }), sub, 'bad', 6, 'charge');
          this.hud.alert(t('a.follow'), t('a.follow.sub'), 'bad', 6, 'pursuit');
          break;
        }
        case 'criminal': {
          const p = ev.penalty;
          if (ev.source === 'blitzer') { this.hud.blitzFlash(); this.audio.flash(); }
          this.hud.alert(t('a.racing'),
            t('a.racing.sub', { speed: Math.round(ev.speed), limit: ev.limit }), 'bad', 9, 'charge');
          this.beginEnding('racing');
          break;
        }
        case 'flash': {
          const p = ev.penalty;
          this.hud.blitzFlash();
          this.audio.flash();
          const sub = t('a.flash.sub', { speed: Math.round(ev.speed), limit: ev.limit })
            + (p.points ? t('a.flash.points', { n: p.points }) : '');
          this.hud.alert(t('a.flash', { fine: p.fine }), sub, 'bad', 5, 'flash');
          break;
        }
        // 'lichthupe' deliberately shows nothing: the oncoming headlights are
        // the warning, and spelling it out gives the game away.
        case 'escaped':
          this.hud.alert(t('a.escaped'), t('a.escaped.sub'), 'good', 3.5, 'pursuit');
          break;
        case 'stopped':
          this.hud.alert(t('a.stopped'), t('a.stopped.sub'), 'bad', 8, 'pursuit');
          this.beginEnding('arrest');
          break;
      }
    }
  }

  /* --------------------------------------------------------------- update */
  step(dt) {
    const inp = this.input.update(dt);

    if (this.input.tapped('c')) this.camMode = (this.camMode + 1) % CAM_MODES.length;
    if (this.input.tapped('m')) { this.muted = !this.muted; this.audio.setMuted(this.muted); }
    if (this.input.tapped('p')) {
      this.paused = !this.paused;
      $('pause').classList.toggle('hidden', !this.paused);
      if (this.paused) this.audio.hush();
    }
    if (this.input.tapped('r')) { this.startRace(); return; }
    if (this.paused) return;

    const p = this.player;

    // countdown
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before) {
        if (after > 0) { this.hud.countdown(String(after)); this.audio.blip(); }
        else {
          this.hud.countdown(t('go'), true);
          this.hud.alert(t('a.start'), t('a.start.sub'), 'info', 3.2, 'start');
          this.audio.blip();
          setTimeout(() => this.hud.countdown(null), 900);
        }
      }
      /* Rolling up the slip road: hold slip-road pace and track the ramp
         automatically, so the countdown is spent approaching the Autobahn and
         the merge itself is the player's first job. */
      const hold = p.v < 17 ? 0.45 : 0.13;
      const ramp = entryRamp(p.s);
      const wantU = ramp ? ramp.centre : LANES[1];
      const steer = Math.max(-0.6, Math.min(0.6, (wantU - p.u) * 0.26 - p.psi * 2.0));
      p.control(dt, { throttle: hold, brake: 0, steer, handbrake: false }, this.traffic);
      p.sync(dt);
    } else {
      this.raceTime += dt;
      p.control(dt, inp, this.traffic);
    }

    this.traffic.dark = this.world.inTunnel(p.s);
    this.traffic.raceTime = this.raceTime;
    this.traffic.update(dt, p, this.traffic);
    this.enf.update(dt, p, this.traffic, this.traffic);
    this.handleEvents();

    resolveCollisions(p, this.traffic.all, (kind, sev) => {
      this.shake = Math.max(this.shake, 0.10 + sev * 0.85);
      this.audio.impact(sev);
      if (kind === 'rear' && sev > 0.55) this.hud.alert(t('a.crash'), t('a.crash.sub'), 'bad', 2.6, 'crash');
    }, dt);
    // hitting a parked measuring van ends the run there and then
    if (!this.ending && p.stoppedT <= 0) {
      const van = this.enf.hitCamera(p);
      if (van) {
        p.damage = 100;
        p.v *= 0.25;
        p.fines += 1000; p.points += 3;
        p.tickets.push({ src: 'collision', place: t('ticket.rammed'), plain: true, fine: 1000, points: 3, ban: 1 });
        this.shake = Math.max(this.shake, 1.1);
        this.audio.impact(1);
        this.beginEnding('rammed');
      }
    }
    if (p.scrape) this.shake = Math.max(this.shake, 0.05);
    if (p.offroad && p.v > 12) this.shake = Math.max(this.shake, 0.035);

    p.sync(dt);
    this.updateCamera(dt);
    this.updateTunnel(dt);
    this.world.update(dt, p.mesh.position);

    // ---- HUD
    const cop = this.enf.activeCop;
    const copGap = cop ? p.s - cop.s : 0;
    this.hud.update({
      s: p.s, raceTime: this.raceTime, best: this.best,
      vmaxSeen: p.vmaxSeen, fines: p.fines, points: p.points, damage: p.damage,
      provida: cop && cop.state === COP_STATE.MEASURE ? cop.measure : 0,
      providaGap: copGap,
      pursuit: !!(cop && cop.state === COP_STATE.PURSUE),
      pursuitGap: copGap,
    });
    this.hud.drawTacho({
      rpm: p.rpm, redline: p.perf.redline, kmh: p.v * KMH, gear: p.gear,
      stopped: p.stoppedT > 0,
    });
    this.hud.drawRadar({
      s: p.s, u: p.u, halfLen: p.halfLen, halfWid: p.halfWid,
      others: this.traffic.all.filter(o => o.dir > 0).map(o => ({
        s: o.s, u: o.u, halfLen: o.halfLen, halfWid: o.halfWid, kind: o.kind,
        hot: o.kind === 'police' && (o.state === COP_STATE.MEASURE || o.state === COP_STATE.PURSUE),
      })),
    });
    this.hud.stepAlerts(dt);

    // ---- audio mix
    const sirenNear = cop && cop.state === COP_STATE.PURSUE
      ? Math.max(0, 1 - Math.abs(p.s - cop.s) / 220) : 0;
    this.audio.update(dt, {
      rpm: p.rpm, throttle: inp.throttle, speed: p.v, slip: p.slip,
      offroad: p.offroad, scrape: p.scrape, engineOn: true,
      siren: sirenNear > 0.02, sirenNear,
    });

    // ---- end conditions
    if (this.ending) {
      if (this.stepEnding(dt)) return;
    } else {
      // one warning before the licence goes
      if (p.points >= 6 && p.points < 8 && !this._warned6) {
        this._warned6 = true;
        this.hud.alert(t('a.points6'), t('a.points6.sub'), 'bad', 6, 'points');
      }
      if (p.s >= LENGTH - 8) this.finish();
      else if (p.damage >= 100 && p.v < 6) {
        this.hud.alert(t('a.wrecked'), t('a.wrecked.sub'), 'bad', 8, 'end');
        this.beginEnding('wreck');
      } else if (p.points >= 8) {
        this.hud.alert(t('a.revoked'), t('a.revoked.sub'), 'bad', 8, 'end');
        this.beginEnding('points');
      }
    }
  }

  /* ----------------------------------------------------------- main loop */
  startLoop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const racing = this.state === 'race';
      if (racing) this.step(dt);
      else if (this.state === 'menu') {
        if (this._needShowroom) {
          this._needShowroom = false;
          this.showroom = new Showroom($('car-canvas'));
          this.buildMenu();
        }
        const cv = $('car-canvas');
        if (this.showroom && this.showroom.ok && cv && cv.clientWidth > 0) {
          this.showroom.render(dt, cv.clientWidth, cv.clientHeight);
        }
      }
      this.input.endFrame();
      // the mirror is a small strip; 30 Hz is indistinguishable and halves its cost
      this._mirrorTick = ((this._mirrorTick || 0) + 1) % 2;
      if (racing && !this.paused && this._mirrorTick === 0) this.renderMirror();
      // [car visuals] bloom composite when available, plain render otherwise
      if (this.post) this.post.render(this.scene, this.camera);
      else this.renderer.render(this.scene, this.camera);
      if (racing) {
        this.renderer.autoClear = false;
        this.renderer.render(this.overlay, this.overlayCam);
        this.renderer.autoClear = true;
      }
      const info = this.renderer.info.render;
      this.frameStats = { calls: info.calls, tris: info.triangles };
      this.renderer.info.reset();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
