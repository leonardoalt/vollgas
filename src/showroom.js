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
import { buildCar, CARS } from './carFactory.js';

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
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    // studio rig: soft fill, a key from the front quarter, a cool rim behind
    this.scene.add(new THREE.HemisphereLight(0xdfeaf6, 0x2a2f36, 1.5));
    const key = new THREE.DirectionalLight(0xfff4e4, 2.6);
    key.position.set(-5, 5.5, 7); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.5);
    rim.position.set(6, 3.5, -6); this.scene.add(rim);
    const top = new THREE.DirectionalLight(0xffffff, 0.7);
    top.position.set(0, 9, 0.5); this.scene.add(top);

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
