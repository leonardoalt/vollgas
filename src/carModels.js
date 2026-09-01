/* ==========================================================================
   carModels.js — real glTF car bodies, fitted to the procedural rig.

   The procedural loft in carFactory.js can make a shape you recognise as a
   saloon or an estate, but it cannot make the surfacing of an actual car: a
   flat front lid with the fenders rising either side of it, a fast windscreen,
   haunches swelling over the rear wheels. Those are sculpted, and no station
   table produces them. So where a model exists under a licence we can actually
   ship, we use it.

   Everything here is additive. `setModelProvider` hands carFactory a hook it
   calls before building; if a model is missing, still downloading, or failed
   to fetch, `buildCar` falls straight through to the procedural body. The game
   is playable with no models at all.

   Fitting is the interesting part. A model has no idea about our rig, so:
     * every mesh's world transform is baked down, because Sketchfab exports
       arrive with arbitrary per-node rotations and quantisation scales;
     * the four wheels usually live in ONE mesh, so they are split apart by the
       sign of each triangle's centroid and re-parented into four groups that
       vehicles.js can spin and steer;
     * scale comes from the *wheelbase*, not the overall length, because wheels
       sitting in the wrong place is the one error you cannot stop seeing.

   Licences and attribution for every model live in CREDITS.md, and the credit
   line is also surfaced in the menu — CC-BY requires it.
   ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CARS, MAT, finishCar, buildWheel, setModelProvider, setTruckProvider, plateMesh,
} from './carFactory.js';
import {
  squareYaw, noseSign, archAxles, clipToFootprint, wheelCorners, bboxOf, halfWidthAt,
  envelopeOf, squaredYaw, wheelIslands, groupWheels, trianglesToGeometry,
} from './carFit.js';

import url930 from './assets/models/car-930.glb';
import urlSedan10 from './assets/models/car-sedan10.glb';
import urlHatch11 from './assets/models/car-hatch11.glb';
import urlLcv07 from './assets/models/car-lcv07.glb';
import urlWagonEu from './assets/models/car-wagon-eu.glb';
import urlSuv10 from './assets/models/car-suv10.glb';
import urlLorry from './assets/models/car-lorry.glb';
import urlSls from './assets/models/car-sls.glb';
import urlM5f90 from './assets/models/car-m5f90.glb';
import urlRs6c8 from './assets/models/car-rs6c8.glb';


/* ------------------------------------------------------------- the sources */
const FILES = {
  p930: url930,
  sedan10: urlSedan10,
  hatch11: urlHatch11,
  lcv07: urlLcv07,
  wagonEu: urlWagonEu,
  suv10: urlSuv10,
  lorry: urlLorry,
  sls: urlSls,
  m5f90: urlM5f90,
  rs6c8: urlRs6c8,
};

/**
 * Per-car fitting recipe.
 *
 *   file      which glb
 *   pick      exact node name, or a prefix, of the body to keep — the pack
 *             holds ten cars in one flat scene
 *   strip     material names to drop entirely — badges, model lettering,
 *             licence plates (we add a German one), the modeller's ground
 *             shadow quad, and in the 930's case a hanging air freshener that
 *             is somebody else's trademark
 *   coat      a duplicated body shell some Sketchfab exports carry to fake a
 *             clearcoat layer; we have a real one, so it is 24k wasted
 *             triangles and it z-fights with the paint
 *   nose      +1 or -1 to pin which way the body faces along Z, for a model
 *             `noseSign` cannot call. Normally left out: the shape decides.
 *   wheelMat  materials that make up the wheels
 *   paintMat  material to tint with the player's chosen colour
 */
const RECIPE = {
  turbo: {
    file: 'p930',
    strip: [/sticker/i, /^plate$/i, /wunderbaum/i, /^material_0$/],
    coat: [/^coat$/i],
    /* The model's own rims did not survive decimation — the simplifier eats
       thin spokes first and leaves a tyre with a hole in it. carFactory's
       revolved wheels are better than what was left, cost a tenth as much, and
       come with the coloured calipers visible through the spokes. The model's
       wheel geometry is still measured, because the wheelbase is what we scale
       the whole car by; it just is not drawn. */
    ownWheels: true,
    wheelMat: [/rim/i, /tire/i],
    paintMat: [/^paint$/i],
    glassMat: [/glass/i],
  },
};

/* --------------------------------------------------- the fictional marques

   Daniel Zhabotinsky's catalogue is the find that made the rest of the fleet
   possible: mid-poly, consistently built, and drawn as *invented* marques, so
   there is no badge to strip and no trade dress to worry about. His models
   share a material vocabulary — `*_body` is the paint, `UCB_GLASS*`/`glass` is
   the glazing, `*_INTERIOR`/`void` is the cabin, `GENERIC_BADGES` and
   `Numberplates` are exactly what they say — which is why the recipes below
   look so much like each other.

   Obtained from the Objaverse mirror; licence, author and Sketchfab URL are
   embedded in each file's `asset.extras` and recorded in CREDITS.md.        */
const ZHAB = {
  /* Draw carFactory's wheels, not the model's. Three reasons: the coupe's
     front wheels are modelled mid-steer, so bolting them on gives a car that
     corners in the showroom; the rig's revolved wheels carry the per-marque
     spoke count and caliper colour, which is most of what makes the fleet look
     like one fleet; and they cost one material instead of two. The model's
     wheels are still measured — they are what the wheelbase and the arch
     radius come from — they are simply not drawn. */
  ownWheels: true,
  paintMat: [/_body$/i, /^body$/i, /bodycolou?r/i],
  glassMat: [/^glass$/i, /_glass$/i, /GLASS_CLEAN/i],
  /* Badges and plates go on principle even where the marque is invented: the
     plates are the modeller's, and we fit a German one over the top. */
  strip: [/BADGE/i, /Numberplate/i],
  stripNode: [/numberplate/i, /licenc?eplate/i, /badge/i],
  coat: [],
};

/* The M5 and the RS6 are the other two player cars that are not fictional
   marques. Both came straight from Sketchfab with the owner's API token, both
   CC BY 4.0, and both are cleanly built: the interior is prefixed and the
   badges are their own meshes, so the strip is a pattern rather than surgery.

   Both needed gltfpack rather than dev/optimise-model.sh to decimate. They are
   exported with split vertices — hard normals on every triangle — and
   gltf-transform's `weld` only merges bitwise-identical ones, so meshoptimizer
   had no shared edges to collapse and the M5 would not go below 193 k
   triangles at any ratio. gltfpack welds with a tolerance first. Note the
   texture passes have to run BEFORE gltfpack: running gltf-transform `meshopt`
   over gltfpack's already-quantised output corrupts the positions and the car
   comes out flat. */
RECIPE.m5 = {
  ownWheels: true,
  file: 'm5f90',
  /* This model is assembled from several sources and its material names show
     it — `5___Default`, `h4343`, `0rewrewrwe` sit next to sensible ones. The
     wheels are the reliable part: rim, tyre, disc and caliper each have their
     own name, which is all the measuring pass needs. */
  wheelMat: [/^M_Rim/i, /^EXT_Tyre$/i, /^Brake_Disk/i, /^Brake_Caliper/i],
  wheelNode: [],
  paintMat: [/^Carpaint$/i],
  glassMat: [/^EXt_GLASS$/i],
  strip: [/numberplate/i, /^sticker/i],
  stripNode: [/numberplate/i],
  coat: [],
};

/* The AMG is the one player car that is not a fictional marque.

   Its previous body was Zhabotinsky's '07 Generic Coupe, which by the author's
   own description is a Ford Focus Coupe: a three-door shooting brake, the
   wrong silhouette for a car billed as a 63 S. This is a gullwing coupe
   instead — a closed roof, so the stripped cabin never shows.

   Prepared offline rather than at load: the interior is prefixed `INT_`
   throughout and came to 59% of the model, and the branding atlas had the
   laurel roundel and the AMG wordmark painted over. What is NOT removed is the
   star modelled into `Chrome.005`; it resisted both mesh removal and a spatial
   cut, and the owner chose to keep it rather than spend more on it. If that is
   ever revisited, `dev/scratch` has the isolation harness that proved it is
   geometry and not texture. */
RECIPE.amg = {
  ownWheels: true,
  file: 'sls',
  /* Rim, tyre, disc and caliper are separate materials here, so the measuring
     pass can find the wheels by material alone. */
  wheelMat: [/^Rim[._]/i, /^Tyre/i, /^Brake_/i],
  wheelNode: [],
  paintMat: [/^Carpaint/i],
  glassMat: [/^Glass_/i],
  /* The modeller's plate reads ASSETTO CORSA; the game fits a German one. */
  strip: [/^EXT_PLATE_plastic/i, /DAMAGE_GLASS/i],
  stripNode: [],
  coat: [],
};

/* The estate.

   The one body style the fictional-marque catalogue could not supply: its only
   trademark-free estates are 1980s American station wagons, whose wheelbase is
   so short relative to their length that scaling on the wheelbase overshoots a
   modern estate by 15%. Anserkon's is a modern European one, and reachable
   through the same mirror.

   It arrives with its materials called `.001`, `.002`, `material`, `Material`
   and its node names in Cyrillic that survives neither a terminal nor a regex
   typed by hand, so `dev/rename-glb.mjs` renames them once, offline, and the
   renamed file is what is committed. Encoding mojibake in a recipe would work
   until somebody opened the file. */
RECIPE.rs6 = {
  ownWheels: true,
  file: 'rs6c8',
  wheelMat: [/^rim/i, /^tire\./i, /^brakedisk/i],
  wheelNode: [],
  paintMat: [/^carpaint/i],
  /* `redglass` and `orangeglass` are the lamps, not the glazing. */
  glassMat: [/^windowglass/i],
  strip: [/LicPlate/i],
  stripNode: [],
  coat: [],
};
/* The generic estate and saloon.

   These used to be RECIPE.rs6 and RECIPE.m5, and the traffic and the unmarked
   patrols were spread from those. That stopped being safe the moment the two
   player cars moved onto bodies of their own: a Zivilstreifen that is visibly
   an RS6 defeats the entire point of an unmarked car, and the estate's
   envelope no longer matched the rig it was measured against. They are their
   own entries now, and nothing about a player car reaches them. */
const WAGON_EU = {
  ...ZHAB,
  file: 'wagonEu',
  wheelMat: [],
  wheelNode: [/^wheels_[abc]$/i],
  paintMat: [/^wagon_paint$/i],
  glassMat: [/^wagon_glass$/i],
  strip: [/^wagon_plate$/i],
  stripNode: [],
};
const SEDAN_10 = {
  ...ZHAB,
  file: 'sedan10',
  /* The rims share `solar_bottom` with the headlight housings and the plastic
     trim, so here they can only be found by node name. */
  wheelMat: [],
  wheelNode: [/^wheels?[_\d]/i],
  paintMat: [/^solar_body$/i],
  glassMat: [/^solar_glass$/i],
};

RECIPE.zivi_touring = { ...WAGON_EU };
RECIPE.zivi_avant = { ...WAGON_EU };
RECIPE.kombi = { ...WAGON_EU };

/* The Zivilstreifen.

   An unmarked patrol car is an ordinary saloon or estate — that is the whole
   point of one — so they share bodies with the traffic and the player's cars
   rather than having anything special of their own. The earlier note in
   HANDOFF.md said the pack did not fit them; that was read off the broken
   wheel measurement fixed in Phase A.

   `zivi_limo` reuses the sedan the `m5` is built from. That is not laziness:
   it is the same file already in the bundle, so the second template costs no
   bytes and shares its textures on the GPU, and an anonymous silver saloon
   that looks like ordinary traffic until the blues come on is exactly the
   brief. The player's car is a different colour and is in front of you. */
RECIPE.zivi_limo = { ...SEDAN_10 };
RECIPE.zivi_kompakt = {
  ...ZHAB,
  file: 'hatch11',
  /* One material for the whole body, wheels included, so node names are the
     only way to find them. */
  wheelMat: [],
  /* `\b` does not match before an underscore — `_` is a word character — so
     `^wheel_fl\b` never fired and the car came out scaled on length. */
  wheelNode: [/^wheel_(fl|fr|rl|rr)_/i, /^wheel_[0-9]/i],
  paintMat: [/MODERNHATCH_body/i],
  glassMat: [/^GLASS$/i],
};
RECIPE.messwagen = {
  ...ZHAB,
  file: 'lcv07',
  wheelMat: [/^TIRE$/i, /^material$/i],
  wheelNode: [/^wheel_0/i],
  paintMat: [/^BODY$/i],
  glassMat: [/^GLASS$/i],
};

/* Traffic rides on the same two files as the Zivilstreifen. They are already
   in the bundle, so a second template costs no bytes and shares its textures
   on the GPU — and an unmarked patrol car that is indistinguishable from the
   hatchback beside it is the entire point of an unmarked patrol car. */
RECIPE.hatch = { ...RECIPE.zivi_kompakt };
RECIPE.van = { ...RECIPE.messwagen };

/* Traffic.

   The generic passenger-car pack is gone. It was two thousand seven hundred
   triangles a car next to a thirty-nine thousand triangle 911, and its bodies
   arrive with their colour baked into the material, so tinting one blue got a
   dark green car — every saloon in the traffic would have been the same shade.
   Dropping it also takes 1 MB out of the bundle and leaves one fewer visual
   style on the road.

   What is left is four modern shapes that all tint properly: an estate, a
   hatchback, an SUV and a box van. `taxi` keeps its name and its rig — the
   name is never shown for traffic — but it is now the SUV, because a fleet of
   saloons, estates and hatchbacks with nothing tall in it does not look like a
   motorway. */
RECIPE.taxi = {
  ...ZHAB,
  file: 'suv10',
  /* `dust_bottom` is shared between the rims, the light housings and the
     underbody, so the wheels are found by node name. */
  wheelMat: [],
  wheelNode: [/^wheels?[_\d]/i],
  paintMat: [/^dust_body$/i],
  glassMat: [/^dust_glass$/i],
};

/* ------------------------------------------------------------------ state */
const _templates = new Map();      // car id -> fitted THREE.Group template
let _enabled = true;

const matches = (name, list) => !!list && list.some(re => re.test(name || ''));

/* ------------------------------------------------------------ geometry ops */

/**
 * Copy a geometry into plain, non-interleaved Float32 attributes.
 *
 * This is not tidying — it is required. gltf-transform's meshopt pass stores
 * positions as *normalised* 16-bit integers in an interleaved buffer, with the
 * dequantisation folded into the node's transform. `BufferGeometry.applyMatrix4`
 * writes its results straight back into the underlying typed array and knows
 * nothing about the `normalized` flag, so baking a world matrix into a
 * quantised attribute silently overflows every coordinate and the car arrives
 * as a cube of confetti. `getX/getY/getZ` do apply the dequantisation, so go
 * through them once and work in floats from there on.
 */
function toFloat(geo) {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    const n = a.count, k = a.itemSize;
    if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) {
      g.setAttribute(name, new THREE.BufferAttribute(a.array.slice(), k));
      continue;
    }
    const out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) {
      if (k > 0) out[i * k] = a.getX(i);
      if (k > 1) out[i * k + 1] = a.getY(i);
      if (k > 2) out[i * k + 2] = a.getZ(i);
      if (k > 3) out[i * k + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, k));
  }
  if (geo.index) {
    const src = geo.index;
    const out = new Uint32Array(src.count);
    for (let i = 0; i < src.count; i++) out[i] = src.getX(i);
    g.setIndex(new THREE.BufferAttribute(out, 1));
  }
  return g;
}

/* Baked geometry, memoised per mesh.

   Five cars come out of two files, and picking the right wheel set for each
   body means measuring every candidate wheel group. Without a cache that is
   dozens of full dequantise-and-transform passes over the same meshes, which
   was adding seconds to the loading screen. Callers mutate what they get back,
   so hand out clones. */
const _baked = new Map();

/** Bake a mesh's world transform into a float copy of its geometry. */
function bakeWorld(mesh) {
  let g = _baked.get(mesh);
  if (!g) {
    mesh.updateWorldMatrix(true, false);
    g = toFloat(mesh.geometry);
    g.applyMatrix4(mesh.matrixWorld);
    _baked.set(mesh, g);
  }
  return g.clone();
}

/* --------------------------------------------------------- material upgrade
   The model's own maps are worth keeping — they carry normal and occlusion
   detail we cannot generate. What they lack is our environment and a real
   clearcoat, so upgrade in place rather than replacing.                     */
function upgradeMaterial(mat, kind, envMap) {
  const m = mat.clone();
  m.envMap = envMap;
  if (kind === 'paint') {
    m.envMapIntensity = 1.15;
    if ('clearcoat' in m) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.06; }
    m.roughness = Math.min(m.roughness ?? 0.4, 0.42);
    m.metalness = Math.max(m.metalness ?? 0, 0.28);
  } else if (kind === 'glass') {
    m.envMapIntensity = 1.4;
    m.transparent = true;
    m.depthWrite = false;
    if (m.opacity >= 1) m.opacity = 0.5;
    m.roughness = 0.04;
    if ('transmission' in m) m.transmission = 0;   // far too costly per car
  } else if (kind === 'rim') {
    m.envMapIntensity = 1.4;
    m.roughness = Math.min(m.roughness ?? 0.3, 0.3);
  } else {
    m.envMapIntensity = 0.8;
  }
  m.needsUpdate = true;
  return m;
}


/* ------------------------------------------------------------------ fitting

   The order matters and every step depends on the one before it:

     square up  ->  decide which end is the nose  ->  find the axles  ->
     scale by wheelbase  ->  sit it on the road  ->  bolt on wheels

   Getting step two wrong is what put three of the four traffic cars on the
   road facing backwards: the old code squared each body up (badly) and then
   applied the same manual half-turn to all of them, on the assumption that a
   pack lays its models out facing one way. This one does not — it arranges
   ten cars in a ring — so "the same half-turn" meant a different answer for
   every car.                                                                */

/** Merge a list of position-bearing geometries into one, positions only. */
function mergePositions(geos) {
  if (geos.length === 1) return geos[0];
  const total = geos.reduce((t, g) => t + g.attributes.position.count, 0);
  const arr = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      arr[off++] = a.getX(i); arr[off++] = a.getY(i); arr[off++] = a.getZ(i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function fitTemplate(id, gltfScene, envMap) {
  const spec = CARS[id];
  if (!spec) return null;
  const rec = RECIPE[id];
  const dims = spec.dims;
  const notes = [];

  /* 1 — flatten. Bake every mesh's world transform down and sort it into a
     body part or a wheel part, dropping whatever the recipe strips. */
  const bodyMats = new Map();          // material -> geometries
  const wheelMats = new Map();
  const roles = { body: [], wheel: [], strip: 0 };

  let picked = null;
  if (rec.pick) {
    gltfScene.traverse(o => { if (!picked && o.name === rec.pick) picked = o; });
    if (!picked) gltfScene.traverse(o => { if (!picked && o.name && o.name.startsWith(rec.pick)) picked = o; });
    if (!picked) return null;
  }

  const wheelEntries = [];
  const bodyEntries = [];

  gltfScene.traverse((o) => {
    if (!o.isMesh) return;
    const matName = o.material ? o.material.name : '';
    const nodeName = o.name || '';
    if (matches(matName, rec.strip) || matches(nodeName, rec.stripNode)) { roles.strip++; return; }
    if (matches(matName, rec.coat)) { roles.strip++; return; }

    /* Wheels go by material where the material belongs only to them. Where it
       does not — Kiri's rims share `solar_bottom` with the headlight housings
       and the plastic trim — the recipe names the nodes instead. Node matching
       is opt-in per model and never on by default: the generic pack has a node
       called `Wheel_E_Body_0` which is a minibus, and trusting the name there
       put a bus in the wheel set and a 1.48 m wheelbase on a 4.4 m car. */
    if (matches(matName, rec.wheelMat) || matches(nodeName, rec.wheelNode)) {
      wheelEntries.push(o); return;
    }

    if (picked) {
      let keep = false;
      for (let p = o; p; p = p.parent) if (p === picked) { keep = true; break; }
      if (!keep) return;
    }
    bodyEntries.push(o);
  });

  if (!bodyEntries.length) return null;

  for (const o of bodyEntries) {
    const g = bakeWorld(o);
    if (!bodyMats.has(o.material)) bodyMats.set(o.material, []);
    bodyMats.get(o.material).push(g);
    roles.body.push(g);
  }

  /* Pre-centre on this body in x and z, so everything downstream is measured
     about the car we are actually fitting rather than about the pack's origin. */
  const bodyCentre = bboxOf(roles.body).getCenter(new THREE.Vector3());
  const pre = new THREE.Matrix4().makeTranslation(-bodyCentre.x, 0, -bodyCentre.z);
  for (const g of roles.body) g.applyMatrix4(pre);

  /* 2 — square the body up. Exact: the minimum-area rectangle around a point
     set always has a side flush with a hull edge, so enumerate hull edges. */
  /* Snapped, not raw: see squaredYaw. A residual two or three degrees puts
     the front and rear wheels out to opposite sides of the body. The
     tolerance is wider than the lorry's because the worst car measured
     3.1 degrees off, and no model in the fleet is deliberately askew. */
  const yaw = rec.autoYaw === false ? 0 : squaredYaw(roles.body, 6);
  const R = new THREE.Matrix4().makeRotationY(yaw);
  const wheelRaw = new Map();          // material -> baked, squared geometries
  for (const o of wheelEntries) {
    const g = bakeWorld(o);
    g.applyMatrix4(pre); g.applyMatrix4(R);
    if (!wheelRaw.has(o.material)) wheelRaw.set(o.material, []);
    wheelRaw.get(o.material).push(g);
  }
  for (const g of roles.body) g.applyMatrix4(R);

  /* 3 — which end is the nose. The recipe may pin it; otherwise the shape
     decides. A car pointing backwards has exactly the same footprint as one
     pointing forwards, so this cannot come out of step 2. */
  const bodyBoxPre = bboxOf(roles.body);
  const ns = noseSign(roles.body);
  const nose = rec.nose || ns.sign;
  notes.push(`nose ${nose > 0 ? '+Z' : '-Z'}${rec.nose ? ' (pinned)' : ''} conf=${ns.conf.toFixed(2)}`);
  if (nose < 0) {
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);
    for (const g of roles.body) g.applyMatrix4(flip);
    for (const list of wheelRaw.values()) for (const g of list) g.applyMatrix4(flip);
  }

  /* 4 — keep only the wheels that belong to this body. An asset pack merges
     by material, so the estate's "wheel set" is eight wheels across two cars;
     splitting that into quadrants gave a 1.48 m wheelbase on a 4.4 m car and
     every measurement taken from it was wrong. */
  const bodyBox = bboxOf(roles.body);
  const pad = Math.max(0.15, (bodyBox.max.z - bodyBox.min.z) * 0.04);
  for (const [mat, list] of wheelRaw) {
    const kept = [];
    for (const g of list) {
      const c = clipToFootprint(g, bodyBox, pad);
      if (c) kept.push(c);
    }
    if (!kept.length) continue;
    wheelMats.set(mat, kept);
    roles.wheel.push(...kept);
  }

  /* 5 — the axles. The model's own wheels are the truth where it has them;
     where it does not, the arches cut into the flanks still are. */
  let corners = null, modelWB = 0, wheelY0 = null, wheelR = 0;
  if (roles.wheel.length) {
    corners = wheelCorners(mergePositions(roles.wheel.map(g => g.clone())));
    if (corners) {
      const f = [corners.LF, corners.RF].filter(Boolean);
      const r = [corners.LR, corners.RR].filter(Boolean);
      if (f.length && r.length) {
        modelWB = f.reduce((t, c) => t + c.z, 0) / f.length - r.reduce((t, c) => t + c.z, 0) / r.length;
      }
      const all = Object.values(corners);
      wheelY0 = Math.min(...all.map(c => c.ylo));
      wheelR = all.reduce((t, c) => t + (c.yhi - c.ylo) / 2, 0) / all.length;
    }
  }
  let arches = null;
  if (modelWB < 0.2) {
    arches = archAxles(roles.body);
    if (arches) { modelWB = arches.wheelbase; notes.push('axles from arches'); }
  }

  const rigWB = Math.abs(spec.axleF - spec.axleR);
  const full = bodyBox.clone();
  if (roles.wheel.length) full.union(bboxOf(roles.wheel));
  const scale = modelWB > 0.2 ? rigWB / modelWB : dims.length / (full.max.z - full.min.z);
  if (modelWB <= 0.2) notes.push('scaled on length — no wheelbase found');

  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  for (const g of [...roles.body, ...roles.wheel]) g.applyMatrix4(S);
  if (corners) for (const c of Object.values(corners)) { c.x *= scale; c.y *= scale; c.z *= scale; c.ylo *= scale; c.yhi *= scale; c.xlo *= scale; c.xhi *= scale; }
  if (arches) { arches.front *= scale; arches.rear *= scale; }
  if (wheelY0 !== null) wheelY0 *= scale;
  wheelR *= scale;

  /* 6 — sit it on the road: wheelbase midpoint on the rig's axle midpoint,
     tyres on the tarmac. With no wheels of its own the body's own floor goes
     to the rig's declared floor height instead, which is what `dims.floor`
     has always meant. */
  const axleMid = (spec.axleF + spec.axleR) / 2;
  let dz, dy;
  if (corners && modelWB > 0.2 && !arches) {
    const f = [corners.LF, corners.RF].filter(Boolean);
    const r = [corners.LR, corners.RR].filter(Boolean);
    const fz = f.reduce((t, c) => t + c.z, 0) / f.length;
    const rz = r.reduce((t, c) => t + c.z, 0) / r.length;
    dz = axleMid - (fz + rz) / 2;
    dy = -wheelY0;
  } else if (arches) {
    dz = axleMid - (arches.front + arches.rear) / 2;
    dy = dims.floor - bboxOf(roles.body).min.y;
  } else {
    dz = -bboxOf(roles.body).getCenter(new THREE.Vector3()).z;
    dy = dims.floor - bboxOf(roles.body).min.y;
  }
  const T = new THREE.Matrix4().makeTranslation(0, dy, dz);
  for (const g of [...roles.body, ...roles.wheel]) g.applyMatrix4(T);
  if (corners) for (const c of Object.values(corners)) { c.y += dy; c.z += dz; c.ylo += dy; c.yhi += dy; }
  if (arches) { arches.front += dz; arches.rear += dz; }

  /* A body whose floor ends up under the tarmac is a fitting failure, not a
     styling choice — lift it rather than ship a car ploughing the hard
     shoulder. Half a centimetre of tolerance for meshopt's quantisation. */
  {
    const bmin = bboxOf(roles.body).min.y;
    if (bmin < -0.005) {
      const lift = new THREE.Matrix4().makeTranslation(0, -bmin + dims.floor * 0.25, 0);
      for (const g of [...roles.body, ...roles.wheel]) g.applyMatrix4(lift);
      notes.push(`lifted ${(-bmin).toFixed(3)}m out of the road`);
    }
  }

  /* 7 — build the template group. Body meshes are merged per material so the
     draw-call count stays close to the procedural path. */
  const root = new THREE.Group();
  root.name = id + ':model';
  const kindOf = (name) => (matches(name, rec.paintMat) ? 'paint'
    : matches(name, rec.glassMat) ? 'glass' : 'other');

  let paintMat = null;
  const glassMeshes = [];
  for (const [mat, geos] of bodyMats) {
    const kind = kindOf(mat.name);
    const up = upgradeMaterial(mat, kind, envMap);
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, up);
    if (kind === 'glass') { glassMeshes.push(mesh); continue; }
    if (kind === 'paint') paintMat = up;
    root.add(mesh);
  }
  for (const m of glassMeshes) root.add(m);   // transparent last

  /* 8 — wheels. `ownWheels` means draw carFactory's instead of the model's,
     which is what both current models want: the 930's rims did not survive
     decimation, and the pack's are shared between cars. Either way the
     measurements above put the rig's axles exactly where the arches are, so
     `assemble` can bolt wheels straight onto them. */
  const wheelTemplates = [];
  if (corners && !rec.ownWheels) {
    let best = null, bestN = -1;
    for (const [mat, geos] of wheelMats) {
      let n = 0;
      for (const g of geos) n += g.attributes.position.count;
      if (n > bestN) { bestN = n; best = mat; }
    }
    const wheelMaterial = best ? upgradeMaterial(best, 'rim', envMap) : MAT.tyre;
    const merged = mergePositions(roles.wheel.map(g => g.clone()));
    for (const key of ['LF', 'RF', 'LR', 'RR']) {
      const c = corners[key];
      if (!c) continue;
      const front = key[1] === 'F';
      const g = clipToFootprint(merged, new THREE.Box3(
        new THREE.Vector3(Math.min(c.xlo, c.x) - 0.02, -9, c.z - wheelR * 1.4),
        new THREE.Vector3(Math.max(c.xhi, c.x) + 0.02, 9, c.z + wheelR * 1.4)), 0.02);
      if (!g) continue;
      g.computeBoundingBox();
      const gc = g.boundingBox.getCenter(new THREE.Vector3());
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(-gc.x, -gc.y, -gc.z));
      g.computeVertexNormals();
      wheelTemplates.push({
        key, geo: g, front,
        centre: new THREE.Vector3(gc.x, gc.y, front ? spec.axleF : spec.axleR),
        radius: (g.boundingBox.max.y - g.boundingBox.min.y) / 2,
        material: wheelMaterial,
      });
    }
  }

  let tris = 0;
  root.traverse(o => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  for (const w of wheelTemplates) {
    tris += (w.geo.index ? w.geo.index.count : w.geo.attributes.position.count) / 3;
  }

  /* The fitted body's own extents. The rig's track and length were drawn for
     the procedural bodies, and a model is rarely the same shape, so everything
     that has to touch the body — plates, blue lights, the contact shadow, the
     wheels — is measured off the body rather than off the rig. Width is taken
     below the waist: the mirrors are 25 cm wider than the car and a wheel
     lined up with them hangs outside the arch. */
  /* The model's own wheel radius, per axle. carFactory's wheels are the ones
     we draw — they are consistent across the fleet, they carry the coloured
     calipers, and unlike some models' they are not frozen mid-steer — but they
     have to be the size of the hole they go in, and the rig's nominal radius
     was drawn for the procedural body. A 3 cm error here is an empty arch. */
  const radiusOf = (keys) => {
    if (!corners) return null;
    const c = keys.map(k => corners[k]).filter(Boolean);
    if (!c.length) return null;
    return c.reduce((t, w) => t + (w.yhi - w.ylo) / 2, 0) / c.length;
  };
  const modelRF = radiusOf(['LF', 'RF']);
  const modelRR = radiusOf(['LR', 'RR']);

  const env = envelopeOf(roles.body);
  const sill = env.halfWidth;
  const archHalf = (z) => {
    const w = halfWidthAt(roles.body, z, Math.max(0.25, wheelR * 0.9), env.waist);
    return w > sill * 0.5 ? w : sill;
  };
  const sane = (r, fallback) => (r && r > fallback * 0.55 && r < fallback * 1.7 ? r : fallback);
  const bounds = {
    halfWidth: sill,
    wideHalf: env.wideHalf,
    halfWidthF: archHalf(spec.axleF),
    halfWidthR: archHalf(spec.axleR),
    wheelRF: sane(modelRF, spec.wheelRF),
    wheelRR: sane(modelRR, spec.wheelRR),
    nose: env.nose,
    tail: env.tail,
    top: env.top,
    floor: env.floor,
  };

  const wheelTier = ['turbo', 'm5', 'rs6', 'amg'].includes(id) ? 'hi'
    : (id.startsWith('zivi') || id === 'messwagen') ? 'mid' : 'lo';
  return {
    root, wheelTemplates, paintMat, scale, wheelTier, bounds,
    tris: Math.round(tris), stripped: roles.strip,
    fit: {
      nose, noseConf: +ns.conf.toFixed(3), yaw: +(yaw * 180 / Math.PI).toFixed(1),
      wheelbase: +(modelWB * scale).toFixed(3), rigWheelbase: +rigWB.toFixed(3),
      wheelRF: +bounds.wheelRF.toFixed(3), wheelRR: +bounds.wheelRR.toFixed(3),
      rigWheelRF: spec.wheelRF, rigWheelRR: spec.wheelRR,
      length: +env.length.toFixed(3), width: +env.width.toFixed(3),
      height: +env.height.toFixed(3),
      notes,
    },
  };
}

/* --------------------------------------------------------------- assembly */
function assemble(id, tpl, opts) {
  const spec = CARS[id];
  const dims = spec.dims;
  const g = new THREE.Group();
  g.name = id;

  const body = tpl.root.clone(true);
  // clone(true) shares materials, which is what we want except for the paint
  let paintMat = tpl.paintMat;
  if (paintMat && opts.paint !== undefined) {
    paintMat = paintMat.clone();
    paintMat.color.setHex(opts.paint);
    body.traverse(o => { if (o.isMesh && o.material === tpl.paintMat) o.material = paintMat; });
  }
  g.add(body);

  const wheels = [];
  if (!tpl.wheelTemplates.length) {
    /* No usable wheels in the model.

       An asset pack ships its wheel designs laid out beside the bodies rather
       than fitted to them, and they do not reliably cluster into four corners —
       one pair straddles the axle with a wheel inside the arch and a wheel
       outside it, which looks far worse than no model at all. The bodies are
       what we wanted from a pack; carFactory's own revolved wheels are good
       now, so use those and mount them on the rig where they belong. */
    const bnd = tpl.bounds || {};
    /* Fill the arch the model actually has, not the one the rig imagined. The
       spec is cloned rather than mutated because CARS is shared and the
       procedural path still wants the original numbers. */
    const wspec = (bnd.wheelRF || bnd.wheelRR)
      ? { ...spec, wheelRF: bnd.wheelRF ?? spec.wheelRF, wheelRR: bnd.wheelRR ?? spec.wheelRR }
      : spec;
    for (const [front, zAxle, track] of [[true, spec.axleF, spec.trackF], [false, spec.axleR, spec.trackR]]) {
      for (const sx of [-1, 1]) {
        const w = buildWheel(wspec, front, tpl.wheelTier || 'lo', sx < 0);
        const ww = front ? spec.wheelWF : spec.wheelWR;
        /* The tyre's outer wall goes just inside the arch lip, measured at this
           axle rather than at the widest point of the car. Bolting wheels to
           the rig's track instead is what left them standing outside the
           bodywork: the pack's estate is 1.45 m across the arches where the rig
           says 1.58, and the mirrors are wider again than either. */
        const arch = (front ? bnd.halfWidthF : bnd.halfWidthR) || bnd.halfWidth || 0;
        const x = arch > 0.4
          ? Math.max(arch * 0.55, Math.min(track / 2, arch - ww * 0.5 - 0.02))
          : track / 2;
        w.position.set(sx * x, front ? wspec.wheelRF : wspec.wheelRR, zAxle);
        w.userData.front = front;
        g.add(w); wheels.push(w);
      }
    }
  }
  for (const w of tpl.wheelTemplates) {
    const front = w.front !== undefined ? w.front : (w.key === 'LF' || w.key === 'RF');
    const wg = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(w.geo, w.material));
    wg.add(spin);
    wg.position.copy(w.centre);
    wg.userData.spin = spin;
    wg.userData.radius = w.radius;
    wg.userData.front = front;
    g.add(wg);
    wheels.push(wg);
  }

  /* Lamp materials: the model has its own, and vehicles.js needs something
     whose emissiveIntensity it can drive for the Lichthupe. Reuse ours for the
     driven ones so the contract holds, without touching the model's lenses. */
  const headMat = MAT.headlight.clone();
  const tailMat = MAT.tail.clone();

  finishCar(g, {
    id, spec, dims, wheels, paintMat: paintMat || MAT.body(opts.paint ?? 0x8b9095, null),
    headMat, tailMat, tier: 'model', opts, bounds: tpl.bounds,
  });
  g.userData.model = true;
  return g;
}

/* ------------------------------------------------------------------ public */

/** Register with carFactory. Called once, at import. */
setModelProvider((id, opts) => {
  if (!_enabled) return null;
  const tpl = _templates.get(id);
  if (!tpl) return null;
  try {
    return assemble(id, tpl, opts || {});
  } catch (e) {
    console.warn('carModels: assembly failed for', id, e && e.message);
    _templates.delete(id);
    return null;
  }
});

export function modelStats() {
  const out = {};
  for (const [id, t] of _templates) out[id] = { tris: t.tris, scale: +t.scale.toFixed(4) };
  return out;
}

/** Everything the fitter decided, for `dev/fleet-check.mjs` and the benches. */
export function modelFit() {
  const out = {};
  for (const [id, t] of _templates) out[id] = { ...t.fit, tris: t.tris, scale: +t.scale.toFixed(4), bounds: t.bounds };
  return out;
}

export function hasModel(id) { return _templates.has(id); }

/** Raw loaded scenes, kept for the dev benches to introspect. */
export const _scenes = {};
export function setModelsEnabled(v) { _enabled = !!v; }

/**
 * Fetch and fit every model. Never throws: a failure leaves that car on the
 * procedural body and the game starts anyway.
 *
 * @param envMap      environment map for the upgraded materials
 * @param onProgress  (fraction, label) for the loading screen
 */
export async function preloadCarModels(envMap, onProgress = () => {}) {
  /* Escape hatch for the harnesses: ?nomodels=1 runs the whole game on the
     procedural bodies, which is how the model cost is measured against the
     baseline and how the fallback path stays tested. */
  if (typeof location !== 'undefined' && /[?&]nomodels=1/.test(location.search)) {
    _enabled = false;
    return {};
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const wanted = Object.keys(RECIPE);
  const needed = [...new Set([...wanted.map(id => RECIPE[id].file), LORRY.file])];
  const scenes = {};

  let done = 0;
  for (const key of needed) {
    try {
      const gltf = await loader.loadAsync(FILES[key], (ev) => {
        if (ev && ev.total) {
          const f = (done + ev.loaded / ev.total) / needed.length;
          onProgress(f, 'Fahrzeuge');
        }
      });
      scenes[key] = gltf.scene;
      _scenes[key] = gltf.scene;
    } catch (e) {
      console.warn('carModels: could not load', key, e && e.message);
    }
    done++;
    onProgress(done / needed.length, 'Fahrzeuge');
  }

  _baked.clear();
  for (const id of wanted) {
    const scene = scenes[RECIPE[id].file];
    if (!scene) continue;
    try {
      const tpl = fitTemplate(id, scene, envMap);
      if (tpl) _templates.set(id, tpl);
    } catch (e) {
      console.warn('carModels: could not fit', id, e && e.message);
    }
  }
  if (scenes[LORRY.file]) {
    try {
      _truckTpl = fitTruck(scenes[LORRY.file], envMap);
    } catch (e) {
      console.warn('carModels: could not fit the lorry —', e && e.message);
      _truckTpl = null;
    }
  }
  _baked.clear();                 // release the intermediate float copies
  return modelStats();
}


/* ==========================================================================
   The lorry.

   Everything above fits a car: a member of `CARS`, with a spec, a wheelbase,
   four corners and a player rig behind it. A lorry has none of those. It is
   built by `buildTruck`, which owns its own dimensions and its own physics,
   and it has eight wheel units on four axles, two of them twinned.

   So it gets its own fit rather than a special case bolted onto `fitTemplate`.
   The steps are the same and in the same order — square up, decide the nose,
   find the wheels, scale, sit it down — but each one differs in a way that
   would have made `fitTemplate` unreadable:

     square up  a 16 m body squared to the nearest degree is not square enough;
                one degree staggers the steer axle 15 cm against the tail. This
                model is exported axis-aligned, so `squaredYaw` snaps.
     wheels     found by connected component and grouped by axle, because there
                is no such thing as "the front left wheel" here. See the long
                note in carFit.js for why distance clustering cannot work.
     scale      a car is scaled on its wheelbase, since a wheel in the wrong
                place is the error you cannot stop seeing. A lorry's wheels are
                tucked under a slab-sided box where nobody can read the
                wheelbase, and what does show is whether it is as long as the
                lane markings and as wide as the lane. So it is scaled on
                length and width together — the geometric mean, which splits
                the difference between two errors instead of putting all of it
                into one.
   ========================================================================== */

const LORRY = {
  file: 'lorry',
  /* What buildTruck has always declared, and what the physics, the collision
     box and the traffic spacing are built from. Deliberately not changed: the
     model is fitted to the rig, never the rig to the model. */
  dims: { length: 15.8, width: 2.55, height: 4.0 },
  halfLen: 7.9, halfWid: 1.30,
  perf: { mass: 38000, power: 375, cd: 5.8, vmax: 90, grip: 0.7, gears: 12, redline: 2200 },
  /* ROY's export names every tyre and every rim with its own `.NNN` suffix,
     which `gltf-transform dedup` then merges back down to `tyres` and
     `wheels.001`. Match the stem and not the suffix, so the recipe reads the
     raw download and the shipped file alike. */
  wheelMat: [/^tyres/i, /^wheels/i, /^wheel_hub/i, /^rim/i],
  cabMat: [/^head_paint$/i],
  boxMat: [/^bodycolour$/i],
  glassMat: [/glass$/i],
  lampMat: [/^signal_light$/i, /^light_emit$/i],
  tailMat: [/^signal_light\.001$/i],
  strip: [],
};

/** Bake a mesh down, remembering the material it came off. */
function bakedPart(o) {
  return { mat: o.material, node: o.name || '', geo: bakeWorld(o) };
}

function fitTruck(gltfScene, envMap) {
  const rec = LORRY, dims = rec.dims;
  const notes = [];

  /* 1 — flatten and sort. */
  const bodyParts = [], wheelParts = [];
  gltfScene.traverse((o) => {
    if (!o.isMesh) return;
    const mn = o.material ? o.material.name : '';
    if (matches(mn, rec.strip)) return;
    (matches(mn, rec.wheelMat) ? wheelParts : bodyParts).push(bakedPart(o));
  });
  if (!bodyParts.length || !wheelParts.length) return null;
  const allGeos = () => [...bodyParts, ...wheelParts].map(p => p.geo);
  const bodyGeos = () => bodyParts.map(p => p.geo);

  /* Pre-centre, so everything downstream is measured about the lorry rather
     than about wherever the exporter left the origin. */
  const c0 = bboxOf(bodyGeos()).getCenter(new THREE.Vector3());
  for (const g of allGeos()) g.applyMatrix4(new THREE.Matrix4().makeTranslation(-c0.x, 0, -c0.z));

  /* 2 — square up, measured on the body: wheels are round and say nothing. */
  const yaw = squaredYaw(bodyGeos());
  for (const g of allGeos()) g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));

  /* 3 — which end is the nose. */
  const ns = noseSign(bodyGeos());
  notes.push(`nose ${ns.sign > 0 ? '+Z' : '-Z'} conf=${ns.conf.toFixed(2)}`);
  if (ns.sign < 0) {
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);
    for (const g of allGeos()) g.applyMatrix4(flip);
  }

  /* 4 — the wheels, by connected component. Islands that do not form a round,
     upright unit are not wheels: on this model that is the spare lashed flat
     under the bed and its hub, which share the tyre and rim materials. They go
     back to the body and are drawn with it. */
  const islands = [];
  for (const p of wheelParts) {
    for (const isl of wheelIslands(p.geo)) { isl.src = p; islands.push(isl); }
  }
  const units = groupWheels(islands);
  if (units.length < 6) { console.warn('carModels: lorry has only', units.length, 'wheels'); return null; }
  notes.push(`${islands.length} islands -> ${units.length} wheels`);

  const inUnit = new Set();
  for (const u of units) for (const isl of u.islands) inUnit.add(isl);
  const strays = new Map();
  for (const isl of islands) {
    if (inUnit.has(isl)) continue;
    if (!strays.has(isl.src)) strays.set(isl.src, []);
    strays.get(isl.src).push(...isl.tris);
  }
  for (const [p, tris] of strays) {
    bodyParts.push({ mat: p.mat, node: p.node, geo: trianglesToGeometry(p.geo, tris) });
  }
  if (strays.size) notes.push(`${strays.size} non-wheel island group(s) kept with the body`);

  /* 5 — scale. Length and width together; see the note at the top. */
  const env0 = envelopeOf(bodyGeos());
  const scale = Math.sqrt((dims.length / env0.length) * (dims.width / env0.width));
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  for (const g of allGeos()) g.applyMatrix4(S);
  for (const u of units) {
    u.box.applyMatrix4(S); u.centre.multiplyScalar(scale);
    u.radius *= scale; u.width *= scale;
  }

  /* 6 — tyres on the tarmac, and the rig centred on the origin, because that
     is where buildTruck's collision box is. */
  const wheelFloor = Math.min(...units.map(u => u.box.min.y));
  const envA = envelopeOf(bodyGeos());
  const T = new THREE.Matrix4().makeTranslation(0, -wheelFloor, -(envA.nose + envA.tail) / 2);
  for (const g of allGeos()) g.applyMatrix4(T);
  for (const u of units) { u.box.applyMatrix4(T); u.centre.applyMatrix4(T); }

  /* 7 — tuck any wheel standing proud of the bodywork beside it back under the
     flank, exactly as the car path does at the arch. ROY's steer axle is 8 cm
     wider than his own cab, which on a cab-over is 8 cm too many; every other
     axle on the lorry is already well inside. */
  const env = envelopeOf(bodyGeos());
  for (const u of units) {
    const outer = Math.max(Math.abs(u.box.min.x), Math.abs(u.box.max.x));
    const flank = halfWidthAt(bodyGeos(), u.centre.z,
      Math.max(0.22, (u.box.max.y - u.box.min.y) * 0.45), env.waist);
    const over = outer - (flank - 0.015);
    if (over <= 0) continue;
    u.shiftX = -Math.sign(u.centre.x) * over;
    u.box.applyMatrix4(new THREE.Matrix4().makeTranslation(u.shiftX, 0, 0));
    u.centre.x += u.shiftX;
    notes.push(`axle z=${u.centre.z.toFixed(2)} tucked in ${(over * 100).toFixed(1)} cm`);
  }

  /* 8 — the template. Body merged per material; each wheel unit its own group
     so vehicles.js can spin it, split by material inside so the tyre stays
     rubber and the rim stays metal. */
  const root = new THREE.Group();
  root.name = 'truck:model';
  const kindOf = (n) => (matches(n, rec.cabMat) ? 'cab' : matches(n, rec.boxMat) ? 'box'
    : matches(n, rec.glassMat) ? 'glass'
      : matches(n, rec.lampMat) ? 'lamp' : matches(n, rec.tailMat) ? 'tail' : 'other');

  const byMat = new Map();
  for (const p of bodyParts) {
    if (!byMat.has(p.mat)) byMat.set(p.mat, []);
    byMat.get(p.mat).push(p.geo);
  }
  let cabMat = null, boxMat = null, headMat = null, tailMat = null;
  const glassMeshes = [];
  for (const [mat, geos] of byMat) {
    const kind = kindOf(mat.name);
    const up = upgradeMaterial(mat,
      kind === 'cab' || kind === 'box' ? 'paint' : kind === 'glass' ? 'glass' : 'other', envMap);
    /* vehicles.js drives these two by emissiveIntensity, so they have to have
       an emissive colour to drive. The model's own lens geometry keeps its
       shape; only the emission is ours.

       The base colour matters as much as the emissive. ROY's rear cluster is
       white with a red emissive, which in daylight reads as a pink panel
       rather than a lamp — the white diffuse swamps the glow. A tail light is
       a dark red lens that lights up, so the lens goes dark and the emissive
       does the talking, exactly as `MAT.tail` does for the cars. */
    if (kind === 'lamp') { up.emissive = new THREE.Color(0xada18c); up.emissiveIntensity = 0.4; }
    if (kind === 'tail') {
      up.color.setHex(0x59060a);
      up.emissive = new THREE.Color(0xff2410);
      up.emissiveIntensity = 0.75;
    }
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, up);
    if (kind === 'cab') cabMat = up;
    if (kind === 'box') boxMat = up;
    if (kind === 'lamp') headMat = up;
    if (kind === 'tail') tailMat = up;
    if (kind === 'glass') { glassMeshes.push(mesh); continue; }
    root.add(mesh);
  }
  for (const m of glassMeshes) root.add(m);       // transparent last

  const frontZ = Math.max(...units.map(u => u.centre.z));
  const wheelTemplates = [];
  for (const u of units) {
    const perPart = new Map();
    for (const isl of u.islands) {
      if (!perPart.has(isl.src)) perPart.set(isl.src, []);
      perPart.get(isl.src).push(...isl.tris);
    }
    const meshes = [];
    for (const [p, tris] of perPart) {
      const geo = trianglesToGeometry(p.geo, tris);
      /* Spin is a rotation about the group's own X axis, so the axle line has
         to pass through its origin. The x offset is put back on the group, not
         baked in: a twinned pair is off-centre by design. */
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        -(u.centre.x - (u.shiftX || 0)), -u.centre.y, -u.centre.z));
      meshes.push({
        geo,
        material: upgradeMaterial(p.mat, /tyre/i.test(p.mat.name || '') ? 'other' : 'rim', envMap),
      });
    }
    wheelTemplates.push({
      centre: u.centre.clone(), radius: u.radius,
      front: u.centre.z > frontZ - 0.3, meshes,
    });
  }

  let tris = 0;
  root.traverse(o => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  for (const w of wheelTemplates) for (const m of w.meshes) tris += m.geo.index.count / 3;

  return {
    root, wheelTemplates, cabMat, boxMat, headMat, tailMat, scale,
    tris: Math.round(tris),
    bounds: {
      nose: env.nose, tail: env.tail, top: env.top, floor: env.floor,
      halfWidth: env.halfWidth, wideHalf: env.wideHalf,
    },
    fit: {
      nose: ns.sign, noseConf: +ns.conf.toFixed(3), yaw: +(yaw * 180 / Math.PI).toFixed(1),
      wheels: units.length, scale: +scale.toFixed(4),
      length: +env.length.toFixed(3), width: +env.width.toFixed(3), height: +env.height.toFixed(3),
      notes,
    },
  };
}

function assembleTruck(tpl, opts) {
  const rec = LORRY, dims = rec.dims, b = tpl.bounds;
  const outer = new THREE.Group();
  outer.name = 'truck';

  const body = tpl.root.clone(true);              // shares materials, by design
  /* Traffic randomises a cab colour and a box colour, and the model happens to
     split exactly that way. Cloning the two paints per lorry is what makes two
     lorries on the same road two different lorries. */
  const tint = (src, hex) => {
    if (!src || hex === undefined || hex === null) return src;
    const m = src.clone();
    m.color.setHex(hex);
    body.traverse(o => { if (o.isMesh && o.material === src) o.material = m; });
    return m;
  };
  const cabMat = tint(tpl.cabMat, opts.cab ?? 0x2f5fa8);
  const boxMat = tint(tpl.boxMat, opts.box ?? 0xe8e9e6);
  /* Brake lights are per lorry too, or the whole convoy brakes together. */
  let tailMat = tpl.tailMat;
  if (tailMat) {
    const src = tailMat;
    tailMat = src.clone();
    body.traverse(o => { if (o.isMesh && o.material === src) o.material = tailMat; });
  }
  outer.add(body);

  const wheels = [];
  for (const w of tpl.wheelTemplates) {
    const wg = new THREE.Group();
    const spin = new THREE.Group();
    for (const m of w.meshes) spin.add(new THREE.Mesh(m.geo, m.material));
    wg.add(spin);
    wg.position.copy(w.centre);
    wg.name = 'wheel';
    wg.userData.spin = spin;
    wg.userData.radius = w.radius;
    wg.userData.front = w.front;
    outer.add(wg); wheels.push(wg);
  }

  /* A German lorry carries its plate low on the bumper, under the grille. */
  const plate = plateMesh(opts.plate || 'RW TR 4711', 0.52, 0, 0, dims.height * 0.15, b.nose + 0.02);
  plate.name = 'plates';
  outer.add(plate);

  const sh = new THREE.Mesh(
    new THREE.PlaneGeometry(b.halfWidth * 2.2, (b.nose - b.tail) * 1.06), MAT.shadow);
  sh.rotation.x = -Math.PI / 2;
  sh.position.set(0, 0.015, (b.nose + b.tail) / 2);
  sh.renderOrder = -1;
  sh.name = 'shadow';
  outer.add(sh);

  outer.userData = {
    id: 'truck', wheels, blues: [], led: null,
    dims, halfLen: rec.halfLen, halfWid: rec.halfWid, perf: rec.perf,
    paintMat: cabMat || boxMat, headMat: tpl.headMat, tailMat,
    model: true,
  };
  return outer;
}

let _truckTpl = null;

setTruckProvider((opts) => {
  if (!_enabled || !_truckTpl) return null;
  try {
    return assembleTruck(_truckTpl, opts || {});
  } catch (e) {
    console.warn('carModels: lorry assembly failed —', e && e.message);
    _truckTpl = null;
    return null;
  }
});

/** What the lorry fit decided, for `dev/fleet-check.mjs` and the benches. */
export function truckFit() {
  return _truckTpl ? { ..._truckTpl.fit, tris: _truckTpl.tris } : null;
}
export function hasTruckModel() { return !!_truckTpl; }
