/* ========================================================================
   tutorial.js — a deterministic, in-world lesson for the game's mechanics.

   The normal race deliberately leaves enforcement for the player to discover.
   The tutorial does the opposite: it stages one clear example of every signal,
   freezes the simulation at the useful instant, and points at the real object
   or HUD element. Nothing here is a second physics mode; the player still
   drives the normal car through the normal world.
   ======================================================================== */
import * as THREE from 'three';
import { t } from './i18n.js';

export const TUTORIAL_ROUTE = {
  startS: 13200,
  cameraS: 14920,
  freeS: 16230,
  finishS: 16720,
};

const $ = (id) => document.getElementById(id);

export class Tutorial {
  constructor(game, route = TUTORIAL_ROUTE) {
    this.game = game;
    this.route = route;
    this.stage = 'intro';
    this.modal = false;
    this.active = true;
    this.target = null;
    this._next = null;
    this._worldPoint = new THREE.Vector3();

    this.el = $('tutorial');
    this.focus = $('tutorial-focus');
    this.card = $('tutorial-card');
    this.kicker = $('tutorial-kicker');
    this.title = $('tutorial-title');
    this.body = $('tutorial-body');
    this.primary = $('tutorial-next');
    this.secondary = $('tutorial-secondary');
    this.objectiveEl = $('tutorial-objective');
    this.objectiveText = $('tutorial-objective-text');

    this.primary.onclick = () => this.advance();
    this.secondary.onclick = () => this.game.showMenu();
    $('tutorial-exit').onclick = () => this.game.showMenu();
  }

  start() {
    this.show({
      step: 1,
      title: t('tut.mission.title'),
      body: t('tut.mission.body'),
      next: () => this.show({
        step: 2,
        title: t('tut.law.title'),
        body: t('tut.law.body'),
        next: () => {
          this.stage = 'drive-limit';
          this.driveT = 0;
          this.objective(t('tut.drive.objective'));
        },
      }),
    });
  }

  show({ step, title, body, target = null, placement = 'center', next, complete = false }) {
    this.modal = true;
    this.target = target;
    this._next = next || null;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('has-target', !!target);
    this.card.dataset.placement = placement;
    this.kicker.textContent = complete
      ? t('tut.complete.kicker')
      : t('tut.step', { n: step, total: 7 });
    this.title.textContent = title;
    this.body.textContent = body;
    this.primary.textContent = complete ? t('tut.race') : t('tut.continue');
    this.secondary.textContent = t('tut.menu');
    this.secondary.classList.toggle('hidden', !complete);
    this.hideObjective();
    this.game.input.keys.clear();
    this.game.audio.hush();
    this.layout(this.game.camera);
  }

  advance() {
    if (!this.modal) return;
    const next = this._next;
    const complete = this.stage === 'complete';
    this.modal = false;
    this.target = null;
    this._next = null;
    this.el.classList.add('hidden');
    this.secondary.classList.add('hidden');
    this.game.input.keys.clear();
    if (complete) {
      this.game.startRace();
      return;
    }
    this.game.audio.resume();
    if (next) next();
  }

  objective(text, good = false) {
    this.objectiveText.textContent = text;
    this.objectiveEl.classList.remove('hidden');
    this.objectiveEl.classList.toggle('good', good);
  }

  hideObjective() { this.objectiveEl.classList.add('hidden'); }

  update(dt) {
    if (!this.active || this.modal) return;
    const p = this.game.player;
    const cam = this.game.enf.tutorialCamera;

    if (this.stage === 'drive-limit') {
      this.driveT += dt;
      if (this.driveT > 3.2 || p.s > this.route.startS + 140) {
        this.stage = 'limit';
        this.show({
          step: 3,
          title: t('tut.limit.title'),
          body: t('tut.limit.body'),
          target: { dom: '#hud-limit' },
          placement: 'left',
          next: () => {
            this.stage = 'await-flash';
            this.objective(t('tut.flash.objective'));
            this.game.enf.tutorialWarningsArmed = true;
            this.game.traffic.stageTutorialFlasher(p.s);
          },
        });
      }
      return;
    }

    if (this.stage === 'approach-camera' && cam && cam.s - p.s < 135) {
      this.stage = 'camera';
      this.show({
        step: 5,
        title: t('tut.camera.title'),
        body: t('tut.camera.body'),
        target: { world: cam.mesh, size: 150 },
        placement: 'bottom',
        next: () => {
          this.stage = 'await-provida';
          this.objective(t('tut.camera.objective'));
        },
      });
      return;
    }

    if (this.stage === 'await-provida' && p.s > this.route.cameraS + 150) {
      this.stage = 'provida-starting';
      this.game.enf.startTutorialMeasure(p);
      return;
    }

    if ((this.stage === 'measure' || this.stage === 'measure-resolved') && p.s >= this.route.freeS) {
      this.game.enf.dismissTutorialCop();
      this.stage = 'free';
      this.show({
        step: 7,
        title: t('tut.free.title'),
        body: t('tut.free.body'),
        target: { dom: '#hud-limit' },
        placement: 'left',
        next: () => {
          this.stage = 'free-drive';
          this.freeT = 0;
          this.freeStartS = p.s;
          this.objective(t('tut.free.objective'), true);
        },
      });
      return;
    }

    if (this.stage === 'free-drive') {
      this.freeT += dt;
      if (this.freeT > 6 || p.s > this.freeStartS + 420) this.complete();
    }
  }

  handleEvent(ev) {
    if (!this.active) return false;

    if (ev.type === 'lichthupe' && this.stage === 'await-flash') {
      const flasher = ev.flashers && ev.flashers[0];
      this.stage = 'flash';
      this.show({
        step: 4,
        title: t('tut.flash.title'),
        body: t('tut.flash.body'),
        target: flasher ? { world: flasher.mesh, size: 104 } : null,
        placement: 'bottom',
        next: () => {
          this.stage = 'approach-camera';
          this.objective(t('tut.camera.approach'));
        },
      });
      return true;
    }

    if (ev.type === 'measure-start' && this.stage === 'provida-starting') {
      this.stage = 'measure';
      this.show({
        step: 6,
        title: t('tut.provida.title'),
        body: t('tut.provida.body'),
        target: { dom: '#hud-provida' },
        placement: 'top',
        next: () => this.objective(t('tut.provida.objective')),
      });
      return true;
    }

    if (['measure-abort', 'measure-lost', 'measure-freed'].includes(ev.type)
        && this.stage === 'measure') {
      this.stage = 'measure-resolved';
      const key = ev.type === 'measure-lost' ? 'tut.provida.lost'
        : ev.type === 'measure-freed' ? 'tut.provida.freed' : 'tut.provida.safe';
      this.objective(t(key), true);
      return false;                         // keep the normal green HUD alert
    }

    if ((ev.type === 'measure-done' || (ev.type === 'criminal' && ev.source === 'provida'))
        && (this.stage === 'measure' || this.stage === 'measure-resolved')) {
      this.game.enf.dismissTutorialCop();
      this.stage = 'measure-resolved';
      this.show({
        step: 6,
        title: t('tut.provida.caught.title'),
        body: t('tut.provida.caught.body'),
        placement: 'center',
        next: () => this.objective(t('tut.free.approach')),
      });
      return true;                          // never end a lesson with an arrest
    }

    /* Going absurdly fast past the tutorial camera can cross the game's
       criminal-offence threshold. Show the flash, but do not terminate the
       lesson before the player has seen the remaining mechanics. */
    if (ev.type === 'criminal' && ev.source === 'blitzer') {
      this.game.hud.blitzFlash();
      this.game.audio.flash();
      return true;
    }

    return false;
  }

  complete() {
    if (this.stage === 'complete') return;
    this.stage = 'complete';
    this.show({
      title: t('tut.complete.title'),
      body: t('tut.complete.body'),
      complete: true,
    });
  }

  /** Keep the spotlight attached to either a DOM panel or a moving 3D car. */
  layout(camera) {
    if (!this.modal || !this.target) {
      this.focus.classList.add('hidden');
      return;
    }

    let x, y, w, h;
    if (this.target.dom) {
      const node = document.querySelector(this.target.dom);
      if (!node) return;
      const r = node.getBoundingClientRect();
      x = r.left - 12; y = r.top - 12; w = r.width + 24; h = r.height + 24;
    } else if (this.target.world) {
      const object = this.target.world;
      /* The callout can be opened midway through Game.step(), before the next
         renderer pass refreshes camera.matrixWorldInverse. Update it here so
         a moving-world spotlight never uses the previous camera position. */
      camera.updateMatrixWorld(true);
      object.getWorldPosition(this._worldPoint);
      this._worldPoint.y += 1.0;
      this._worldPoint.project(camera);
      const size = this.target.size || 104;
      x = (this._worldPoint.x * 0.5 + 0.5) * innerWidth - size / 2;
      y = (-this._worldPoint.y * 0.5 + 0.5) * innerHeight - size / 2;
      w = size; h = size;
    }
    this.focus.style.left = `${Math.max(8, x)}px`;
    this.focus.style.top = `${Math.max(8, y)}px`;
    this.focus.style.width = `${Math.min(innerWidth - 16, w)}px`;
    this.focus.style.height = `${Math.min(innerHeight - 16, h)}px`;
    this.focus.classList.remove('hidden');
  }

  destroy() {
    this.active = false;
    this.modal = false;
    this.target = null;
    this.el.classList.add('hidden');
    this.focus.classList.add('hidden');
    this.hideObjective();
  }
}
