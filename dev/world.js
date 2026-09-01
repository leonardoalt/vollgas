import * as THREE from 'three';
import { buildWorld } from '../src/world.js';
import { initMaterials, buildCar, buildTruck } from '../src/carFactory.js';
import { toWorld, sample, LANES, GEO, sectionAt } from '../src/track.js';

const q = new URLSearchParams(location.search);
const km = parseFloat(q.get('km') || '12');
const view = q.get('view') || 'drive';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = new URLSearchParams(location.search).get('noshadow') !== '1';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const t0 = performance.now();
const world = buildWorld(scene, renderer, s => console.log('build:', s));
initMaterials(world.env);
console.log('world built in', (performance.now() - t0).toFixed(0), 'ms');

// a few cars on the road for scale
const s0 = km * 1000;
const cars = [];
function put(obj, s, u) {
  const w = toWorld(s, u);
  const c = sample(s);
  obj.position.set(w.x, w.y, w.z);
  obj.rotation.y = c.head;
  obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(obj); cars.push(obj);
}
put(buildCar('turbo'), s0, LANES[0]);
put(buildCar('m5', { paint: 0x1c56b4 }), s0 + 34, LANES[0]);
put(buildCar('kombi', { paint: 0x8b9095 }), s0 + 70, LANES[1]);
put(buildTruck(), s0 + 150, LANES[1]);
put(buildCar('zivi_limo', { police: true, paint: 0x8f9498 }), s0 - 40, LANES[1]);
const opp = buildCar('taxi', { paint: 0xe8e0c8 });
put(opp, s0 + 260, -LANES[1]); opp.rotation.y += Math.PI;

const cam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.3, 6000);
function place() {
  const c = sample(s0);
  const w = toWorld(s0, LANES[0]);
  if (view === 'drive') {
    const back = toWorld(s0 - 9.5, LANES[0] + 0.2);
    cam.position.set(back.x, back.y + 2.5, back.z);
    const look = toWorld(s0 + 60, LANES[0]);
    cam.lookAt(look.x, look.y + 1.4, look.z);
  } else if (view === 'cockpit') {
    const p = toWorld(s0 + 0.4, LANES[0] - 0.35);
    cam.position.set(p.x, p.y + 1.18, p.z);
    const look = toWorld(s0 + 120, LANES[0]);
    cam.lookAt(look.x, look.y + 1.2, look.z);
  } else if (view === 'air') {
    const p = toWorld(s0 - 180, 60);
    cam.position.set(p.x, p.y + 95, p.z);
    cam.lookAt(w.x, w.y, w.z);
  } else if (view === 'sign') {
    const p = toWorld(s0 - 26, GEO.pavedOut - 3);
    cam.position.set(p.x, p.y + 2.4, p.z);
    const look = toWorld(s0 + 6, GEO.pavedOut + 1.9);
    cam.lookAt(look.x, look.y + 2.2, look.z);
  }
}
place();
document.getElementById('lbl').textContent =
  `km ${km} · ${sectionAt(s0).name} · ${sectionAt(s0).limit ?? 'frei'} · ${view}`;
window.__setCam = (az, el, dist) => {
  const w = toWorld(s0, 0);
  cam.position.set(w.x + Math.cos(az) * Math.cos(el) * dist, w.y + Math.sin(el) * dist, w.z + Math.sin(az) * Math.cos(el) * dist);
  cam.lookAt(w.x, w.y + 1, w.z);
};
/* handles for dev/probe.mjs: poke at materials and count triangles live */
window.__bench = {
  THREE, scene, cam, renderer, world,
  stats() {
    renderer.info.reset();
    renderer.render(scene, cam);
    return { tris: renderer.info.render.triangles, calls: renderer.info.render.calls,
             geoms: renderer.info.memory.geometries, texs: renderer.info.memory.textures };
  },
};
window.__ready = true;
let last = performance.now();
(function loop() {
  const now = performance.now(); const dt = (now - last) / 1000; last = now;
  world.update(dt, cam.position);
  renderer.render(scene, cam);
  requestAnimationFrame(loop);
})();
