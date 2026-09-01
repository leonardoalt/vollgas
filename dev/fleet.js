/* Fleet bench: builds every vehicle in CARS plus the truck, through exactly
   the path the game uses, and exposes them for measurement and for contact
   sheets.

   `dev/fleet-check.mjs` drives this page; so do the screenshot runs. Query:
     ?ids=all|turbo,taxi,...   which vehicles (default all)
     ?mode=side|front34|rear34|front|rear|top
     ?env=road|studio
     ?layout=row|grid|stack    row = one line, grid = contact sheet,
                               stack = every car at the origin (measurement)
     ?grid=1                   draw a 1 m grid and the rig's axle marks
     ?paint=<hex>              force one colour, so shape is what you see    */
import * as THREE from 'three';
import { initMaterials, buildCar, buildTruck, CARS } from '../src/carFactory.js';
import { preloadCarModels, modelStats, modelFit, hasModel, truckFit, hasTruckModel } from '../src/carModels.js';
import { roadEnv, studioEnv } from '../src/carEnv.js';
import { groundTex } from '../src/textures.js';

const q = new URLSearchParams(location.search);
export const ALL = [...Object.keys(CARS), 'truck'];
const ids = (q.get('ids') || 'all') === 'all' ? ALL : q.get('ids').split(',');
const mode = q.get('mode') || 'side';
const envKind = q.get('env') || 'road';
const layout = q.get('layout') || 'row';
const wantGrid = q.get('grid') === '1';
const forcePaint = q.get('paint') ? parseInt(q.get('paint'), 16) : null;

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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({
      map: groundTex('#8d9298', '#82878d', 4000, [90, 90]), roughness: 0.95,
      envMap: env, envMapIntensity: 0.3,
    }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
}

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 1200);
const label = document.getElementById('lbl');

function build(id) {
  if (id === 'truck') return buildTruck({});
  const spec = CARS[id];
  const police = id.startsWith('zivi') || id === 'messwagen';
  const paint = forcePaint !== null ? forcePaint
    : police ? 0x8f9498 : (spec.paints ? spec.paints[0].c : 0x9aa0a6);
  const c = buildCar(id, { paint, glow: false, police });
  if (police) {
    c.userData.blues.forEach(b => { b.material.emissiveIntensity = 7; });
    if (c.userData.led) c.userData.led.material.map = c.userData.led.userData.on;
  }
  return c;
}

(async () => {
  await preloadCarModels(env, (f, s) => { label.textContent = `loading ${s} ${(f * 100).toFixed(0)}%`; });

  const cars = [];
  const pitch = ids.includes('truck') ? 20 : 6.4;
  const cols = Math.ceil(Math.sqrt(ids.length));
  /* A row for a *side* elevation has to run along Z, because that is the axis
     the camera is not on. Lay it out along X and every car hides behind the
     one in front — which is how the first contact sheet came out as a single
     lorry with a saloon parked inside it. */
  const rowAxis = mode === 'side' ? 'z' : 'x';
  ids.forEach((id, i) => {
    const c = build(id);
    if (layout === 'row') c.position[rowAxis] = i * pitch - (ids.length - 1) * pitch / 2;
    else if (layout === 'grid') {
      c.position.x = (i % cols) * pitch - (cols - 1) * pitch / 2;
      c.position.z = -Math.floor(i / cols) * (pitch * 1.6);
    }
    scene.add(c);
    cars.push({ id, obj: c });
  });

  if (wantGrid) {
    const g = new THREE.GridHelper(20, 20, 0x446688, 0x223344);
    g.position.y = 0.002; scene.add(g);
    for (const { id, obj } of cars) {
      const s = CARS[id]; if (!s) continue;
      for (const [z, r, t] of [[s.axleF, s.wheelRF, s.trackF], [s.axleR, s.wheelRR, s.trackR]]) {
        for (const sx of [-1, 1]) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xff3355 }));
          m.position.set(obj.position.x + sx * t / 2, r, obj.position.z + z);
          scene.add(m);
        }
      }
    }
  }

  /* Frame everything.

     Computing a distance from the scene's width and hoping is not enough: for
     a three-quarter view the camera sits off to one side, so the far car is
     further away than the near one and falls out of frame. Place the camera on
     the chosen bearing, then project every corner of every vehicle and push
     the camera back until they all land inside the frustum. Ten iterations
     converge on anything. */
  const box = new THREE.Box3();
  for (const { obj } of cars) box.expandByObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const target = new THREE.Vector3(centre.x, Math.max(size.y * 0.42, 0.6), centre.z);

  const DIR = {
    side: [1, 0.10, 0.001],
    front: [0.001, 0.10, 1],
    rear: [0.001, 0.10, -1],
    front34: [0.70, 0.34, 0.66],
    rear34: [-0.70, 0.34, -0.66],
    top: [0.01, 1.0, 0.02],
  }[mode] || [1, 0.10, 0.001];
  const dir = new THREE.Vector3(...DIR).normalize();

  const corners = [];
  for (const { obj } of cars) {
    const b = new THREE.Box3().setFromObject(obj);
    for (const x of [b.min.x, b.max.x]) {
      for (const y of [b.min.y, b.max.y]) {
        for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
  }

  let d = Math.max(size.x, size.z, size.y) * 1.2 + 4;
  for (let i = 0; i < 10; i++) {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let worst = 0;
    const v = new THREE.Vector3();
    for (const c of corners) {
      v.copy(c).project(camera);
      worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
    }
    if (worst < 0.94 && worst > 0.80) break;
    d *= worst / 0.90;
  }
  camera.position.copy(target).addScaledVector(dir, d);
  camera.lookAt(target);

  // name tags, so a contact sheet is readable
  if (layout !== 'stack') {
    for (const { id, obj } of cars) {
      const v = new THREE.Vector3(obj.position.x, 0.02, obj.position.z).project(camera);
      const el = document.createElement('div');
      el.className = 'tag';
      el.textContent = id;
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth - 40}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight + 6}px`;
      el.style.width = '80px';
      document.body.appendChild(el);
    }
  }

  window.__fleet = cars;
  const tf = truckFit();
  window.__fit = { ...modelFit(), ...(tf ? { truck: tf } : {}) };
  window.__stats = modelStats();
  window.__model = Object.fromEntries(ids.map(i => [i, i === 'truck' ? hasTruckModel() : hasModel(i)]));
  label.textContent = `${ids.length} vehicles [${mode}/${layout}] env=${envKind} `
    + `models=${Object.entries(window.__model).filter(([, v]) => v).map(([k]) => k).join(',') || 'none'}`;
  window.__ready = true;
})();

(function loop() { renderer.render(scene, camera); requestAnimationFrame(loop); })();
