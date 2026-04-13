import { createSolvedState, cloneState, applyMove, isSolved, inverseMove, moveToString, FACE_NAMES, COLORS, validateColorCounts } from './cube-state.js';
import { CubeRenderer } from './cube-renderer.js';
import { CubeAnimator } from './cube-animator.js';
import { CubeInteraction } from './cube-interaction.js';
import { parseMove, parseMoveSequence, FACES } from './cube-moves.js';
import { generateScramble, scrambleToString } from './scramble.js';
import { TeachingEngine } from './teaching-engine.js';
import { initSolver, solve, isSolverReady } from './solver.js';
import { Timer } from './timer.js';
import { Scanner } from './scanner.js';
import { ColorPicker } from './color-picker.js';

// ---- State ----
let state = createSolvedState();
let moveHistory = [];
let redoStack = [];
let mode = 'virtual'; // 'virtual' | 'augmented'

// ---- Renderer + Animator ----
const container = document.getElementById('cube-canvas');
const renderer = new CubeRenderer(container);
const animator = new CubeAnimator(renderer);

renderer.updateFromState(state);

// ---- Teaching Engine ----
const teacher = new TeachingEngine();

// ---- Timer ----
const timer = new Timer(document.getElementById('timer'));
let timerStarted = false;

// ---- Scanner + Color Picker ----
const scanner = new Scanner();
const colorPicker = new ColorPicker(
  document.getElementById('color-picker'),
  scanner
);

// ---- Click/drag interaction ----
const interaction = new CubeInteraction(renderer, (move) => {
  execMove(move);
});

// ---- Solver init (background) ----
initSolver().then(() => {
  document.getElementById('status-badge').textContent = 'Ready';
});

// ---- Core: execute a move ----
function execMove(move, { record = true, animate = true } = {}) {
  if (animate && animator.isAnimating) return;

  // Auto-start timer on first move after scramble
  if (record && !timerStarted && !isSolved(state)) {
    timer.start();
    timerStarted = true;
  }

  if (record) {
    moveHistory.push(move);
    redoStack = [];
  }

  applyMove(state, move);

  if (animate) {
    animator.enqueue(move, () => {
      renderer.updateFromState(state);
      updateUI();
      checkSolved();
    });
  } else {
    renderer.updateFromState(state);
    updateUI();
    checkSolved();
  }
}

function checkSolved() {
  if (isSolved(state) && timerStarted) {
    const time = timer.stop();
    timer.recordSolve();
    timerStarted = false;
    updateTimerStats();
  }
}

function undo() {
  if (moveHistory.length === 0 || animator.isAnimating) return;
  const last = moveHistory.pop();
  const inv = inverseMove(last);
  redoStack.push(last);
  applyMove(state, inv);
  animator.enqueue(inv, () => {
    renderer.updateFromState(state);
    updateUI();
  });
}

function redo() {
  if (redoStack.length === 0 || animator.isAnimating) return;
  const move = redoStack.pop();
  moveHistory.push(move);
  applyMove(state, move);
  animator.enqueue(move, () => {
    renderer.updateFromState(state);
    updateUI();
  });
}

// ---- Scramble ----
function scramble(difficulty = 'hard') {
  state = createSolvedState();
  moveHistory = [];
  redoStack = [];
  timer.reset();
  timerStarted = false;

  const moves = generateScramble(difficulty);

  for (const move of moves) {
    applyMove(state, move);
  }

  renderer.updateFromState(state);
  teacher.autoAdvance(state);
  updateUI();
}

function resetCube() {
  state = createSolvedState();
  moveHistory = [];
  redoStack = [];
  timer.reset();
  timerStarted = false;
  renderer.updateFromState(state);
  teacher.setStep(0);
  updateUI();
}

// ---- Solve (play solution) ----
function solveAnimated() {
  if (!isSolverReady() || animator.isAnimating) return;
  try {
    const solution = solve(state);
    if (solution.length === 0) return;
    redoStack = [];

    for (const move of solution) {
      animator.enqueue(move, () => {
        moveHistory.push(move);
        applyMove(state, move);
        renderer.updateFromState(state);
        updateUI();
        checkSolved();
      });
    }
  } catch (e) {
    console.error('Solve failed:', e);
  }
}

// ---- Mode switching ----
function setMode(newMode) {
  mode = newMode;
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  const augView = document.getElementById('augmented-view');
  const cubeCanvas = document.getElementById('cube-canvas');

  if (mode === 'augmented') {
    augView.style.display = 'flex';
    cubeCanvas.style.display = 'none';
    startScanning();
  } else {
    augView.style.display = 'none';
    cubeCanvas.style.display = 'block';
    scanner.stop();
  }
}

// ---- Augmented mode: scanning ----
const FACE_TO_CSS = { F:'cd-front', R:'cd-right', B:'cd-back', L:'cd-left', U:'cd-top', D:'cd-bottom' };
const FACE_LABEL = { F:'Front', R:'Right', B:'Back', L:'Left', U:'Top', D:'Bottom' };

async function startScanning() {
  const ok = await scanner.start(
    document.getElementById('scan-video'),
    document.getElementById('scan-canvas')
  );
  if (!ok) {
    document.getElementById('scan-hint').innerHTML = '<strong>Camera access denied.</strong><br>Please allow camera access and try again.';
    return;
  }
  updateScanUI();
}

function renderCubeDiagram(activeFace, arrow) {
  const el = document.getElementById('cube-diagram');
  const faces = ['F','R','B','L','U','D'];
  const cssMap = { F:'cd-front', R:'cd-right', B:'cd-back', L:'cd-left', U:'cd-top', D:'cd-bottom' };

  let html = '<div class="cd-cube">';
  for (const f of faces) {
    const active = f === activeFace ? ' cd-active' : '';
    const label = f === activeFace ? FACE_LABEL[f] : '';
    html += `<div class="cd-face ${cssMap[f]}${active}">${label}</div>`;
  }
  html += '</div>';

  // Arrow showing rotation direction
  if (arrow) {
    const arrowPositions = {
      '→': 'right: -5px; top: 50%; transform: translateY(-50%);',
      '↑': 'top: -5px; left: 50%; transform: translateX(-50%);',
      '↓': 'bottom: -5px; left: 50%; transform: translateX(-50%);',
    };
    html += `<div class="cd-arrow" style="${arrowPositions[arrow] || ''}">${arrow}</div>`;
  }

  el.innerHTML = html;
}

function updateScanUI() {
  const step = scanner.getCurrentStep();
  const stepLabel = document.getElementById('scan-step-label');
  const hintLabel = document.getElementById('scan-hint');

  if (!step) {
    stepLabel.textContent = 'All faces scanned!';
    hintLabel.innerHTML = 'Review below. <strong>Click a face</strong> to correct colors, then press <strong>Done</strong>.';
    document.getElementById('btn-capture').textContent = 'Done';
    renderCubeDiagram(null, null);
  } else {
    const n = scanner.scanStep + 1;
    stepLabel.textContent = `Scan face ${n} of 6`;

    const colorWord = scanner.getScanOrder()[scanner.scanStep].color;
    const emoji = scanner.getScanOrder()[scanner.scanStep].emoji;

    if (scanner.scanStep === 0) {
      hintLabel.innerHTML = `Hold cube with the <strong>${emoji} ${colorWord}</strong> center facing the camera.<br><span style="font-size:0.75rem;color:var(--text-muted)">Keep white on top. Hold steady to auto-capture.</span>`;
    } else {
      const arrow = scanner.getScanOrder()[scanner.scanStep].arrow;
      const dir = arrow === '→' ? 'Rotate the cube right' : arrow === '↑' ? 'Tilt the cube back' : 'Tilt the cube forward';
      hintLabel.innerHTML = `${dir} to show the <strong>${emoji} ${colorWord}</strong> center.<br><span style="font-size:0.75rem;color:var(--text-muted)">Hold steady to auto-capture, or press Space.</span>`;
    }

    document.getElementById('btn-capture').textContent = 'Capture (Space)';
    renderCubeDiagram(step.face, scanner.getScanOrder()[scanner.scanStep].arrow);
  }

  updateScanPreview();
}

function updateScanPreview() {
  const preview = document.getElementById('scan-preview');
  const COLOR_HEX = { W:'#fff', Y:'#ffd500', G:'#009b48', B:'#0045ad', R:'#b90000', O:'#ff5900' };

  let html = '';
  for (const face of FACE_NAMES) {
    const colors = scanner.getFaceColors(face);
    const scanned = colors ? ' scanned' : '';
    html += `<div class="scan-face-mini${scanned}" data-face="${face}" title="${face} face">`;
    for (let i = 0; i < 9; i++) {
      const c = colors ? colors[i] : COLORS[face];
      html += `<div class="sf-cell" style="background:${COLOR_HEX[c]}"></div>`;
    }
    html += '</div>';
  }
  preview.innerHTML = html;

  for (const el of preview.querySelectorAll('.scan-face-mini.scanned')) {
    el.addEventListener('click', () => {
      colorPicker.show(el.dataset.face);
    });
  }
}

function captureOrFinish() {
  const step = scanner.getCurrentStep();
  if (!step) {
    finalizeScan();
    return;
  }
  const result = scanner.capture();
  updateScanUI();

  if (result && result.state) {
    finalizeScan();
  } else if (result && result.error) {
    document.getElementById('scan-hint').innerHTML = `<span style="color:var(--accent)">${result.error}</span>`;
  }
}

function finalizeScan() {
  // Build state from scanned faces
  const scannedState = {};
  let valid = true;
  for (const face of FACE_NAMES) {
    const colors = scanner.getFaceColors(face);
    if (!colors) { valid = false; break; }
    scannedState[face] = [...colors];
  }

  if (!valid) {
    document.getElementById('scan-hint').textContent = 'Not all faces scanned yet.';
    return;
  }

  if (!validateColorCounts(scannedState)) {
    document.getElementById('scan-hint').textContent = 'Invalid colors — each color must appear exactly 9 times. Click faces below to correct.';
    return;
  }

  // Apply scanned state
  state = scannedState;
  moveHistory = [];
  redoStack = [];
  timer.reset();
  timerStarted = false;
  renderer.updateFromState(state);
  teacher.autoAdvance(state);

  // Switch back to virtual mode to show the scanned cube
  scanner.stop();
  setMode('virtual');
  updateUI();
}

// ---- UI Updates ----
const statusBadge = document.getElementById('status-badge');
const instructionsEl = document.getElementById('instructions');
const stepItems = document.querySelectorAll('.step-item');

function updateUI() {
  // Status badge
  if (isSolved(state)) {
    statusBadge.textContent = 'Solved!';
    statusBadge.classList.add('solved');
  } else {
    statusBadge.textContent = `${moveHistory.length} moves`;
    statusBadge.classList.remove('solved');
  }

  // Step statuses
  const statuses = teacher.getStepStatuses(state);
  stepItems.forEach((el, i) => {
    el.classList.toggle('completed', statuses[i].completed);
    el.classList.toggle('active', i === teacher.currentStep);
  });

  // Instructions
  const hint = teacher.getHint(state);
  const algos = teacher.getAlgorithms();

  let html = `<p>${hint}</p>`;
  if (algos.length > 0) {
    html += '<div style="margin-top:0.75rem">';
    for (const algo of algos) {
      html += `<div style="margin-bottom:0.5rem;">
        <strong style="font-size:0.8rem">${algo.name}</strong>
        <code style="display:block;font-family:var(--font-mono);font-size:0.75rem;color:var(--accent);margin-top:0.15rem;cursor:pointer" class="algo-demo" data-moves="${algo.moves}">${algo.moves}</code>
        <span style="font-size:0.72rem;color:var(--text-muted)">${algo.description}</span>
      </div>`;
    }
    html += '</div>';
  }
  instructionsEl.innerHTML = html;

  // Wire algorithm demo clicks
  for (const el of instructionsEl.querySelectorAll('.algo-demo')) {
    el.addEventListener('click', () => {
      const moves = parseMoveSequence(el.dataset.moves);
      for (const move of moves) {
        execMove(move, { record: true, animate: true });
      }
    });
  }
}

function updateTimerStats() {
  const statsEl = document.getElementById('timer-stats');
  const stats = timer.getStats();
  if (!stats) { statsEl.textContent = ''; return; }

  let html = `<span class="pb">PB ${Timer.format(stats.pb)}</span>`;
  if (stats.ao5) html += `<span>ao5 ${Timer.format(stats.ao5)}</span>`;
  if (stats.ao12) html += `<span>ao12 ${Timer.format(stats.ao12)}</span>`;
  html += `<span>${stats.count} solves</span>`;
  statsEl.innerHTML = html;
}

// ---- Keyboard shortcuts ----
const KEY_MAP = {
  j: 'R', f: 'L', i: 'U', k: 'D', h: 'F', g: 'B',
};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Spacebar in augmented mode = capture
  if (e.key === ' ' && mode === 'augmented') {
    e.preventDefault();
    captureOrFinish();
    return;
  }

  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    toggleNotation();
    return;
  }

  if (e.key === 'Escape') {
    document.getElementById('notation-overlay').classList.remove('visible');
    colorPicker.hide();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }

  const face = KEY_MAP[e.key.toLowerCase()];
  if (!face) return;

  e.preventDefault();
  const type = e.shiftKey ? 'ccw' : 'cw';
  execMove({ face, type });
});

// ---- Button controls ----
for (const btn of document.querySelectorAll('.btn-move')) {
  btn.addEventListener('click', () => {
    execMove({ face: btn.dataset.move, type: 'cw' });
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    execMove({ face: btn.dataset.move, type: 'ccw' });
  });
}

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);
document.getElementById('btn-scramble').addEventListener('click', () => scramble());
document.getElementById('btn-solve').addEventListener('click', solveAnimated);
document.getElementById('btn-reset').addEventListener('click', resetCube);

// Tempo
document.getElementById('tempo-select').addEventListener('change', (e) => {
  animator.setTempo(e.target.value);
});

// Step clicks
stepItems.forEach((el, i) => {
  el.addEventListener('click', () => {
    teacher.setStep(i);
    updateUI();
  });
});

// Hint tier buttons
for (const btn of document.querySelectorAll('.hint-tier-btn')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.hint-tier-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    teacher.setHintTier(parseInt(btn.dataset.tier));
    updateUI();
  });
}

// Mode tabs
for (const tab of document.querySelectorAll('.mode-tab')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

// Scanner controls
document.getElementById('btn-capture').addEventListener('click', captureOrFinish);
document.getElementById('btn-scan-cancel').addEventListener('click', () => {
  scanner.stop();
  setMode('virtual');
});

scanner.onStepChange = () => updateScanUI();
scanner.onAutoCapture = (result) => {
  updateScanUI();
  if (result && result.state) {
    finalizeScan();
  } else if (result && result.error) {
    document.getElementById('scan-hint').innerHTML = `<span style="color:var(--accent)">${result.error}</span>`;
  }
};
colorPicker.onUpdate = () => updateScanPreview();

// Notation guide
function toggleNotation() {
  document.getElementById('notation-overlay').classList.toggle('visible');
}

document.getElementById('btn-notation').addEventListener('click', toggleNotation);
document.getElementById('notation-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) toggleNotation();
});

// Initial UI
updateUI();
