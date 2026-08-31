/* ==========================================================================
   postfx.js — a small, hand-rolled bloom.

   Why not EffectComposer + UnrealBloomPass: the game does not render once. It
   renders the world, then a rear-view mirror into a render target, then a
   screen-space overlay on top with autoClear off, and it drives
   `toneMappingExposure` from the tunnel code. UnrealBloomPass expects to own
   the whole frame and OutputPass would tone-map a second time on top of the
   tone mapping the scene pass already applied. Five small passes of our own
   are easier to reason about and cheaper:

     1. the scene into a multisampled half-float target (MSAA is kept — losing
        it to gain bloom would be a bad trade on car bodywork)
     2. a bright-pass downsample to quarter resolution
     3/4. separable Gaussian blur, run twice at widening radius
     5. composite back to the canvas, doing the sRGB conversion ourselves so
        the frame is not tone-mapped twice

   The effect is deliberately restrained. Its job is the sun glinting off a
   clearcoat, brake lights at night in the Engelbergtunnel and the blue LEDs of
   a patrol car behind you — not a haze over everything.
   ========================================================================== */
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  // soft knee so a highlight fades in instead of popping on
  float w = clamp((l - threshold) / max(knee, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(c * w * w, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  // 9-tap Gaussian, weights for sigma ~2
  float w[5];
  w[0] = 0.2270270; w[1] = 0.1945946; w[2] = 0.1216216;
  w[3] = 0.0540541; w[4] = 0.0162162;
  vec3 s = texture2D(tSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = dir * float(i);
    s += texture2D(tSrc, vUv + o).rgb * w[i];
    s += texture2D(tSrc, vUv - o).rgb * w[i];
  }
  gl_FragColor = vec4(s, 1.0);
}`;

const COMP_FRAG = /* glsl */`
#include <colorspace_pars_fragment>
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float strength;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tScene, vUv).rgb;
  vec3 glow = texture2D(tBloom, vUv).rgb;
  gl_FragColor = vec4(base + glow * strength, 1.0);
  #include <colorspace_fragment>
}`;

function rt(w, h, samples = 0) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: samples > 0,
    stencilBuffer: false,
    samples,
  });
  t.texture.colorSpace = THREE.NoColorSpace;
  t.texture.generateMipmaps = false;
  return t;
}

/**
 * @returns an object with render(scene, camera) / setSize(w,h) / dispose(),
 *          or null if the device cannot give us a float target — in which case
 *          the caller should just render normally.
 */
export function createPostFX(renderer, w, h, opts = {}) {
  if (!renderer.capabilities.isWebGL2) return null;
  let scene, quad, cam, mats, targets;
  try {
    const pr = renderer.getPixelRatio();
    const W = Math.round(w * pr), H = Math.round(h * pr);

    mats = {
      bright: new THREE.ShaderMaterial({
        uniforms: {
          tSrc: { value: null },
          threshold: { value: opts.threshold ?? 0.68 },
          knee: { value: 0.30 },
        },
        vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG,
        depthTest: false, depthWrite: false,
      }),
      blur: new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() } },
        vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
        depthTest: false, depthWrite: false,
      }),
      comp: new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: null }, tBloom: { value: null },
          strength: { value: opts.strength ?? 0.62 },
        },
        vertexShader: QUAD_VERT, fragmentShader: COMP_FRAG,
        depthTest: false, depthWrite: false,
      }),
    };

    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mats.comp);
    quad.frustumCulled = false;
    scene = new THREE.Scene();
    scene.add(quad);
    cam = new THREE.Camera();

    const samples = Math.min(4, renderer.capabilities.maxSamples || 0);
    targets = {
      scene: rt(W, H, samples),
      a: rt(W >> 2, H >> 2),
      b: rt(W >> 2, H >> 2),
    };
  } catch (e) {
    console.warn('postfx unavailable:', e && e.message);
    return null;
  }

  const blit = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  };

  return {
    get sceneTarget() { return targets.scene; },

    render(worldScene, worldCam) {
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(targets.scene);
      renderer.clear();
      renderer.render(worldScene, worldCam);

      mats.bright.uniforms.tSrc.value = targets.scene.texture;
      blit(mats.bright, targets.a);

      const w4 = targets.a.width, h4 = targets.a.height;
      // two passes at widening radius: a tight core plus a soft halo
      for (const scale of [1.0, 2.4]) {
        mats.blur.uniforms.tSrc.value = targets.a.texture;
        mats.blur.uniforms.dir.value.set(scale / w4, 0);
        blit(mats.blur, targets.b);
        mats.blur.uniforms.tSrc.value = targets.b.texture;
        mats.blur.uniforms.dir.value.set(0, scale / h4);
        blit(mats.blur, targets.a);
      }

      mats.comp.uniforms.tScene.value = targets.scene.texture;
      mats.comp.uniforms.tBloom.value = targets.a.texture;
      blit(mats.comp, null);
      renderer.setRenderTarget(prevTarget);
    },

    setSize(nw, nh) {
      const pr = renderer.getPixelRatio();
      const W = Math.round(nw * pr), H = Math.round(nh * pr);
      targets.scene.setSize(W, H);
      targets.a.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
      targets.b.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    },

    set strength(v) { mats.comp.uniforms.strength.value = v; },

    dispose() {
      for (const t of Object.values(targets)) t.dispose();
      for (const m of Object.values(mats)) m.dispose();
      quad.geometry.dispose();
    },
  };
}
