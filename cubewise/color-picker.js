// Color picker UI for manually correcting scanned face colors.
// Shows a 3x3 grid of detected colors with a 6-color palette to fix misreads.

import { COLORS, FACE_NAMES } from './cube-state.js';

const COLOR_HEX = {
  W: '#ffffff',
  Y: '#ffd500',
  G: '#009b48',
  B: '#0045ad',
  R: '#b90000',
  O: '#ff5900',
};

const COLOR_NAMES = {
  W: 'White', Y: 'Yellow', G: 'Green', B: 'Blue', R: 'Red', O: 'Orange',
};

export class ColorPicker {
  constructor(containerEl, scanner) {
    this.container = containerEl;
    this.scanner = scanner;
    this.currentFace = null;
    this.selectedCell = null;
    this.onUpdate = null;
  }

  show(face) {
    this.currentFace = face;
    this.selectedCell = null;
    this._render();
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
    this.currentFace = null;
  }

  _render() {
    const colors = this.scanner.getFaceColors(this.currentFace);
    if (!colors) return;

    let html = `<div class="cp-title">Correct: ${this.currentFace} face</div>`;
    html += '<div class="cp-grid">';
    for (let i = 0; i < 9; i++) {
      const color = colors[i];
      const selected = this.selectedCell === i ? ' cp-selected' : '';
      const isCenter = i === 4 ? ' cp-center' : '';
      html += `<div class="cp-cell${selected}${isCenter}" data-idx="${i}" style="background:${COLOR_HEX[color]}" title="${COLOR_NAMES[color]}"></div>`;
    }
    html += '</div>';

    if (this.selectedCell !== null) {
      html += '<div class="cp-palette">';
      for (const [color, hex] of Object.entries(COLOR_HEX)) {
        html += `<div class="cp-swatch" data-color="${color}" style="background:${hex}" title="${COLOR_NAMES[color]}"></div>`;
      }
      html += '</div>';
    }

    html += '<div class="cp-actions"><button class="btn cp-done">Done</button></div>';

    this.container.innerHTML = html;

    // Wire events
    for (const cell of this.container.querySelectorAll('.cp-cell')) {
      cell.addEventListener('click', () => {
        const idx = parseInt(cell.dataset.idx);
        if (idx === 4) return; // center is fixed
        this.selectedCell = this.selectedCell === idx ? null : idx;
        this._render();
      });
    }

    for (const swatch of this.container.querySelectorAll('.cp-swatch')) {
      swatch.addEventListener('click', () => {
        if (this.selectedCell === null) return;
        this.scanner.setFacelet(this.currentFace, this.selectedCell, swatch.dataset.color);
        this.selectedCell = null;
        this._render();
        if (this.onUpdate) this.onUpdate();
      });
    }

    const doneBtn = this.container.querySelector('.cp-done');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => this.hide());
    }
  }
}
