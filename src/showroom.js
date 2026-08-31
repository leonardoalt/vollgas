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
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/* Polished-floor shader for the turntable.

   three's stock ReflectorShader ends with `#include <tonemapping_fragment>`,
   but the reflection pass has *already* been tone-mapped on its way into the
   render target — so the stock shader tone-maps the same pixels twice and the
   reflection comes back muddy. This one skips that, tints the reflection down
   the way dark polished concrete does, smears it very slightly so it is not a
   perfect mirror, and fades out with radius so the disc has no visible edge. */
const FLOOR_SHADER = {
  name: 'StudioFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    fadeR: { value: 8.0 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vLocal;
    void main() {
      vLocal = position.xy;
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float fadeR;
    varying vec4 vUv;
    varying vec2 vLocal;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.44;
      c += texture2D(tDiffuse, uv + vec2(0.0, 0.0042)).rgb * 0.16;
      c += texture2D(tDiffuse, uv - vec2(0.0, 0.0042)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + vec2(0.0030, 0.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv - vec2(0.0030, 0.0)).rgb * 0.12;
      float d = clamp(1.0 - length(vLocal) / fadeR, 0.0, 1.0);
      gl_FragColor = vec4(c * color, pow(d, 1.7));
      #include <colorspace_fragment>
    }`,
};

/** Vertical studio gradient, drawn here so textures.js stays untouched. */
function backdrop() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, '#232a31');
  g.addColorStop(0.45, '#161b21');
  g.addColorStop(1.00, '#0b0e12');
  x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

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
    this.scene.background = backdrop();
    this.matCache = new Map();

    /* Polished floor with a real reflection of the car. Costs one extra scene
       render per frame on a small canvas, which the menu can easily afford, and
       it is most of what separates a studio photograph from a model floating in
       a void. */
    this.floor = new Reflector(new THREE.CircleGeometry(9, 56), {
      textureWidth: 1024, textureHeight: 1024,
      color: 0x9298a0, shader: FLOOR_SHADER, multisample: 4,
    });
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0.001;
    this.floor.material.transparent = true;
    this.floor.material.uniforms.fadeR.value = 8.4;
    this.scene.add(this.floor);

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
    const dist = d.length * 1.12 * tight;
    const el = 0.135;
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
