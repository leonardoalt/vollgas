/* ==========================================================================
   perfHud.js — a frame-time readout you can trust.

   Every triangle and draw-call figure in this project was measured on headless
   Chromium against a software rasteriser, where frame rate is meaningless. So
   the only honest way to answer "does it actually run" is to let someone check
   on real hardware.

   Press F, or load with ?stats=1. Off by default and it costs nothing when
   off: the DOM node is not even created until it is first shown.

   Frame time is reported as a rolling mean *and* the worst frame in the
   window, because the mean hides exactly the stutter you care about — one
   45 ms frame every second reads as a comfortable 55 fps on average.
   ========================================================================== */

const CSS = 'position:fixed;left:12px;top:96px;z-index:60;pointer-events:none;'
  + 'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;'
  + 'color:#cfe0f0;background:rgba(6,9,13,.62);border:1px solid rgba(255,255,255,.10);'
  + 'border-radius:4px;padding:6px 9px;white-space:pre;letter-spacing:.02em;'
  + 'text-shadow:0 1px 2px rgba(0,0,0,.8);';

export function createPerfHud(opts = {}) {
  const WINDOW = 45;
  const times = new Float32Array(WINDOW);
  let n = 0, i = 0, last = 0;
  let el = null;
  let visible = !!opts.visible;
  let acc = 0;

  const ensure = () => {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'perf-hud';
    el.style.cssText = CSS;
    document.body.appendChild(el);
    return el;
  };

  const setVisible = (v) => {
    visible = v;
    if (!v) { if (el) el.style.display = 'none'; return; }
    ensure().style.display = 'block';
  };
  if (visible) setVisible(true);

  addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      setVisible(!visible);
    }
  });

  return {
    get visible() { return visible; },
    setVisible,

    /**
     * @param _dt ignored — see below
     * @param stats {calls,tris}
     *
     * The frame delta the game loop passes around is clamped to 50 ms so that
     * a stall cannot fling the physics through a wall. Reporting fps from that
     * number would mean this readout could never show anything below 20 fps,
     * which is precisely the case it exists to catch — so measure wall time
     * here instead and ignore what we were handed.
     */
    update(_dt, stats) {
      const now = performance.now();
      const ms = last ? now - last : 16.7;
      last = now;
      times[i] = ms;
      i = (i + 1) % WINDOW;
      if (n < WINDOW) n++;
      if (!visible) return;
      acc += ms;
      if (acc < 250) return;          // repaint the text 4x a second, not 60
      acc = 0;
      let sum = 0, worst = 0;
      for (let k = 0; k < n; k++) { sum += times[k]; if (times[k] > worst) worst = times[k]; }
      const mean = sum / n;
      const fps = mean > 0 ? 1000 / mean : 0;
      const tris = stats && stats.tris ? stats.tris : 0;
      const calls = stats && stats.calls ? stats.calls : 0;
      ensure().textContent =
        `${fps.toFixed(0).padStart(3)} fps   ${mean.toFixed(1)} ms  (worst ${worst.toFixed(1)})\n`
        + `${calls.toLocaleString('en-GB').padStart(7)} draw calls\n`
        + `${tris.toLocaleString('en-GB').padStart(7)} triangles`;
    },
  };
}
