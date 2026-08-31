/* Car bench, lit the way the game and the menu actually light them.
   dev/cars.js is left alone (it is the historical bench, on the flat-gradient
   PMREM); this one uses carEnv.js so what you see is what ships.

   ?cars=turbo,m5 &mode=side|front|rear|front34|rear34|top
   &env=road|studio  &post=1|0                                              */
import * as THREE from 'three';
import { initMaterials, buildCar, buildTruck, CARS } from '../src/carFactory.js';
import { roadEnv, studioEnv } from '../src/carEnv.js';
import { createPostFX } from '../src/postfx.js';
import { groundTex } from '../src/textures.js';

const q = new URLSearchParams(location.search);
const ids = (q.get('cars') || 'turbo').split(',');
const mode = q.get('mode') || 'side';
const envKind = q.get('env') || 'road';
const wantPost = q.get('post') !== '0';

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
  scene.background = new THREE.Color(0x14181c);
  const key = new THREE.DirectionalLight(0xfff2df, 1.15);
  key.position.set(-5, 5.5, 7); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8cbff, 0.55);
  rim.position.set(6, 3.5, -6); scene.add(rim);
} else {
  // the world's own rig, copied out of world.js so the match is honest
  scene.background = new THREE.Color(0xa9c6de);
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x5d6247, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.position.set(-165, 225, 250); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      map: groundTex('#8d9298', '#82878d', 4000, [60, 60]), roughness: 0.95, envMap: env, envMapIntensity: 0.3,
    }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
}

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
place();
window.__setCam = (az, el, dist, tx = 0, ty = dims.height * 0.5, tz = 0) => {
  camera.position.set(tx + Math.cos(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + Math.sin(az) * Math.cos(el) * dist);
  camera.lookAt(tx, ty, tz);
};

const post = wantPost ? createPostFX(renderer, innerWidth, innerHeight) : null;
document.getElementById('lbl').textContent =
  `${ids.join(' ')}  [${mode}] env=${envKind} post=${post ? 'on' : 'off'}`;
window.__cars = cars; window.__scene = scene;
window.__ready = true;
(function loop() {
  if (post) post.render(scene, camera); else renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();
