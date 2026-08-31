/* ==========================================================================
   showroom.js — the car pictures on the menu.

   These are live renders of the same models you drive, not photographs. That
   sidesteps the licensing question entirely (the geometry is ours and none of
   the cars carries a real marque's badge) and it has the nicer property of
   showing you the actual car rather than something that resembles it.

   Runs on its own small WebGL context so it can sit in a DOM card with a
   transparent background, and is parked while you are driving.
   ========================================================================== */
import * as THREE from 'three';
import { buildCar, CARS, retargetEnv } from './carFactory.js';
import { studioEnv } from './carEnv.js';

export class Showroom {
  constructor(canvas) {
    this.ok = false;
    this.cars = new Map();
    this.thumbs = new Map();
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true,
        preserveDrawingBuffer: true,          // so thumbnails can be read back
      });
    } catch {
      return;                                  // no second context: caller falls back
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();

    /* A photographic studio, as an HDR environment rather than as lamps: three
       softboxes and a long overhead strip (see carEnv.js). The strip is what
       draws the single long highlight down the shoulder line, which is the
       thing that makes a car photograph look like a car photograph — four
       point lights cannot do it at any intensity.

       It has to be built here rather than reused from the game, because a
       PMREM result lives on the GPU of the renderer that made it and this is a
       second context. `retargetEnv` re-points each car's materials at it. */
    this.env = studioEnv(this.renderer);
    this.scene.environment = this.env;
    this.matCache = new Map();

    // one soft key on top of the environment, so edges keep a little bite
    const key = new THREE.DirectionalLight(0xfff2df, 1.15);
    key.position.set(-5, 5.5, 7); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8cbff, 0.55);
    rim.position.set(6, 3.5, -6); this.scene.add(rim);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    this.camera = new THREE.PerspectiveCamera(27, 2, 0.1, 100);
    this.angle = 0.55;
    this.ok = true;
  }

  /** Build (once) and show one car. */
  setCar(id, paint) {
    if (!this.ok) return;
    const key = id + ':' + paint;
    let car = this.cars.get(key);
    if (!car) {
      car = buildCar(id, { paint, glow: false });
      retargetEnv(car, this.env, this.matCache);
      // sit it on the ground and centre it on the turntable
      car.position.set(0, 0, 0);
      this.cars.set(key, car);
    }
    if (this.current !== car) {
      if (this.current) this.turntable.remove(this.current);
      this.turntable.add(car);
      this.current = car;
      this.dims = CARS[id].dims;
    }
  }

  _frame(w, h, tight = 1) {
    const d = this.dims || { length: 5, height: 1.5 };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const dist = d.length * 1.28 * tight;
    const el = 0.165;
    this.camera.position.set(
      Math.cos(this.angle) * Math.cos(el) * dist,
      d.height * 0.62 + Math.sin(el) * dist,
      Math.sin(this.angle) * Math.cos(el) * dist);
    this.camera.lookAt(0, d.height * 0.46, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Slow turntable; call each frame while the menu is up. */
  render(dt, w, h) {
    if (!this.ok || !this.current) return;
    this.turntable.rotation.y += dt * 0.22;
    this._frame(w, h);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * A still, three-quarter front thumbnail as a data URL. Rendered once per
   * car and cached; used for the list on the left of the menu.
   */
  /** A previously rendered thumbnail, or null — never renders. */
  cachedThumb(id, paint, w = 232, h = 116) {
    return this.thumbs.get(`${id}:${paint}:${w}x${h}`) || null;
  }

  thumbnail(id, paint, w = 232, h = 116) {
    if (!this.ok) return null;
    const key = `${id}:${paint}:${w}x${h}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const prev = this.current, prevRot = this.turntable.rotation.y;
    this.setCar(id, paint);
    this.turntable.rotation.y = -0.34;
    this._frame(w, h, 0.94);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.thumbs.set(key, url);
    this.turntable.rotation.y = prevRot;
    if (prev && prev !== this.current) {
      this.turntable.remove(this.current);
      this.turntable.add(prev);
      this.current = prev;
    }
    return url;
  }

  dispose() {
    if (!this.ok) return;
    for (const c of this.cars.values()) this.turntable.remove(c);
    this.renderer.dispose();
    this.ok = false;
  }
}
