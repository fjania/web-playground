// Webcam face scanner for augmented mode.
// Captures 6 faces one at a time, classifies colors via HSL,
// and assembles a full cube state.

import { COLORS, FACE_NAMES, validateColorCounts } from './cube-state.js';

// Scanning order: the user holds the cube and shows each face
const SCAN_ORDER = [
  { face: 'F', label: 'Front (Green center)', hint: 'Hold the cube with the GREEN center facing the camera' },
  { face: 'R', label: 'Right (Red center)', hint: 'Rotate the cube RIGHT to show the RED center' },
  { face: 'B', label: 'Back (Blue center)', hint: 'Rotate RIGHT again to show the BLUE center' },
  { face: 'L', label: 'Left (Orange center)', hint: 'Rotate RIGHT again to show the ORANGE center' },
  { face: 'U', label: 'Top (White center)', hint: 'Tilt the cube to show the WHITE top face' },
  { face: 'D', label: 'Bottom (Yellow center)', hint: 'Tilt the cube to show the YELLOW bottom face' },
];

// Reference HSL values for each cube color (tuned for typical webcam lighting)
const COLOR_REFS = {
  W: { h: 0, s: 0, l: 85, name: 'White' },
  Y: { h: 50, s: 90, l: 60, name: 'Yellow' },
  G: { h: 140, s: 70, l: 40, name: 'Green' },
  B: { h: 220, s: 80, l: 45, name: 'Blue' },
  R: { h: 0, s: 85, l: 45, name: 'Red' },
  O: { h: 25, s: 95, l: 55, name: 'Orange' },
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

// Classify an HSL color to the nearest cube color
function classifyColor(hsl) {
  let bestColor = 'W';
  let bestDist = Infinity;

  for (const [color, ref] of Object.entries(COLOR_REFS)) {
    // Special handling for white (low saturation)
    if (color === 'W') {
      if (hsl.s < 20 && hsl.l > 60) {
        const dist = Math.abs(hsl.l - ref.l) + (20 - hsl.s);
        if (dist < bestDist) { bestDist = dist; bestColor = color; }
      }
      continue;
    }

    // Hue distance (circular)
    let hDist = Math.abs(hsl.h - ref.h);
    if (hDist > 180) hDist = 360 - hDist;

    // Weight hue heavily, saturation and lightness less
    const dist = hDist * 2 + Math.abs(hsl.s - ref.s) * 0.5 + Math.abs(hsl.l - ref.l) * 0.8;

    if (dist < bestDist) {
      bestDist = dist;
      bestColor = color;
    }
  }

  return bestColor;
}

// Sample a region of pixels and return median RGB
function sampleRegion(imageData, cx, cy, radius, width) {
  const rs = [], gs = [], bs = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= imageData.height) continue;
      const i = (y * width + x) * 4;
      rs.push(imageData.data[i]);
      gs.push(imageData.data[i + 1]);
      bs.push(imageData.data[i + 2]);
    }
  }
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return { r: rs[mid], g: gs[mid], b: bs[mid] };
}

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
  }

  async start(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.scanStep = 0;
    this.scannedFaces = {};

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
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

  // Capture the current frame and detect the 9 facelets
  capture() {
    const step = this.getCurrentStep();
    if (!step) return null;

    this.ctx.drawImage(this.video, 0, 0);
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Define the 3x3 grid in the center of the frame
    const gridSize = Math.min(w, h) * 0.55;
    const cellSize = gridSize / 3;
    const ox = (w - gridSize) / 2;
    const oy = (h - gridSize) / 2;
    const sampleRadius = Math.floor(cellSize * 0.15);

    const imageData = this.ctx.getImageData(0, 0, w, h);
    const colors = [];

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = Math.floor(ox + cellSize * (col + 0.5));
        const cy = Math.floor(oy + cellSize * (row + 0.5));
        const rgb = sampleRegion(imageData, cx, cy, sampleRadius, w);
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        colors.push(classifyColor(hsl));
      }
    }

    // Use center facelet (index 4) as calibration — it should match the expected face center
    const expectedCenter = COLORS[step.face];
    if (colors[4] !== expectedCenter) {
      // Auto-correct: if center doesn't match, flag it but still save
      colors[4] = expectedCenter;
    }

    this.scannedFaces[step.face] = colors;
    this.scanStep++;

    if (this.onStepChange) this.onStepChange(this.scanStep);

    if (this.scanStep >= SCAN_ORDER.length) {
      return this._buildState();
    }

    return null; // more faces to scan
  }

  // Manually set a facelet color (for correction)
  setFacelet(face, index, color) {
    if (this.scannedFaces[face]) {
      this.scannedFaces[face][index] = color;
    }
  }

  // Get the scanned colors for a face (for the color picker UI)
  getFaceColors(face) {
    return this.scannedFaces[face] || null;
  }

  _buildState() {
    const state = {};
    for (const face of FACE_NAMES) {
      state[face] = this.scannedFaces[face] || Array(9).fill(COLORS[face]);
    }

    if (!validateColorCounts(state)) {
      return { error: 'Invalid color counts — each color should appear exactly 9 times. Use the color picker to correct.' };
    }

    return { state };
  }

  _drawLoop() {
    if (!this.stream) return;
    this.ctx.drawImage(this.video, 0, 0);

    // Draw 3x3 grid overlay
    const w = this.canvas.width;
    const h = this.canvas.height;
    const gridSize = Math.min(w, h) * 0.55;
    const cellSize = gridSize / 3;
    const ox = (w - gridSize) / 2;
    const oy = (h - gridSize) / 2;

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
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

    // Draw crosshairs at each cell center
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = ox + cellSize * (col + 0.5);
        const cy = oy + cellSize * (row + 0.5);
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this._raf = requestAnimationFrame(() => this._drawLoop());
  }
}
