/* glTF model bench: loads the real bodies through the same path the game uses.
   ?cars=turbo,taxi &mode=side|front|rear|front34|rear34|top &env=studio|road
   &grid=1 draws a 1 m reference grid and the rig's axle marks.            */
import * as THREE from 'three';
import { initMaterials, buildCar, CARS } from '../src/carFactory.js';
import { preloadCarModels, modelStats, hasModel } from '../src/carModels.js';
import { roadEnv, studioEnv } from '../src/carEnv.js';
import { createPostFX } from '../src/postfx.js';
import { groundTex } from '../src/textures.js';

const q = new URLSearchParams(location.search);
const ids = (q.get('cars') || 'turbo').split(',');
const mode = q.get('mode') || 'front34';
const envKind = q.get('env') || 'studio';
const wantGrid = q.get('grid') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = envKind === 'studio' ? 1.0 : 1.06;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const env = envKind === 'studio' ? studioEnv(renderer) : roadEnv(renderer);
scene.environment = env;
initMaterials(env);

if (envKind === 'studio') {
  scene.background = new THREE.Color(0x11151a);
  const key = new THREE.DirectionalLight(0xfff2df, 1.15);
  key.position.set(-5, 5.5, 7); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8cbff, 0.55);
  rim.position.set(6, 3.5, -6); scene.add(rim);
} else {
  scene.background = new THREE.Color(0xa9c6de);
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x5d6247, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.position.set(-165, 225, 250); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      map: groundTex('#8d9298', '#82878d', 4000, [60, 60]), roughness: 0.95,
      envMap: env, envMapIntensity: 0.3,
    }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
}

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 900);
let dims = CARS[ids[0]].dims;

function place() {
  const d = (ids.length > 1 ? ids.length * 6.2 : dims.length) * 1.32 + 2;
  const ty = dims.height * 0.48;
  const P = {
    side: [d, ty, 0.001],
    front: [0.001, ty, d],
    rear: [0.001, ty, -d],
    front34: [d * 0.70, ty + d * 0.30, d * 0.68],
    rear34: [-d * 0.70, ty + d * 0.30, -d * 0.68],
    top: [0.01, d * 1.05, 0.02],
  }[mode] || [d, ty, 0.001];
  camera.position.set(...P);
  camera.lookAt(0, ty, 0);
}
window.__setCam = (az, el, dist, tx = 0, ty = dims.height * 0.5, tz = 0) => {
  camera.position.set(tx + Math.cos(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + Math.sin(az) * Math.cos(el) * dist);
  camera.lookAt(tx, ty, tz);
};

const post = createPostFX(renderer, innerWidth, innerHeight);
const label = document.getElementById('lbl');

(async () => {
  const stats = await preloadCarModels(env, (f, s) => {
    label.textContent = `loading ${s} ${(f * 100).toFixed(0)}%`;
  });

  const cars = [];
  ids.forEach((id, i) => {
    const spec = CARS[id];
    const paint = spec.paints ? spec.paints[0].c : 0x9aa0a6;
    const c = buildCar(id, { paint, glow: false });
    if (ids.length > 1) c.position.z = i * 6.2 - (ids.length - 1) * 3.1;
    scene.add(c); cars.push(c);
  });
  dims = CARS[ids[0]].dims;
  place();

  if (wantGrid) {
    const grid = new THREE.GridHelper(12, 12, 0x446688, 0x223344);
    grid.position.y = 0.002; scene.add(grid);
    // rig axle marks: where vehicles.js thinks the wheels are
    for (const id of ids) {
      const s = CARS[id];
      for (const [z, r] of [[s.axleF, s.wheelRF], [s.axleR, s.wheelRR]]) {
        for (const sx of [-1, 1]) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xff3355 }));
          m.position.set((sx * (z === s.axleF ? s.trackF : s.trackR)) / 2, r, z);
          scene.add(m);
        }
      }
    }
  }

  let tris = 0;
  for (const c of cars) {
    c.traverse(o => {
      if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3;
      else if (o.isMesh) tris += o.geometry.attributes.position.count / 3;
    });
  }
  window.__cars = cars;
  window.__stats = { stats, tris, model: ids.map(hasModel) };
  label.textContent = `${ids.join(' ')} [${mode}] env=${envKind} `
    + `model=${ids.map(i => (hasModel(i) ? 'Y' : 'n')).join('')} tris=${tris} `
    + JSON.stringify(modelStats());
  window.__ready = true;
})();

(function loop() {
  if (post) post.render(scene, camera); else renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();
