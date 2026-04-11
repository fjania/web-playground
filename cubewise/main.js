import { createSolvedState, cloneState, applyMove, isSolved, inverseMove, moveToString } from './cube-state.js';
import { CubeRenderer } from './cube-renderer.js';
import { CubeAnimator } from './cube-animator.js';
import { CubeInteraction } from './cube-interaction.js';
import { parseMove, parseMoveSequence, FACES } from './cube-moves.js';
import { generateScramble, scrambleToString } from './scramble.js';
import { TeachingEngine } from './teaching-engine.js';
import { initSolver, solve, isSolverReady } from './solver.js';

// ---- State ----
let state = createSolvedState();
let moveHistory = [];
let redoStack = [];

// ---- Renderer + Animator ----
const container = document.getElementById('cube-canvas');
const renderer = new CubeRenderer(container);
const animator = new CubeAnimator(renderer);

renderer.updateFromState(state);

// ---- Teaching Engine ----
const teacher = new TeachingEngine();

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

  if (record) {
    moveHistory.push(move);
    redoStack = [];
  }

  applyMove(state, move);

  if (animate) {
    animator.enqueue(move, () => {
      renderer.updateFromState(state);
      updateUI();
    });
  } else {
    renderer.updateFromState(state);
    updateUI();
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
      });
    }
  } catch (e) {
    console.error('Solve failed:', e);
  }
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
  const step = teacher.getCurrentStep();
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

// ---- Keyboard shortcuts ----
const KEY_MAP = {
  j: 'R', f: 'L', i: 'U', k: 'D', h: 'F', g: 'B',
};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    toggleNotation();
    return;
  }

  if (e.key === 'Escape') {
    document.getElementById('notation-overlay').classList.remove('visible');
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
