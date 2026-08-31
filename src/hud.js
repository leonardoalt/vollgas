/* ==========================================================================
   hud.js — instrument cluster, rear-space radar and the DOM overlays.
   ========================================================================== */
import { LENGTH, GEO, sectionAt } from './track.js';

const DIN = '"Roboto Condensed","Arial Narrow",Helvetica,Arial,sans-serif';
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), section: $('hud-section-name'), sub: $('hud-section-sub'),
      time: $('hud-time'), pos: $('hud-pos'), dist: $('hud-dist'), vmax: $('hud-vmax'),
      progFill: $('hud-progress-fill'), progMe: $('hud-progress-me'),
      limit: $('hud-limit'), fine: $('hud-fine'), points: $('hud-points'), damage: $('hud-damage'),
      alerts: $('hud-alerts'), provida: $('hud-provida'), pvFill: document.querySelector('.pv-fill'),
      pvSub: document.querySelector('.pv-sub'), pvHead: document.querySelector('.pv-head'),
      flash: $('flash'), vignette: $('vignette'), countdown: $('countdown'),
    };
    this.tacho = $('tacho');
    this.tctx = this.tacho.getContext('2d');
    this.radar = $('radar');
    this.rctx = this.radar.getContext('2d');
    this.alerts = [];
    this._lastLimit = undefined;
    this._lastSection = undefined;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  /* ------------------------------------------------------------- alerts */
  alert(text, sub = '', kind = 'warn', ttl = 3.4) {
    // collapse duplicates that are still on screen
    for (const a of this.alerts) if (a.text === text) { a.t = 0; return; }
    const div = document.createElement('div');
    div.className = 'alert ' + kind;
    div.innerHTML = `<div>${text}${sub ? `<small>${sub}</small>` : ''}</div>`;
    this.el.alerts.appendChild(div);
    this.alerts.push({ el: div, t: 0, ttl, text });
    while (this.alerts.length > 4) this._killAlert(this.alerts[0]);
  }
  _killAlert(a) {
    a.el.classList.add('fade');
    setTimeout(() => a.el.remove(), 380);
    this.alerts.splice(this.alerts.indexOf(a), 1);
  }
  stepAlerts(dt) {
    for (const a of [...this.alerts]) {
      a.t += dt;
      if (a.t > a.ttl) this._killAlert(a);
    }
  }

  /** Big centred numeral for the start countdown; `text` null hides it. */
  countdown(text, go = false) {
    const el = this.el.countdown;
    if (text == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('go', go);
    const span = el.firstElementChild;
    span.textContent = text;
    // restart the animation
    span.style.animation = 'none';
    void span.offsetWidth;
    span.style.animation = '';
  }

  blitzFlash() { const f = this.el.flash; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

  /* --------------------------------------------------------- limit sign */
  setLimit(limit, advice) {
    const el = this.el.limit;
    const key = limit + '|' + advice;
    if (key === this._lastLimit) return;
    this._lastLimit = key;
    el.className = 'limit-sign';
    if (limit === Infinity) {
      el.classList.add(advice ? 'limit-advice' : 'limit-none');
      el.innerHTML = advice ? '<span>130</span>' : '<span></span>';
    } else {
      el.innerHTML = `<span>${limit}</span>`;
    }
  }

  /* --------------------------------------------------------- text panel */
  update(st) {
    const e = this.el;
    const sec = sectionAt(st.s);
    if (sec.name !== this._lastSection) {
      this._lastSection = sec.name;
      e.section.textContent = sec.name;
      e.sub.textContent = sec.sub;
    }
    this.setLimit(sec.limit == null ? Infinity : sec.limit, !!sec.advice);

    const t = Math.max(0, st.raceTime);
    const mm = Math.floor(t / 60), ss = (t - mm * 60);
    e.time.textContent = `${mm}:${ss.toFixed(1).padStart(4, '0')}`;
    e.pos.textContent = `${st.place}/${st.fieldSize}`;
    const left = Math.max(0, (LENGTH - st.s) / 1000);
    e.dist.textContent = left < 1 ? `${Math.round(left * 1000)} m` : `${left.toFixed(1)} km`;
    e.vmax.textContent = Math.round(st.vmaxSeen);
    e.fine.textContent = `${st.fines} €`;
    e.points.textContent = `${st.points} P`;
    e.damage.textContent = `${Math.round(st.damage)} %`;
    e.fine.classList.toggle('hot', st.fines > 0);
    e.points.classList.toggle('hot', st.points > 0);
    e.damage.classList.toggle('hot', st.damage > 55);

    const frac = Math.min(1, st.s / LENGTH);
    e.progFill.style.width = (frac * 100).toFixed(2) + '%';
    e.progMe.style.left = (frac * 100).toFixed(2) + '%';

    const measuring = st.provida > 0;
    e.provida.classList.toggle('hidden', !measuring);
    if (measuring) {
      e.pvFill.style.width = (Math.min(1, st.provida) * 100).toFixed(1) + '%';
      const gap = Math.max(0, Math.round(st.providaGap));
      e.pvHead.innerHTML =
        `<span class="pv-dot"></span> P R O V I D A &nbsp;·&nbsp; MESSUNG L\u00c4UFT &nbsp;·&nbsp; ${gap} m`;
      e.pvSub.textContent = gap > 240
        ? 'Abstand w\u00e4chst \u2014 dranbleiben und die Messung platzt'
        : 'Zivilfahrzeug hinter dir \u2014 abbremsen oder abh\u00e4ngen';
    }
    e.vignette.classList.toggle('on', st.pursuit || st.damage > 80);
  }

  /* ============================================================== tacho */
  drawTacho(st) {
    const c = this.tctx, W = this.tacho.width, H = this.tacho.height;
    const cx = W / 2, cy = H / 2, R = W * 0.44;
    c.clearRect(0, 0, W, H);

    // bezel
    c.save();
    const bg = c.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 1.08);
    bg.addColorStop(0, 'rgba(26,31,37,.92)');
    bg.addColorStop(1, 'rgba(8,10,13,.94)');
    c.fillStyle = bg;
    c.beginPath(); c.arc(cx, cy, R * 1.06, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = W * 0.008;
    c.beginPath(); c.arc(cx, cy, R * 1.06, 0, 7); c.stroke();

    const A0 = Math.PI * 0.76, A1 = Math.PI * 2.24;      // sweep
    const redline = st.redline || 7000;
    const maxRpm = Math.ceil((redline + 800) / 1000) * 1000;
    const ang = (rpm) => A0 + (A1 - A0) * Math.min(1, Math.max(0, rpm / maxRpm));

    // red zone
    c.strokeStyle = '#c8202a'; c.lineWidth = W * 0.026;
    c.beginPath(); c.arc(cx, cy, R * 0.88, ang(redline), A1); c.stroke();
    // track
    c.strokeStyle = 'rgba(255,255,255,.16)';
    c.beginPath(); c.arc(cx, cy, R * 0.88, A0, ang(redline)); c.stroke();

    // ticks + numbers
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let r = 0; r <= maxRpm; r += 500) {
      const a = ang(r), maj = r % 1000 === 0;
      const r0 = R * (maj ? 0.72 : 0.78), r1 = R * 0.845;
      c.strokeStyle = r >= redline ? 'rgba(255,120,110,.9)' : 'rgba(255,255,255,' + (maj ? '.72' : '.34') + ')';
      c.lineWidth = maj ? W * 0.009 : W * 0.005;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
      if (maj) {
        c.fillStyle = r >= redline ? '#ff8a7d' : 'rgba(255,255,255,.66)';
        c.font = `700 ${W * 0.052}px ${DIN}`;
        c.fillText(String(r / 1000), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
      }
    }

    // rev needle
    const a = ang(st.rpm);
    c.save();
    c.translate(cx, cy); c.rotate(a);
    c.fillStyle = st.rpm >= redline ? '#ff4a3a' : '#eaf2ff';
    c.beginPath();
    c.moveTo(-R * 0.10, -W * 0.012); c.lineTo(R * 0.83, -W * 0.006);
    c.lineTo(R * 0.83, W * 0.006); c.lineTo(-R * 0.10, W * 0.012);
    c.closePath(); c.fill();
    c.restore();
    c.fillStyle = '#20262d';
    c.beginPath(); c.arc(cx, cy, W * 0.035, 0, 7); c.fill();

    // digital speed, on a plate below the needle hub
    const kmh = Math.round(st.kmh);
    const pw = W * 0.44, ph = W * 0.235;
    c.fillStyle = 'rgba(9,12,16,.82)';
    c.beginPath();
    const px = cx - pw / 2, py = cy + R * 0.04, rr = W * 0.022;
    c.moveTo(px + rr, py);
    c.arcTo(px + pw, py, px + pw, py + ph, rr);
    c.arcTo(px + pw, py + ph, px, py + ph, rr);
    c.arcTo(px, py + ph, px, py, rr);
    c.arcTo(px, py, px + pw, py, rr);
    c.closePath(); c.fill();
    c.fillStyle = '#fff';
    c.font = `700 ${W * 0.185}px ${DIN}`;
    c.fillText(String(kmh), cx, cy + R * 0.155);
    c.fillStyle = 'rgba(255,255,255,.45)';
    c.font = `400 ${W * 0.046}px ${DIN}`;
    c.fillText('km/h', cx, cy + R * 0.35);

    // gear, on its own plate so the rev needle can sweep over it
    const gw = W * 0.155, gh = W * 0.135, gy = cy - R * 0.585;
    c.fillStyle = 'rgba(9,12,16,.86)';
    c.beginPath();
    const grr = W * 0.018;
    c.moveTo(cx - gw / 2 + grr, gy);
    c.arcTo(cx + gw / 2, gy, cx + gw / 2, gy + gh, grr);
    c.arcTo(cx + gw / 2, gy + gh, cx - gw / 2, gy + gh, grr);
    c.arcTo(cx - gw / 2, gy + gh, cx - gw / 2, gy, grr);
    c.arcTo(cx - gw / 2, gy, cx + gw / 2, gy, grr);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.28)';
    c.font = `400 ${W * 0.032}px ${DIN}`;
    c.fillText('GANG', cx, gy + gh * 0.24);
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.font = `700 ${W * 0.078}px ${DIN}`;
    c.fillText(st.stopped ? 'P' : String(st.gear + 1), cx, gy + gh * 0.66);
    c.restore();
  }

  /* ============================================================== radar */
  drawRadar(st) {
    const c = this.rctx, W = this.radar.width, H = this.radar.height;
    c.clearRect(0, 0, W, H);
    const RANGE = 170;                       // metres shown fore and aft
    // only our own carriageway is worth the pixels
    const U0 = GEO.pavedIn - 1.6, U1 = GEO.pavedOut + 1.6;
    const sx = (u) => ((u - U0) / (U1 - U0)) * W;
    const sy = (ds) => H / 2 - (ds / (RANGE * 2)) * H;

    c.fillStyle = 'rgba(255,255,255,.08)';
    c.fillRect(sx(GEO.pavedIn), 0, sx(GEO.pavedOut) - sx(GEO.pavedIn), H);
    c.fillStyle = 'rgba(255,255,255,.05)';   // hard shoulder
    c.fillRect(sx(GEO.kerbOut), 0, sx(GEO.pavedOut) - sx(GEO.kerbOut), H);
    // lane divider
    c.strokeStyle = 'rgba(255,255,255,.20)'; c.lineWidth = 1;
    c.setLineDash([5, 8]);
    c.beginPath(); c.moveTo(sx(GEO.pavedIn + 0.5 + GEO.laneWidth), 0); c.lineTo(sx(GEO.pavedIn + 0.5 + GEO.laneWidth), H); c.stroke();
    c.setLineDash([]);

    const blip = (u, ds, len, wid, fill, glow) => {
      const x = sx(u), y = sy(ds);
      const w = Math.max(7, (wid / (U1 - U0)) * W);
      const h = Math.max(5, (len / (RANGE * 2)) * H);
      if (glow) { c.shadowColor = glow; c.shadowBlur = 9; }
      c.fillStyle = fill;
      c.beginPath();
      const r = Math.min(2.5, w / 2);
      c.moveTo(x - w / 2 + r, y - h / 2);
      c.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
      c.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
      c.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
      c.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
      c.closePath(); c.fill();
      c.shadowBlur = 0;
    };

    for (const o of st.others) {
      const ds = o.s - st.s;
      if (Math.abs(ds) > RANGE || o.u < U0 - 3 || o.u > U1 + 3) continue;
      let col = 'rgba(215,220,226,.72)';
      let glow = null;
      if (o.kind === 'rival') col = '#5fb2ff';
      if (o.kind === 'police' && o.hot) { col = '#ff4438'; glow = '#ff4438'; }
      blip(o.u, ds, o.halfLen * 2, o.halfWid * 2, col, glow);
    }
    // us
    blip(st.u, 0, st.halfLen * 2, st.halfWid * 2, '#ffffff', '#9ad6ff');

    // range ticks
    c.fillStyle = 'rgba(255,255,255,.28)';
    c.font = `400 9px ${DIN}`;
    c.textAlign = 'left';
    c.fillText('+150 m', 4, 12);
    c.fillText('-150 m', 4, H - 6);
  }
}
