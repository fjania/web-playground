import * as THREE from 'three';
import { MOVE_ROTATIONS } from './cube-moves.js';

const TEMPO = {
  slow: 600,
  medium: 350,
  fast: 120,
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CubeAnimator {
  constructor(renderer) {
    this.renderer = renderer;
    this.queue = [];
    this.running = false;
    this.tempo = 'medium';
  }

  setTempo(t) {
    if (TEMPO[t]) this.tempo = t;
  }

  getTempoDuration() {
    return TEMPO[this.tempo];
  }

  // Enqueue a move animation. callback fires after animation completes.
  enqueue(move, callback) {
    this.queue.push({ move, callback });
    if (!this.running) this._next();
  }

  get isAnimating() {
    return this.running;
  }

  _next() {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }

    this.running = true;
    const { move, callback } = this.queue.shift();
    this._playMove(move, () => {
      if (callback) callback();
      this._next();
    });
  }

  _playMove(move, done) {
    const { face, type } = move;
    const rot = MOVE_ROTATIONS[face];
    if (!rot) { done(); return; }

    let angle = (Math.PI / 2) * rot.sign;
    if (type === 'ccw') angle = -angle;
    if (type === 'double') angle *= 2;

    const cubies = this.renderer.getCubiesOnLayer(rot.axis, rot.layer);
    if (cubies.length === 0) { done(); return; }

    const group = this.renderer.beginRotation(cubies);

    const axisArr = { x: [1,0,0], y: [0,1,0], z: [0,0,1] }[rot.axis];
    const axis = new THREE.Vector3(...axisArr);

    const duration = TEMPO[this.tempo];
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(t);

      group.rotation.set(0, 0, 0);
      group.rotateOnAxis(axis, angle * eased);

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        group.rotation.set(0, 0, 0);
        group.rotateOnAxis(axis, angle);
        this.renderer.endRotation(rot.axis, rot.layer, angle);
        done();
      }
    };

    requestAnimationFrame(tick);
  }
}
