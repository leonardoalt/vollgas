import * as THREE from 'three';
import { initMaterials, buildCar, buildTruck, CARS } from '../src/carFactory.js';
import { skyTex, groundTex } from '../src/textures.js';

const q = new URLSearchParams(location.search);
const ids = (q.get('cars') || 'turbo').split(',');
const mode = q.get('mode') || 'side';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const sky = skyTex(); sky.mapping = THREE.EquirectangularReflectionMapping;
const env = pmrem.fromEquirectangular(sky).texture;
scene.environment = env;
scene.background = sky;
initMaterials(env);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b6a5c, 2.2));
const sun = new THREE.DirectionalLight(0xfff4e2, 3.2);
sun.position.set(-40, 60, 35); scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd8ff, 0.9);
fill.position.set(45, 22, -40); scene.add(fill);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ map: groundTex('#63676b', '#54585c', 4000, [60, 60]), roughness: .95 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

const cars = [];
ids.forEach((id, i) => {
  const police = id.startsWith('zivi') || id === 'messwagen';
  const c = id === 'truck' ? buildTruck() : buildCar(id, police ? { police: true, paint: 0xb2b6b9 } : {});
  if (ids.length > 1) c.position.z = i * 6.2 - (ids.length - 1) * 3.1;
  scene.add(c); cars.push(c);
  if (police) c.userData.blues.forEach(b => b.material.emissiveIntensity = 7);
  if (police && c.userData.led) c.userData.led.material.map = c.userData.led.userData.on;
});

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 900);
const dims = cars[0].userData.dims;
const L = ids.length > 1 ? ids.length * 7 : dims.length;
function place() {
  const d = (ids.length > 1 ? ids.length * 6.2 : dims.length) * 1.32 + 2;
  const ty = dims.height * 0.48;
  const P = {
    side:   [d, ty, 0.001],
    front:  [0.001, ty, d],
    rear:   [0.001, ty, -d],
    front34:[d * 0.70, ty + d * 0.30, d * 0.68],
    rear34: [-d * 0.70, ty + d * 0.30, -d * 0.68],
    top:    [0.01, d * 1.05, 0.02],
  }[mode] || [d, ty, 0.001];
  camera.position.set(...P);
  camera.lookAt(0, ty, 0);
}
place();
window.__setCam = (az, el, dist, tx = 0, ty = dims.height * 0.5, tz = 0) => {
  camera.position.set(tx + Math.cos(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + Math.sin(az) * Math.cos(el) * dist);
  camera.lookAt(tx, ty, tz);
};
document.getElementById('lbl').textContent = ids.join(' ') + '  [' + mode + ']';
window.__ready = true;
(function loop() { renderer.render(scene, camera); requestAnimationFrame(loop); })();
