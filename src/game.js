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
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.32, 5200);

    const setText = (t) => { const el = $('load-text'); if (el) el.textContent = t + ' …'; };
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
    this.buildMenu();
    $('loading').classList.add('done');
    this.state = 'menu';
    this.startLoop();
  }

  onResize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
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
    $('car-detail-sub').textContent = `${spec.marque} · ${spec.perf.awd ? 'Allrad' : 'Hinterrad'} · ${spec.perf.gears}-Gang`;
    const p = spec.perf;
    const stats = [
      ['V max', p.vmax, 340, `${p.vmax} km/h`],
      ['Leistung', p.power, 500, `${Math.round(p.power * 1.36)} PS`],
      ['Kg / kW', 1 - (p.mass / p.power) / 6, 1, `${(p.mass / p.power).toFixed(1)}`],
      ['Grip', p.grip, 1.5, `${p.grip.toFixed(2)} g`],
      ['Gewicht', 1 - (p.mass - 1500) / 800, 1, `${p.mass} kg`],
    ];
    $('car-stats').innerHTML = stats.map(([l, v, max, txt]) =>
      `<div class="stat"><span class="sl">${l}</span><span class="sb"><i style="width:${Math.max(4, Math.min(100, (v / max) * 100)).toFixed(0)}%"></i></span><span class="sv">${txt}</span></div>`
    ).join('');
    $('car-blurb').textContent = spec.blurb;
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
    this.finished = false;
    this.results = null;
    this.state = 'race';
    this.hud.show(true);
    $('menu').classList.add('hidden');
    $('results').classList.add('hidden');
    this.audio.start();
    this.audio.resume();
    this.hud.alert('A 81 · STUTTGART → SINGEN', `${STAGE_KM} km · freie Abschnitte nutzen`, 'info', 4.5);
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
      { name: 'DU', s: this.player.s, me: true, v: this.player.v, finishT: this.player.finishT },
      ...this.traffic.rivals.map(r => ({ name: r.name, s: r.s, v: r.v, finishT: r.finished ? r.finishT : null, car: r.spec.name })),
    ];
    field.sort((a, b) => b.s - a.s);
    return field;
  }

  finish() {
    this.finished = true;
    this.player.finishT = this.raceTime;
    const field = [
      { name: 'DU', car: CARS[this.carId].name, t: this.raceTime, me: true, s: LENGTH, fines: this.player.fines },
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
    this.showResults();
  }

  outOfRace(reason) {
    this.finished = true;
    const field = [
      { name: 'DU', car: CARS[this.carId].name, t: Infinity, me: true, dnf: reason },
      ...this.traffic.rivals.map(r => ({
        name: r.name, car: r.spec.name,
        t: r.finished ? r.finishT : this.raceTime + Math.max(1, (LENGTH - r.s) / Math.max(8, r.v)),
      })),
    ];
    field.sort((a, b) => a.t - b.t);
    this.results = { field, place: field.length, dnf: reason };
    this.state = 'results';
    this.hud.show(false);
    this.showResults();
  }

  showResults() {
    const r = this.results;
    const p = this.player;
    $('results-title').textContent = r.dnf ? 'RENNEN BEENDET' : 'ZIEL · SINGEN (BODENSEE)';
    const places = ['SIEG', 'ZWEITER', 'DRITTER', 'VIERTER'];
    $('results-place').textContent = r.dnf ? r.dnf : `${places[r.place - 1] || r.place + '.'} · V max ${Math.round(p.vmaxSeen)} km/h`;

    const fmt = (t) => t === Infinity ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    $('results-table').innerHTML =
      '<tr><th>Pos</th><th>Fahrer</th><th>Fahrzeug</th><th class="n">Bußgeld</th><th class="n">Zeit</th></tr>' +
      r.field.map((f, i) => `<tr class="${f.me ? 'me' : ''}"><td>${i + 1}</td><td>${f.name}</td><td>${f.car || ''}</td><td class="n">${f.fines ? f.fines + ' €' : '—'}</td><td class="n">${fmt(f.t)}</td></tr>`).join('');

    const tk = $('results-ticket');
    if (p.tickets.length === 0) {
      tk.className = 'clean';
      tk.innerHTML = `<h4>Kein Bußgeldbescheid</h4>Sauber durchgekommen. Keine Messung, kein Blitzer, keine Punkte.
        <div class="tk-total"><span>Gesamt</span><span>0,00 €</span></div>`;
    } else {
      tk.className = 'dirty';
      const ban = Math.max(...p.tickets.map(t => t.ban));
      tk.innerHTML = `<h4>Bußgeldbescheid · Regierungspräsidium Karlsruhe</h4>` +
        p.tickets.map(t =>
          `<div class="tk-row"><span>${t.where} — ${t.speed} statt ${t.limit} km/h (+${t.excess})</span><span>${t.fine},00 €</span></div>`
        ).join('') +
        `<div class="tk-row"><span>Punkte im Fahreignungsregister Flensburg</span><span>${p.points}</span></div>` +
        (ban > 0 ? `<div class="tk-row"><span>Fahrverbot</span><span>${ban} Monat${ban > 1 ? 'e' : ''}</span></div>` : '') +
        `<div class="tk-total"><span>Gesamt</span><span>${p.fines},00 €</span></div>`;
    }
    $('results').classList.remove('hidden');
  }

  /* ---------------------------------------------------------- event pump */
  handleEvents() {
    for (const ev of this.enf.drainEvents()) {
      switch (ev.type) {
        case 'measure-start':
          this.hud.alert('ZIVILSTREIFE HÄNGT DRAN', 'ProViDa-Messung beginnt', 'bad', 4);
          this.audio.blip();
          break;
        case 'measure-abort':
          this.hud.alert('MESSUNG ABGEBROCHEN', 'Rechtzeitig vom Gas gegangen', 'good', 3);
          break;
        case 'measure-lost':
          this.hud.alert('ABGEHÄNGT', 'Die Messung ist nicht verwertbar', 'good', 3);
          break;
        case 'measure-done': {
          const p = ev.penalty;
          this.hud.alert(`ANZEIGE · ${p.fine} €`,
            `${Math.round(ev.speed)} statt ${ev.limit} km/h · ${p.points} Punkt${p.points === 1 ? '' : 'e'}${p.ban ? ` · ${p.ban} Mon. Fahrverbot` : ''}`,
            'bad', 6);
          this.hud.alert('STOP POLIZEI — BITTE FOLGEN', 'Abhängen oder anhalten', 'bad', 6);
          break;
        }
        case 'flash': {
          const p = ev.penalty;
          this.hud.blitzFlash();
          this.audio.flash();
          this.hud.alert(`GEBLITZT · ${p.fine} €`,
            `${Math.round(ev.speed)} statt ${ev.limit} km/h${p.points ? ` · ${p.points} Punkte` : ''}`, 'bad', 5);
          break;
        }
        case 'lichthupe':
          this.hud.alert('LICHTHUPE VOM GEGENVERKEHR',
            ev.threat.kind === 'blitzer' ? `Blitzer in ca. ${Math.round(ev.threat.rel / 100) * 100} m` : `Zivilstreife voraus`,
            'warn', 4);
          break;
        case 'escaped':
          this.hud.alert('VERFOLGUNG ABGEBROCHEN', 'Sie sind weg', 'good', 3.5);
          break;
        case 'stopped':
          this.hud.alert('VERKEHRSKONTROLLE', 'Rechts ranfahren · Führerschein und Fahrzeugpapiere', 'bad', 8);
          break;
      }
    }
  }

  /* --------------------------------------------------------------- update */
  step(dt) {
    const inp = this.input.update(dt);

    if (this.input.tapped('c')) this.camMode = (this.camMode + 1) % CAM_MODES.length;
    if (this.input.tapped('m')) { this.muted = !this.muted; this.audio.setMuted(this.muted); }
    if (this.input.tapped('p')) { this.paused = !this.paused; $('pause').classList.toggle('hidden', !this.paused); }
    if (this.input.tapped('r')) { this.startRace(); return; }
    if (this.paused) return;

    const p = this.player;

    // countdown
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before) {
        if (after > 0) { this.hud.alert(String(after), '', 'info', 0.9); this.audio.blip(); }
        else { this.hud.alert('LOS!', 'Bis Böblingen gilt noch ein Limit', 'good', 1.8); this.audio.blip(); }
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
      if (kind === 'rear' && sev > 0.55) this.hud.alert('AUFFAHRUNFALL', 'Schaden am Fahrzeug', 'bad', 2.6);
    }, dt);
    if (p.scrape) this.shake = Math.max(this.shake, 0.05);
    if (p.offroad && p.v > 12) this.shake = Math.max(this.shake, 0.035);

    p.sync(dt);
    this.updateCamera(dt);
    this.updateTunnel(dt);
    this.world.update(dt, p.mesh.position);

    // ---- HUD
    const cop = this.enf.activeCop;
    const field = this.standings();
    const place = field.findIndex(f => f.me) + 1;
    this.hud.update({
      s: p.s, raceTime: this.raceTime, place, fieldSize: field.length,
      vmaxSeen: p.vmaxSeen, fines: p.fines, points: p.points, damage: p.damage,
      provida: cop && cop.state === COP_STATE.MEASURE ? cop.measure : 0,
      pursuit: !!(cop && cop.state === COP_STATE.PURSUE),
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
    else if (p.damage >= 100 && p.v < 2) this.outOfRace('Fahrzeug nicht mehr fahrbereit · Abschleppdienst');
    else if (p.points >= 8) this.outOfRace('8 Punkte in Flensburg · Fahrerlaubnis entzogen');
  }

  /* ----------------------------------------------------------- main loop */
  startLoop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.state === 'race') this.step(dt);
      else if (this.state === 'menu' && this.player) { /* keep last frame */ }
      this.input.endFrame();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
