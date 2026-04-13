// In-memory solve timer with session statistics (ao5, ao12, PB).

export class Timer {
  constructor(displayEl) {
    this.displayEl = displayEl;
    this.running = false;
    this.startTime = 0;
    this.elapsed = 0;
    this._raf = null;
    this.solves = []; // array of times in ms
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now() - this.elapsed;
    this.displayEl.classList.add('running');
    this._tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.elapsed = performance.now() - this.startTime;
    cancelAnimationFrame(this._raf);
    this.displayEl.classList.remove('running');
    this._render();
    return this.elapsed;
  }

  reset() {
    this.running = false;
    this.elapsed = 0;
    cancelAnimationFrame(this._raf);
    this.displayEl.classList.remove('running');
    this._render();
  }

  recordSolve() {
    const time = this.elapsed;
    if (time > 0) {
      this.solves.push(time);
    }
    return time;
  }

  // Format ms as M:SS.cc
  static format(ms) {
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const secStr = sec < 10 ? '0' + sec.toFixed(2) : sec.toFixed(2);
    return `${min}:${secStr}`;
  }

  // Average of N, dropping best and worst (for N >= 3)
  static averageOfN(times, n) {
    if (times.length < n) return null;
    const last = times.slice(-n).sort((a, b) => a - b);
    if (n <= 2) {
      return last.reduce((s, t) => s + t, 0) / last.length;
    }
    // Drop best and worst
    const trimmed = last.slice(1, -1);
    return trimmed.reduce((s, t) => s + t, 0) / trimmed.length;
  }

  getStats() {
    if (this.solves.length === 0) return null;
    const pb = Math.min(...this.solves);
    const ao5 = Timer.averageOfN(this.solves, 5);
    const ao12 = Timer.averageOfN(this.solves, 12);
    return { pb, ao5, ao12, count: this.solves.length };
  }

  _tick() {
    if (!this.running) return;
    this.elapsed = performance.now() - this.startTime;
    this._render();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  _render() {
    this.displayEl.textContent = Timer.format(this.elapsed);
  }
}
