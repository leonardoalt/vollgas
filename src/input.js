/* input.js — keyboard to analogue-ish controls. */
export class Input {
  constructor() {
    this.keys = new Set();
    this.throttle = 0; this.brake = 0; this.steer = 0;
    this.handbrake = false;
    this.pressed = new Set();
    const down = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    };
    const up = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', () => this.keys.clear());
  }
  has(...ks) { return ks.some(k => this.keys.has(k)); }
  /** true once per physical key press */
  tapped(...ks) {
    for (const k of ks) if (this.pressed.has(k)) { return true; }
    return false;
  }
  endFrame() { this.pressed.clear(); }

  update(dt) {
    const gas = this.has('w', 'ArrowUp');
    const dec = this.has('s', 'ArrowDown');
    const left = this.has('a', 'ArrowLeft');
    const right = this.has('d', 'ArrowRight');
    const rate = 1 / 0.16;
    this.throttle += ((gas ? 1 : 0) - this.throttle) * Math.min(1, dt * rate * 1.4);
    this.brake += ((dec ? 1 : 0) - this.brake) * Math.min(1, dt * rate * 2.2);
    const want = (right ? 1 : 0) - (left ? 1 : 0);
    // quicker to apply than to release, so the car settles cleanly
    const k = want === 0 ? 7.0 : 4.2;
    this.steer += (want - this.steer) * Math.min(1, dt * k);
    if (Math.abs(this.steer) < 0.002) this.steer = 0;
    this.handbrake = this.has(' ');
    return this;
  }
}
