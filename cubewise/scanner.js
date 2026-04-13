// Webcam face scanner for augmented mode.
// Captures 6 faces one at a time, classifies colors via HSL with
// adaptive calibration, auto-captures when confident, and mirrors video.

import { COLORS, FACE_NAMES, validateColorCounts } from './cube-state.js';

// Scanning order with orientation instructions.
// The user holds the cube and rotates it through a natural sequence.
const SCAN_ORDER = [
  { face: 'F', label: 'Front',  color: 'Green',  emoji: '🟩', arrow: null },
  { face: 'R', label: 'Right',  color: 'Red',    emoji: '🟥', arrow: '→' },
  { face: 'B', label: 'Back',   color: 'Blue',   emoji: '🟦', arrow: '→' },
  { face: 'L', label: 'Left',   color: 'Orange', emoji: '🟧', arrow: '→' },
  { face: 'U', label: 'Top',    color: 'White',  emoji: '⬜', arrow: '↑' },
  { face: 'D', label: 'Bottom', color: 'Yellow', emoji: '🟨', arrow: '↓' },
];

// HSL classification: uses ranges rather than single-point distance.
// Each color has a hue range, saturation floor, and lightness range.
const COLOR_RULES = [
  // White: the BRIGHTEST color on the cube. Under webcam lighting white stickers
  // can appear fully saturated (s=100) with any hue tint, but always very light.
  // l >= 82 is almost always white regardless of saturation.
  { color: 'W', test: (h, s, l) => l >= 82 },
  // Lower lightness white still needs low-ish saturation
  { color: 'W', test: (h, s, l) => s < 15 && l > 50 },
  { color: 'W', test: (h, s, l) => s < 30 && l > 65 },
  { color: 'W', test: (h, s, l) => s < 45 && l > 72 },
  // Yellow: warm hue, decent saturation, not too dark
  { color: 'Y', test: (h, s, l) => s > 35 && l > 40 && l < 80 && h >= 38 && h < 70 },
  // Orange: narrow hue band between red and yellow
  { color: 'O', test: (h, s, l) => s > 40 && l > 25 && l < 80 && h >= 10 && h < 38 },
  // Red: wraps around 0/360
  { color: 'R', test: (h, s, l) => s > 40 && l > 15 && l < 75 && (h < 10 || h >= 340) },
  // Green: broad hue range
  { color: 'G', test: (h, s, l) => s > 25 && l > 12 && l < 75 && h >= 80 && h < 180 },
  // Blue: needs to be darker than white — cap at l < 75
  { color: 'B', test: (h, s, l) => s > 40 && l > 12 && l < 75 && h >= 180 && h < 270 },
];

// Fallback: Euclidean distance to reference points
const COLOR_REFS = {
  W: { h: 0,   s: 5,  l: 85 },
  Y: { h: 50,  s: 85, l: 60 },
  G: { h: 145, s: 65, l: 38 },
  B: { h: 220, s: 75, l: 42 },
  R: { h: 355, s: 80, l: 42 },
  O: { h: 22,  s: 90, l: 52 },
};

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function classifyColor(h, s, l) {
  // Try rule-based classification first
  for (const rule of COLOR_RULES) {
    if (rule.test(h, s, l)) return rule.color;
  }

  // Fallback: nearest reference
  let best = 'W', bestDist = Infinity;
  for (const [color, ref] of Object.entries(COLOR_REFS)) {
    let hd = Math.abs(h - ref.h);
    if (hd > 180) hd = 360 - hd;
    const dist = hd * 1.5 + Math.abs(s - ref.s) * 0.6 + Math.abs(l - ref.l) * 0.8;
    if (dist < bestDist) { bestDist = dist; best = color; }
  }
  return best;
}

// Sample a region and return median RGB
function sampleRegion(data, cx, cy, radius, stride) {
  const rs = [], gs = [], bs = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const i = ((cy + dy) * stride + (cx + dx)) * 4;
      if (i < 0 || i >= data.length - 3) continue;
      rs.push(data[i]); gs.push(data[i+1]); bs.push(data[i+2]);
    }
  }
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const m = rs.length >> 1;
  return { r: rs[m], g: gs[m], b: bs[m] };
}

// Classify all 9 cells from current frame, with adaptive calibration
// using the center facelet as a known reference.
function classifyFace(imageData, w, h, gridSize, ox, oy) {
  const cellSize = gridSize / 3;
  const radius = Math.max(3, Math.floor(cellSize * 0.18));
  const data = imageData.data;
  const results = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = Math.floor(ox + cellSize * (col + 0.5));
      const cy = Math.floor(oy + cellSize * (row + 0.5));
      const rgb = sampleRegion(data, cx, cy, radius, w);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      results.push({ color: classifyColor(hsl.h, hsl.s, hsl.l), hsl, rgb });
    }
  }

  return results;
}

// Confidence: how many cells have strong saturation/lightness differentiation
function computeConfidence(cells, expectedCenter) {
  let score = 0;
  for (let i = 0; i < 9; i++) {
    const { hsl } = cells[i];
    // Penalise mid-range "ambiguous" saturation/lightness
    if (hsl.s > 30 || hsl.l > 60) score += 1;
    else score += 0.5;
  }
  // Center must match expected
  if (cells[4].color === expectedCenter) score += 3;
  else score -= 5;

  return score / 12; // normalize 0-1ish
}

const COLOR_HEX = {
  W: '#ffffff', Y: '#ffd500', G: '#009b48', B: '#0045ad', R: '#b90000', O: '#ff5900',
};

export class Scanner {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.scanStep = 0;
    this.scannedFaces = {};
    this.onScanComplete = null;
    this.onStepChange = null;
    this.onAutoCapture = null;

    // Auto-capture state
    this._stableFrames = 0;
    this._lastColors = null;
    this._autoEnabled = true;
  }

  async start(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.scanStep = 0;
    this.scannedFaces = {};
    this._stableFrames = 0;
    this._lastColors = null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      this._drawLoop();
      return true;
    } catch (e) {
      console.error('Camera access failed:', e);
      return false;
    }
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    cancelAnimationFrame(this._raf);
  }

  getCurrentStep() {
    if (this.scanStep >= SCAN_ORDER.length) return null;
    return SCAN_ORDER[this.scanStep];
  }

  getScanOrder() { return SCAN_ORDER; }

  // Jump back to rescan a specific face
  rescanFace(face) {
    const idx = SCAN_ORDER.findIndex(s => s.face === face);
    if (idx === -1) return;
    delete this.scannedFaces[face];
    this.scanStep = idx;
    this._stableFrames = 0;
    this._lastColors = null;
    if (this.onStepChange) this.onStepChange(this.scanStep);
  }

  // Manual capture
  capture() {
    return this._doCapture();
  }

  _doCapture() {
    const step = this.getCurrentStep();
    if (!step) return null;

    const { cells } = this._analyzeFrame();
    if (!cells) return null;

    const colors = cells.map(c => c.color);

    // The canvas is drawn mirrored for natural UX, so flip each row
    // to get the actual cube face orientation
    for (let row = 0; row < 3; row++) {
      const i = row * 3;
      const tmp = colors[i];
      colors[i] = colors[i + 2];
      colors[i + 2] = tmp;
    }

    // Log HSL values for debugging
    console.log(`[scan] Face ${step.face} (${step.color}) captured:`);
    for (let row = 0; row < 3; row++) {
      const rowCells = [0,1,2].map(col => {
        const idx = row * 3 + col;
        const { hsl } = cells[idx];
        return `${colors[idx]}(h${Math.round(hsl.h)} s${Math.round(hsl.s)} l${Math.round(hsl.l)})`;
      });
      console.log(`  row${row}: ${rowCells.join('  ')}`);
    }

    // Force center to expected color
    colors[4] = COLORS[step.face];

    this.scannedFaces[step.face] = colors;
    this.scanStep++;
    this._stableFrames = 0;
    this._lastColors = null;

    if (this.onStepChange) this.onStepChange(this.scanStep);

    if (this.scanStep >= SCAN_ORDER.length) {
      return this._buildState();
    }

    return null;
  }

  _analyzeFrame() {
    if (!this.video || !this.ctx) return {};
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Draw mirrored
    this.ctx.save();
    this.ctx.translate(w, 0);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(this.video, 0, 0);
    this.ctx.restore();

    const gridSize = Math.min(w, h) * 0.5;
    const ox = (w - gridSize) / 2;
    const oy = (h - gridSize) / 2;

    const imageData = this.ctx.getImageData(0, 0, w, h);
    const cells = classifyFace(imageData, w, h, gridSize, ox, oy);

    return { cells, gridSize, ox, oy, w, h };
  }

  setFacelet(face, index, color) {
    if (this.scannedFaces[face]) {
      this.scannedFaces[face][index] = color;
    }
  }

  getFaceColors(face) {
    return this.scannedFaces[face] || null;
  }

  _buildState() {
    const state = {};
    for (const face of FACE_NAMES) {
      state[face] = this.scannedFaces[face] || Array(9).fill(COLORS[face]);
    }

    if (!validateColorCounts(state)) {
      return { error: 'Invalid color counts — each color should appear exactly 9 times. Click faces below to correct.' };
    }

    return { state };
  }

  _drawLoop() {
    if (!this.stream) return;

    const { cells, gridSize, ox, oy, w, h } = this._analyzeFrame();
    if (!cells) { this._raf = requestAnimationFrame(() => this._drawLoop()); return; }

    const cellSize = gridSize / 3;

    // Draw grid overlay
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(ox, oy, gridSize, gridSize);

    for (let i = 1; i < 3; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(ox + cellSize * i, oy);
      this.ctx.lineTo(ox + cellSize * i, oy + gridSize);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(ox, oy + cellSize * i);
      this.ctx.lineTo(ox + gridSize, oy + cellSize * i);
      this.ctx.stroke();
    }

    // Draw detected color swatches in each cell
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        const cx = ox + cellSize * (col + 0.5);
        const cy = oy + cellSize * (row + 0.5);
        const color = cells[idx].color;

        const isCenter = idx === 4;
        const step = this.getCurrentStep();
        const centerMatches = isCenter && step && color === COLORS[step.face];

        // Center dot is bigger and gets a match/mismatch ring
        const dotR = isCenter ? cellSize * 0.32 : cellSize * 0.2;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        this.ctx.fillStyle = COLOR_HEX[color];
        this.ctx.fill();

        if (isCenter) {
          // Bold ring: green if center matches expected, red if not
          this.ctx.strokeStyle = centerMatches ? '#4ade80' : '#ef4444';
          this.ctx.lineWidth = 3;
          this.ctx.stroke();
        } else {
          this.ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          this.ctx.lineWidth = 1.5;
          this.ctx.stroke();
        }
      }
    }

    // Auto-capture logic: if colors stable for N frames and center matches
    const step = this.getCurrentStep();
    if (step && this._autoEnabled) {
      const currentColors = cells.map(c => c.color).join('');
      const centerMatches = cells[4].color === COLORS[step.face];

      if (currentColors === this._lastColors && centerMatches) {
        this._stableFrames++;
      } else {
        this._stableFrames = 0;
      }
      this._lastColors = currentColors;

      // Auto-capture after ~1.2 seconds of stability (about 72 frames at 60fps)
      const STABLE_THRESHOLD = 72;

      // Draw stability progress ring around center
      if (this._stableFrames > 10 && centerMatches) {
        const progress = Math.min(this._stableFrames / STABLE_THRESHOLD, 1);
        const centerX = ox + cellSize * 1.5;
        const centerY = oy + cellSize * 1.5;
        const radius = cellSize * 0.45;

        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        this.ctx.strokeStyle = progress >= 1 ? '#4ade80' : 'rgba(233, 69, 96, 0.8)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
      }

      if (this._stableFrames >= STABLE_THRESHOLD) {
        this._stableFrames = 0;
        const result = this._doCapture();
        if (this.onAutoCapture) this.onAutoCapture(result);
      }
    }

    this._raf = requestAnimationFrame(() => this._drawLoop());
  }
}
