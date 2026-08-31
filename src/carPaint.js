/* ==========================================================================
   carPaint.js — the car material set.

   Car paint is not one layer. It is a metallic basecoat with flake in it and a
   thick clear lacquer on top, and the reason CG cars look like plastic is that
   a single MeshStandardMaterial can only be one of those. MeshPhysicalMaterial
   gives us a second specular lobe: the basecoat stays fairly rough and holds
   the colour, the clearcoat is almost mirror-smooth and holds the reflection
   of the sky. That split is what produces the bright, tight horizon streak
   down a flank instead of a broad grey smear.

   The other half of the trick is `carEnv.js`: a clearcoat reflecting a flat
   gradient still looks like plastic, because there is nothing in the
   reflection.
   ========================================================================== */
import * as THREE from 'three';
import { flakeNormal, tyreNormal, contactShadow } from './carTextures.js';
import { glowTex } from './textures.js';

export function makeCarMaterials(envMap) {
  const MAT = {};

  /* Orange peel in the lacquer. Almost invisible by design — its whole job is
     to stop panels being perfect mathematical surfaces. */
  const peel = flakeNormal();
  peel.repeat.set(9, 15);

  const paintBase = (hex, metal, rough) => ({
    color: hex,
    metalness: metal,
    roughness: rough,
    envMap, envMapIntensity: 1.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.055,
    clearcoatNormalMap: peel,
    clearcoatNormalScale: new THREE.Vector2(0.085, 0.085),
  });

  /** Plain body colour, no per-body detail maps (trucks, spoilers, mirrors). */
  MAT.make = (hex, metal = 0.55, rough = 0.36) =>
    new THREE.MeshPhysicalMaterial(paintBase(hex, metal, rough));

  /**
   * Body colour with this body style's panel-gap / sill / roughness maps.
   * `roughness` is deliberately high here: the detail map's green channel
   * scales it, and the map is ~0.42 over panels and ~1.0 in the shut lines.
   */
  MAT.body = (hex, detail) => {
    const m = new THREE.MeshPhysicalMaterial(paintBase(hex, 0.55, 0.80));
    if (detail) {
      m.map = detail.albedo;
      m.roughnessMap = detail.rough;
      m.aoMap = detail.rough;
      m.aoMapIntensity = 0.55;
    } else {
      m.roughness = 0.34;
    }
    return m;
  };

  /* Glass. Transmission would be lovely and costs a scene re-render per
     material, which we cannot afford with thirty cars on screen — so this is a
     tinted, very smooth, strongly reflective dielectric instead. depthWrite is
     off so the near and far screens blend through each other the way glass
     actually does, rather than whichever one happened to be drawn first
     punching a hole in the other. */
  MAT.glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1017, metalness: 0.0, roughness: 0.028,
    envMap, envMapIntensity: 1.55,
    clearcoat: 1.0, clearcoatRoughness: 0.02,
    ior: 1.52, reflectivity: 0.62,
    transparent: true, opacity: 0.62, depthWrite: false,
  });

  MAT.dark = new THREE.MeshPhysicalMaterial({
    color: 0x15181c, metalness: 0.25, roughness: 0.48,
    envMap, envMapIntensity: 0.8, clearcoat: 0.5, clearcoatRoughness: 0.35,
  });
  MAT.grille = new THREE.MeshStandardMaterial({
    color: 0x080a0c, metalness: 0.75, roughness: 0.38, envMap, envMapIntensity: 0.45,
  });
  MAT.chrome = new THREE.MeshStandardMaterial({
    color: 0xe2e6ea, metalness: 1.0, roughness: 0.075, envMap, envMapIntensity: 1.7,
  });
  MAT.trim = new THREE.MeshStandardMaterial({   // satin aluminium / gloss black trim
    color: 0x2b3037, metalness: 0.85, roughness: 0.22, envMap, envMapIntensity: 1.2,
  });

  const tyreN = tyreNormal();
  tyreN.repeat.set(5, 1);
  MAT.tyre = new THREE.MeshStandardMaterial({
    color: 0x0d0f11, metalness: 0.0, roughness: 0.86,
    normalMap: tyreN, normalScale: new THREE.Vector2(0.9, 0.9),
    envMap, envMapIntensity: 0.35,
  });
  MAT.rim = new THREE.MeshPhysicalMaterial({
    color: 0xb4bac0, metalness: 0.97, roughness: 0.17,
    envMap, envMapIntensity: 1.55, clearcoat: 0.7, clearcoatRoughness: 0.12,
  });
  MAT.rimDark = new THREE.MeshPhysicalMaterial({
    color: 0x25292e, metalness: 0.92, roughness: 0.26,
    envMap, envMapIntensity: 1.1, clearcoat: 0.8, clearcoatRoughness: 0.10,
  });
  MAT.rimLip = new THREE.MeshStandardMaterial({
    color: 0xd6dade, metalness: 1.0, roughness: 0.10, envMap, envMapIntensity: 1.8,
  });
  MAT.disc = new THREE.MeshStandardMaterial({
    color: 0x71777c, metalness: 0.9, roughness: 0.38, envMap, envMapIntensity: 0.9,
  });
  MAT.caliperRed = new THREE.MeshPhysicalMaterial({
    color: 0xc4241a, metalness: 0.2, roughness: 0.30, envMap, envMapIntensity: 0.7,
    clearcoat: 0.8, clearcoatRoughness: 0.15,
  });
  MAT.caliperYel = new THREE.MeshPhysicalMaterial({
    color: 0xe6bc18, metalness: 0.2, roughness: 0.30, envMap, envMapIntensity: 0.7,
    clearcoat: 0.8, clearcoatRoughness: 0.15,
  });

  /* Lamps. `headlight` is the driven one — vehicles.js pushes its
     emissiveIntensity to 16 for a Lichthupe — so it stays a single material
     with a clear lens look. `drl` is the daytime running light, which is
     always lit and is most of what makes a car read as a car at 400 m. */
  MAT.headlight = new THREE.MeshPhysicalMaterial({
    color: 0x8fa2b6, emissive: 0xfff1d2, emissiveIntensity: 0.4,
    metalness: 0.15, roughness: 0.07,
    envMap, envMapIntensity: 1.6, clearcoat: 1.0, clearcoatRoughness: 0.03,
  });
  MAT.drl = new THREE.MeshStandardMaterial({
    color: 0x20262e, emissive: 0xe9f4ff, emissiveIntensity: 2.4,
    metalness: 0.3, roughness: 0.18, envMap, envMapIntensity: 0.9,
  });
  MAT.tail = new THREE.MeshPhysicalMaterial({
    color: 0x59060a, emissive: 0xff2410, emissiveIntensity: 0.75,
    metalness: 0.0, roughness: 0.10,
    envMap, envMapIntensity: 1.1, clearcoat: 1.0, clearcoatRoughness: 0.04,
  });
  MAT.blue = new THREE.MeshStandardMaterial({
    color: 0x081538, emissive: 0x1636ff, emissiveIntensity: 0, roughness: 0.22, metalness: 0.35,
  });

  MAT.shadow = new THREE.MeshBasicMaterial({
    map: contactShadow(), transparent: true, depthWrite: false, opacity: 0.8,
  });
  MAT.interior = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.88, metalness: 0.0 });
  MAT.seat = new THREE.MeshStandardMaterial({ color: 0x191d23, roughness: 0.80, metalness: 0.02 });
  MAT.liner = new THREE.MeshStandardMaterial({
    color: 0x0c0e10, roughness: 0.96, metalness: 0, side: THREE.DoubleSide,
  });
  MAT.glow = new THREE.SpriteMaterial({
    map: glowTex(), blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, opacity: 0,
  });
  return MAT;
}

/**
 * Re-point a built car at a different environment map.
 *
 * The menu turntable runs on a *second* WebGL context, and a PMREM result is a
 * render target — it exists only on the GPU of the renderer that made it. Used
 * in the other context it comes back black, which is why the showroom used to
 * be lit entirely by four directional lights. Cloning the materials per
 * context fixes it and lets the menu have a proper studio environment.
 */
export function retargetEnv(root, envMap, cache = new Map()) {
  const seen = cache;
  root.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    const m = o.material;
    if (!m || m.isSpriteMaterial) return;
    if (!('envMap' in m)) return;
    let c = seen.get(m);
    if (!c) { c = m.clone(); c.envMap = envMap; c.needsUpdate = true; seen.set(m, c); }
    o.material = c;
  });
  return seen;
}
