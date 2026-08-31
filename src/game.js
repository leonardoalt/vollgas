/* ==========================================================================
   game.js — states, camera, and the wiring between world, cars, police, HUD.
   ========================================================================== */
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { initMaterials, CARS, PLAYER_CARS } from './carFactory.js';
import {
  Player, Traffic, resolveCollisions,
} from './vehicles.js';
import { Enforcement, COP_STATE } from './police.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { LENGTH, LANES, toWorld, rng, STAGE_KM } from './track.js';
import { t, lang, setLang, toggleLang, applyDom, GLOBALS } from './i18n.js';

const KMH = 3.6;
const $ = (id) => document.getElementById(id);

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
    initMaterials(this.world.env);

    // baseline lighting values, so the tunnel can dim them
    this.baseHemi = this.scene.children.find(o => o.isHemisphereLight);
    this.baseSun = this.world.sun;
    this.lightBase = {
      hemi: this.baseHemi.intensity, sun: this.baseSun.intensity,
      fogNear: this.scene.fog.near, fogFar: this.scene.fog.far,
      fogCol: this.scene.fog.color.clone(),
    };

    addEventListener('resize', () => this.onResize());
    GLOBALS.km = STAGE_KM;
    document.documentElement.lang = lang;
    applyDom();
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
      card.innerHTML = `
        <div class="car-swatch" style="background:#${spec.paints[0].c.toString(16).padStart(6, '0')}"></div>
        <div><div class="car-name">${spec.name}</div><div class="car-marque">${spec.marque}</div></div>
        <div class="car-vmax">${spec.perf.vmax}<small>km/h</small></div>`;
      card.onclick = () => { this.selected = i; this.paintIdx = 0; this.buildMenu(); };
      list.appendChild(card);
    });
    const id = PLAYER_CARS[this.selected];
    const spec = CARS[id];
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
  }

  /* ------------------------------------------------------------ the race */
  startRace() {
    const id = PLAYER_CARS[this.selected];
    const spec = CARS[id];
    this.carId = id;

    if (this.player) this.teardown();

    this.player = new Player(id, spec.paints[this.paintIdx % spec.paints.length].c);
    this.player.s = 40; this.player.u = LANES[0]; this.player.v = 25;   // rolling start, 90 km/h
    this.player.headlights = true;
    this.scene.add(this.player.mesh);
    this.player.mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });

    this.traffic = new Traffic(this.scene, rng);
    this.traffic.build(this.player.s, { same: 12, opp: 10 });
    this.traffic.addRivals(this.player.s, id);

    this.enf = new Enforcement(this.scene, rng);
    this.enf.build(this.player.s, 4);
    for (const z of this.enf.cops) this.traffic.all.push(z);

    for (const v of this.traffic.all) {
      v.mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
    }

    this.raceTime = 0;
    this.countdown = 3.999;
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

  /* --------------------------------------------------------- race scoring */
  standings() {
    const field = [
      { name: t('res.me'), s: this.player.s, me: true, v: this.player.v, finishT: this.player.finishT },
      ...this.traffic.rivals.map(r => ({ name: r.name, s: r.s, v: r.v, finishT: r.finished ? r.finishT : null, car: r.spec.name })),
    ];
    field.sort((a, b) => b.s - a.s);
    return field;
  }

  finish() {
    this.finished = true;
    this.player.finishT = this.raceTime;
    const field = [
      { name: t('res.me'), car: CARS[this.carId].name, t: this.raceTime, me: true, s: LENGTH, fines: this.player.fines },
      ...this.traffic.rivals.map(r => ({
        name: r.name, car: r.spec.name, s: r.s, fines: r.fines,
        t: r.finished ? r.finishT : this.raceTime + Math.max(1, (LENGTH - r.s) / Math.max(8, r.v)),
      })),
    ];
    field.sort((a, b) => a.t - b.t);
    const place = field.findIndex(f => f.me) + 1;
    this.results = { field, place };
    this.state = 'results';
    this.hud.show(false);
    this.audio.hush();
    this.showResults();
  }

  outOfRace(reason) {
    this.finished = true;
    const field = [
      { name: t('res.me'), car: CARS[this.carId].name, t: Infinity, me: true, dnf: reason },
      ...this.traffic.rivals.map(r => ({
        name: r.name, car: r.spec.name,
        t: r.finished ? r.finishT : this.raceTime + Math.max(1, (LENGTH - r.s) / Math.max(8, r.v)),
      })),
    ];
    field.sort((a, b) => a.t - b.t);
    this.results = { field, place: field.length, dnf: reason };
    this.state = 'results';
    this.hud.show(false);
    this.audio.hush();
    this.showResults();
  }

  showResults() {
    const r = this.results;
    const p = this.player;
    $('results-title').textContent = r.dnf ? t('res.over') : t('res.finish');
    const places = t('res.place');
    $('results-place').textContent = r.dnf ? r.dnf
      : t('res.placevmax', { place: places[r.place - 1] || r.place + '.', v: Math.round(p.vmaxSeen) });

    const fmt = (x) => x === Infinity ? '—' : `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
    // German writes 320,00 € after the number; English writes €320.00 before it
    const money = (n) => lang === 'de'
      ? `${n.toLocaleString('de-DE')},00 €`
      : `€${n.toLocaleString('en-GB')}.00`;
    $('results-table').innerHTML =
      `<tr><th>${t('res.pos')}</th><th>${t('res.driver')}</th><th>${t('res.car')}</th>` +
      `<th class="n">${t('res.fine')}</th><th class="n">${t('res.time')}</th></tr>` +
      r.field.map((f, i) => `<tr class="${f.me ? 'me' : ''}"><td>${i + 1}</td><td>${f.name}</td><td>${f.car || ''}</td><td class="n">${f.fines ? money(f.fines) : '—'}</td><td class="n">${fmt(f.t)}</td></tr>`).join('');

    const tk = $('results-ticket');
    if (p.tickets.length === 0) {
      tk.className = 'clean';
      tk.innerHTML = `<h4>${t('res.clean')}</h4>${t('res.clean.sub')}
        <div class="tk-total"><span>${t('res.total')}</span><span>${money(0)}</span></div>`;
    } else {
      tk.className = 'dirty';
      const ban = Math.max(...p.tickets.map(x => x.ban));
      tk.innerHTML = `<h4>${t('res.ticket')}</h4>` +
        p.tickets.map(x =>
          `<div class="tk-row"><span>${t('res.row', {
            where: `${t('src.' + x.src)} · ${x.place}`,
            speed: x.speed, limit: x.limit, excess: x.excess,
          })}</span><span>${money(x.fine)}</span></div>`
        ).join('') +
        `<div class="tk-row"><span>${t('res.pointsrow')}</span><span>${p.points}</span></div>` +
        (ban > 0 ? `<div class="tk-row"><span>${t('res.ban')}</span><span>${t(ban > 1 ? 'res.months' : 'res.month', { n: ban })}</span></div>` : '') +
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
        case 'flash': {
          const p = ev.penalty;
          this.hud.blitzFlash();
          this.audio.flash();
          // a burst of cameras collapses into one row with a running total
          // ?? not || — raceTime is legitimately 0 during the countdown, and
          // `0 || -99` reads as "no previous flash", resetting the run every time
          const now = this.raceTime;
          if (now - (this._flashT ?? -99) > 12) { this._flashN = 0; this._flashSum = 0; }
          this._flashT = now;
          this._flashN = (this._flashN ?? 0) + 1;
          this._flashSum = (this._flashSum ?? 0) + p.fine;
          const head = this._flashN > 1
            ? t('a.flash.multi', { n: this._flashN, fine: this._flashSum })
            : t('a.flash', { fine: p.fine });
          const sub = t('a.flash.sub', { speed: Math.round(ev.speed), limit: ev.limit })
            + (p.points ? t('a.flash.points', { n: p.points }) : '');
          // the head already carries the ×N and the running total
          this.hud.alert(head, sub, 'bad', 5, 'flash', false);
          break;
        }
        case 'lichthupe':
          this.hud.alert(t('a.warn'),
            ev.threat.kind === 'blitzer'
              ? t('a.warn.blitzer', { m: Math.round(ev.threat.rel / 100) * 100 })
              : t('a.warn.zivi'),
            'warn', 4, 'warn');
          break;
        case 'escaped':
          this.hud.alert(t('a.escaped'), t('a.escaped.sub'), 'good', 3.5, 'pursuit');
          break;
        case 'stopped':
          this.hud.alert(t('a.stopped'), t('a.stopped.sub'), 'bad', 8, 'pursuit');
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
      // hold a steady 90 km/h until the flag drops
      const hold = p.v < 25 ? 0.42 : 0.16;
      p.control(dt, { throttle: hold, brake: 0, steer: inp.steer * 0.5, handbrake: false }, this.traffic);
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
    if (p.scrape) this.shake = Math.max(this.shake, 0.05);
    if (p.offroad && p.v > 12) this.shake = Math.max(this.shake, 0.035);

    p.sync(dt);
    this.updateCamera(dt);
    this.updateTunnel(dt);
    this.world.update(dt, p.mesh.position);

    // ---- HUD
    const cop = this.enf.activeCop;
    const copGap = cop ? p.s - cop.s : 0;
    const field = this.standings();
    const place = field.findIndex(f => f.me) + 1;
    this.hud.update({
      s: p.s, raceTime: this.raceTime, place, fieldSize: field.length,
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
    if (p.s >= LENGTH - 8) this.finish();
    else if (p.damage >= 100 && p.v < 2) this.outOfRace(t('dnf.wreck'));
    else if (p.points >= 8) this.outOfRace(t('dnf.points'));
  }

  /* ----------------------------------------------------------- main loop */
  startLoop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const racing = this.state === 'race';
      if (racing) this.step(dt);
      this.input.endFrame();
      // the mirror is a small strip; 30 Hz is indistinguishable and halves its cost
      this._mirrorTick = ((this._mirrorTick || 0) + 1) % 2;
      if (racing && !this.paused && this._mirrorTick === 0) this.renderMirror();
      this.renderer.render(this.scene, this.camera);
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
