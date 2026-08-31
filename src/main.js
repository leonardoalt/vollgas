import './style.css';
import { Game } from './game.js';
import { t, applyDom } from './i18n.js';

const game = new Game(document.getElementById('scene'));
window.__game = game;

document.getElementById('start-btn').onclick = () => game.startRace();
document.getElementById('again-btn').onclick = () => {
  document.getElementById('results').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  game.state = 'menu';
  game.audio.hush();
  applyDom();
  game.buildMenu();
};
addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (game.state === 'menu')) game.startRace();
});

game.init().then(() => { window.__ready = true; }).catch(err => {
  console.error(err);
  const el = document.getElementById('load-text');
  if (el) el.textContent = 'Error: ' + err.message;
});
