import './style.css';
import { Game } from './game.js';

const game = new Game(document.getElementById('scene'));
window.__game = game;

document.getElementById('start-btn').onclick = () => game.startRace();
document.getElementById('tutorial-btn').onclick = () => game.startTutorial();
document.getElementById('again-btn').onclick = () => {
  game.showMenu();
};
addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (game.state === 'menu')) game.startRace();
});

game.init().then(() => { window.__ready = true; }).catch(err => {
  console.error(err);
  const el = document.getElementById('load-text');
  if (el) el.textContent = 'Error: ' + err.message;
});
