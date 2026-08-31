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
import { CARS, MAT, finishCar, setModelProvider } from './carFactory.js';

import url930 from './assets/models/car-930.glb';
import urlPack from './assets/models/car-generic-pack.glb';

/* ------------------------------------------------------------- the sources */
const FILES = {
  p930: url930,
  pack: urlPack,
};

/**
 * Per-car fitting recipe.
 *
 *   file      which glb
 *   pick      keep only nodes whose name matches (pack file holds ten bodies)
 *   strip     material names to drop entirely — badges, model lettering,
 *             licence plates (we add a German one), the modeller's ground
 *             shadow quad, and in the 930's case a hanging air freshener that
 *             is somebody else's trademark
 *   coat      a duplicated body shell some Sketchfab exports carry to fake a
 *             clearcoat layer; we have a real one, so it is 24k wasted
 *             triangles and it z-fights with the paint
 *   yaw       rotation about Y to get the nose pointing at +Z
 *   wheelMat  materials that make up the wheels
 *   paintMat  material to tint with the player's chosen colour
 */
const RECIPE = {
  turbo: {
    file: 'p930',
    strip: [/sticker/i, /^plate$/i, /wunderbaum/i, /^material_0$/],
    coat: [/^coat$/i],
    yaw: 0,
    wheelMat: [/rim/i, /tire/i],
    paintMat: [/^paint$/i],
    glassMat: [/glass/i],
  },
};

/* Bodies available in the generic pack, by the pack's own node names. Kept
   separate from RECIPE because they all share one file and one fitting path. */
const PACK = {
  taxi: 'Sedan Body',
  kombi: 'Wagon Body',
  hatch: 'Compact Body',
  van: 'minivan body',
};
for (const [id, node] of Object.entries(PACK)) {
  RECIPE[id] = {
    file: 'pack', pickNode: node, wheelNode: /^Wheel_/i,
    strip: [/PaletteMaterial/i, /^Cylinder001/i],
    coat: [], yaw: 0,
    wheelMat: [/wheel/i, /wheek/i],
    paintMat: [/^Body/i],
    glassMat: [/glass/i],
  };
}

/* ------------------------------------------------------------------ state */
const _templates = new Map();      // car id -> fitted THREE.Group template
let _enabled = true;

const matches = (name, list) => list.some(re => re.test(name || ''));

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

/** Bake a mesh's world transform into a float copy of its geometry. */
function bakeWorld(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = toFloat(mesh.geometry);
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

/**
 * Split one geometry into four by the sign of each triangle's centroid in x
 * and z. This is how four wheels exported as a single mesh become four wheels
 * again. Returns a map keyed 'LF' | 'RF' | 'LR' | 'RR'.
 */
function splitQuadrants(geo) {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const pos = nonIndexed.attributes.position.array;
  const parts = { LF: [], RF: [], LR: [], RR: [] };
  const triCount = pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
    const cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    parts[(cx < 0 ? 'L' : 'R') + (cz > 0 ? 'F' : 'R')].push(t);
  }
  const out = {};
  for (const k of Object.keys(parts)) {
    const tris = parts[k];
    if (!tris.length) continue;
    const arrays = {};
    for (const name of Object.keys(nonIndexed.attributes)) {
      const src = nonIndexed.attributes[name];
      const item = src.itemSize;
      const dst = new Float32Array(tris.length * 3 * item);
      for (let i = 0; i < tris.length; i++) {
        const base = tris[i] * 3 * item;
        for (let c = 0; c < 3 * item; c++) dst[i * 3 * item + c] = src.array[base + c];
      }
      arrays[name] = new THREE.BufferAttribute(dst, item);
    }
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(arrays)) g.setAttribute(name, arrays[name]);
    out[k] = g;
  }
  return out;
}

function bboxOf(geos) {
  const b = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    tmp.copy(g.boundingBox);
    b.union(tmp);
  }
  return b;
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

/* ------------------------------------------------------------------ fitting */
function fitTemplate(id, gltfScene, envMap) {
  const spec = CARS[id];
  if (!spec) return null;
  const rec = RECIPE[id];
  const dims = spec.dims;

  /* 1 — flatten. Collect baked geometries grouped by role, dropping anything
     the recipe strips out. */
  const roles = { body: [], wheel: [], strip: 0 };
  const bodyMats = new Map();          // material -> geometries
  const wheelMats = new Map();
  let picked = null;

  if (rec.pickNode) {
    gltfScene.traverse(o => {
      if (!picked && o.name && o.name.startsWith(rec.pickNode)) picked = o;
    });
  }

  gltfScene.traverse((o) => {
    if (!o.isMesh) return;
    const matName = o.material ? o.material.name : '';
    if (matches(matName, rec.strip)) { roles.strip++; return; }
    if (rec.coat.length && matches(matName, rec.coat)) { roles.strip++; return; }

    const isWheel = matches(matName, rec.wheelMat)
      || (rec.wheelNode && rec.wheelNode.test(o.name || ''));
    // in the shared pack file, keep only this car's body plus the wheels
    if (rec.pickNode && !isWheel) {
      let keep = false;
      for (let p = o; p; p = p.parent) if (p === picked) { keep = true; break; }
      if (!keep) return;
    }
    const g = bakeWorld(o);
    const target = isWheel ? wheelMats : bodyMats;
    if (!target.has(o.material)) target.set(o.material, []);
    target.get(o.material).push(g);
    (isWheel ? roles.wheel : roles.body).push(g);
  });

  if (!roles.body.length) return null;

  /* 2 — orientation and scale. Wheelbase, not overall length: a car whose
     wheels sit slightly inside the arches still reads fine, one whose wheels
     sit outside them reads as broken. */
  if (rec.yaw) {
    const rot = new THREE.Matrix4().makeRotationY(rec.yaw);
    for (const g of [...roles.body, ...roles.wheel]) g.applyMatrix4(rot);
  }

  const wheelBox = roles.wheel.length ? bboxOf(roles.wheel) : null;
  const bodyBox = bboxOf(roles.body);
  const full = bodyBox.clone();
  if (wheelBox) full.union(wheelBox);

  let scale;
  const rigWB = Math.abs(spec.axleF - spec.axleR);
  let quad = null;
  if (roles.wheel.length) {
    // measure the model's wheelbase from the split wheel clusters
    const merged = mergeGeometries(roles.wheel.map(g => g.clone()));
    quad = splitQuadrants(merged);
    const cz = {};
    for (const k of Object.keys(quad)) {
      quad[k].computeBoundingBox();
      cz[k] = quad[k].boundingBox.getCenter(new THREE.Vector3()).z;
    }
    const fz = (cz.LF + cz.RF) / 2, rz = (cz.LR + cz.RR) / 2;
    const modelWB = Math.abs(fz - rz);
    scale = modelWB > 0.2 ? rigWB / modelWB : dims.length / (full.max.z - full.min.z);
  } else {
    scale = dims.length / (full.max.z - full.min.z);
  }

  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  for (const g of [...roles.body, ...roles.wheel]) g.applyMatrix4(S);
  if (quad) for (const k of Object.keys(quad)) quad[k].applyMatrix4(S);

  /* 3 — recentre: wheelbase midpoint on the rig's, tyres on the road. */
  const after = bboxOf([...roles.body, ...roles.wheel]);
  let dz, dy = -after.min.y;
  if (quad) {
    const c = {};
    for (const k of Object.keys(quad)) {
      c[k] = quad[k].boundingBox.getCenter(new THREE.Vector3());
    }
    const fz = (c.LF.z + c.RF.z) / 2, rz = (c.LR.z + c.RR.z) / 2;
    dz = (spec.axleF + spec.axleR) / 2 - (fz + rz) / 2;
  } else {
    dz = -after.getCenter(new THREE.Vector3()).z;
  }
  const T = new THREE.Matrix4().makeTranslation(0, dy, dz);
  for (const g of [...roles.body, ...roles.wheel]) g.applyMatrix4(T);
  if (quad) for (const k of Object.keys(quad)) quad[k].applyMatrix4(T);

  /* 4 — build the template group. Body meshes are merged per material so the
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

  /* 5 — wheels: four groups at the rig's axles, each holding its own quadrant
     re-centred on its hub so it spins about its own axis. */
  const wheelTemplates = [];
  if (quad) {
    const byMat = new Map();
    for (const [mat, geos] of wheelMats) {
      byMat.set(mat, mergeGeometries(geos.map(g => g.clone())));
    }
    for (const k of ['LF', 'RF', 'LR', 'RR']) {
      const g = quad[k];
      if (!g) continue;
      g.computeBoundingBox();
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      const r = (g.boundingBox.max.y - g.boundingBox.min.y) / 2;
      const local = g.clone();
      local.applyMatrix4(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      wheelTemplates.push({ key: k, geo: local, centre: c, radius: r });
    }
    // one material for all wheel geometry: the split loses the per-material
    // grouping, so pick the wheel material with the most triangles
    let best = null, bestN = -1;
    for (const [mat, geos] of wheelMats) {
      let n = 0;
      for (const g of geos) n += (g.index ? g.index.count : g.attributes.position.count);
      if (n > bestN) { bestN = n; best = mat; }
    }
    for (const w of wheelTemplates) w.material = upgradeMaterial(best, 'rim', envMap);
  }

  let tris = 0;
  root.traverse(o => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  for (const w of wheelTemplates) {
    tris += (w.geo.index ? w.geo.index.count : w.geo.attributes.position.count) / 3;
  }

  return { root, wheelTemplates, paintMat, scale, tris: Math.round(tris), stripped: roles.strip };
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
  for (const w of tpl.wheelTemplates) {
    const front = w.key === 'LF' || w.key === 'RF';
    const wg = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(w.geo, w.material));
    wg.add(spin);
    wg.position.set(w.centre.x, w.centre.y, front ? spec.axleF : spec.axleR);
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
    headMat, tailMat, tier: 'model', opts,
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

export function hasModel(id) { return _templates.has(id); }
export function setModelsEnabled(v) { _enabled = !!v; }

/**
 * Fetch and fit every model. Never throws: a failure leaves that car on the
 * procedural body and the game starts anyway.
 *
 * @param envMap      environment map for the upgraded materials
 * @param onProgress  (fraction, label) for the loading screen
 */
export async function preloadCarModels(envMap, onProgress = () => {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const wanted = Object.keys(RECIPE);
  const needed = [...new Set(wanted.map(id => RECIPE[id].file))];
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
    } catch (e) {
      console.warn('carModels: could not load', key, e && e.message);
    }
    done++;
    onProgress(done / needed.length, 'Fahrzeuge');
  }

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
  return modelStats();
}
