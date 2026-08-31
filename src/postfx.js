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

/* The sRGB encode is written out by hand rather than pulled in with
   `#include <colorspace_fragment>`. That include depends on three injecting
   `colorspace_pars_fragment` into the prologue, which it does for its own
   materials but which is an implementation detail — getting it wrong compiles
   on one driver and fails on the next, and a fragment shader that fails to
   compile here means the whole frame is black. This has no includes at all, so
   there is nothing to get wrong. */
const COMP_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float strength;
varying vec2 vUv;
vec3 encodeSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = pow(c, vec3(0.41666)) * 1.055 - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}
vec3 decodeSRGB(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(hi, lo, step(c, vec3(0.04045)));
}
void main() {
  vec3 base = texture2D(tScene, vUv).rgb;
  vec3 glow = texture2D(tBloom, vUv).rgb;
#ifdef DECODE_SRGB
  base = decodeSRGB(base);
  glow = decodeSRGB(glow);
#endif
  gl_FragColor = vec4(encodeSRGB(base + glow * strength), 1.0);
}`;

function rt(w, h, type, colorSpace, samples = 0) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: samples > 0,
    stencilBuffer: false,
    samples,
  });
  t.texture.colorSpace = colorSpace;
  t.texture.generateMipmaps = false;
  return t;
}

/**
 * @returns an object with render(scene, camera) / setSize(w,h) / dispose(),
 *          or null if the device cannot give us a float target — in which case
 *          the caller should just render normally.
 */
export function createPostFX(renderer, w, h, opts = {}) {
  if (!renderer || !renderer.capabilities || !renderer.capabilities.isWebGL2) return null;
  let scene, quad, cam, mats, targets, srgbInput = false;
  try {
    const pr = renderer.getPixelRatio();
    const W = Math.round(w * pr), H = Math.round(h * pr);

    /* Not every driver can render into a float target. Where one is available
       we keep highlights above 1.0, which is what makes the bloom pick out a
       sun glint rather than every pale surface; where it is not we fall back to
       an sRGB-encoded byte target and decode it again in the composite. */
    const ext = renderer.extensions;
    const canFloat = !!(ext && (ext.has('EXT_color_buffer_half_float')
      || ext.has('EXT_color_buffer_float')));
    srgbInput = !canFloat;
    const type = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const cs = canFloat ? THREE.NoColorSpace : THREE.SRGBColorSpace;

    mats = {
      bright: new THREE.ShaderMaterial({
        uniforms: {
          tSrc: { value: null },
          threshold: { value: opts.threshold ?? 0.80 },
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
        defines: srgbInput ? { DECODE_SRGB: '1' } : {},
        uniforms: {
          tScene: { value: null }, tBloom: { value: null },
          strength: { value: opts.strength ?? 0.38 },
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
      scene: rt(W, H, type, cs, samples),
      a: rt(W >> 2, H >> 2, type, cs),
      b: rt(W >> 2, H >> 2, type, cs),
    };
  } catch (e) {
    console.warn('postfx: setup failed, rendering without it —', e && e.message);
    return null;
  }

  const blit = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  };

  /* Feature detection, by actually running the thing.

     three does not throw when a shader fails to compile — it logs and the draw
     silently becomes a no-op, which for a full-screen composite means a black
     frame and no clue why. So push a known white pixel through all three
     materials into a 1x1 byte target and read it back. Anything that comes out
     black did not compile, and we decline the whole effect rather than hand the
     player a black screen. */
  const selfTest = () => {
    const probe = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    const white = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    white.needsUpdate = true;
    const black = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    black.needsUpdate = true;
    const buf = new Uint8Array(4);
    const lit = (mat) => {
      blit(mat, probe);
      renderer.readRenderTargetPixels(probe, 0, 0, 1, 1, buf);
      return Math.max(buf[0], buf[1], buf[2]);
    };
    let ok = true;
    try {
      const th = mats.bright.uniforms.threshold.value;
      mats.bright.uniforms.threshold.value = 0.0;
      mats.bright.uniforms.tSrc.value = white;
      ok = ok && lit(mats.bright) > 8;
      mats.bright.uniforms.threshold.value = th;

      mats.blur.uniforms.tSrc.value = white;
      mats.blur.uniforms.dir.value.set(0, 0);
      ok = ok && lit(mats.blur) > 8;

      const st = mats.comp.uniforms.strength.value;
      mats.comp.uniforms.strength.value = 0;
      mats.comp.uniforms.tScene.value = white;
      mats.comp.uniforms.tBloom.value = black;
      ok = ok && lit(mats.comp) > 8;
      mats.comp.uniforms.strength.value = st;
    } catch (e) {
      ok = false;
    }
    probe.dispose(); white.dispose(); black.dispose();
    renderer.setRenderTarget(null);
    mats.bright.uniforms.tSrc.value = null;
    mats.blur.uniforms.tSrc.value = null;
    mats.comp.uniforms.tScene.value = null;
    mats.comp.uniforms.tBloom.value = null;
    return ok;
  };

  if (!selfTest()) {
    console.warn('postfx: shader self-test failed on this driver — bloom disabled');
    for (const t of Object.values(targets)) t.dispose();
    for (const m of Object.values(mats)) m.dispose();
    quad.geometry.dispose();
    return null;
  }

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
