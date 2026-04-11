import { CW_MOVES, CCW_MOVES, DOUBLE_MOVES } from './cube-moves.js';

// Standard color scheme
export const COLORS = {
  U: 'W', // White
  D: 'Y', // Yellow
  F: 'G', // Green
  B: 'B', // Blue
  R: 'R', // Red
  L: 'O', // Orange
};

export const FACE_NAMES = ['U', 'R', 'F', 'D', 'L', 'B'];

export function createSolvedState() {
  const state = {};
  for (const face of FACE_NAMES) {
    state[face] = Array(9).fill(COLORS[face]);
  }
  return state;
}

export function cloneState(state) {
  const copy = {};
  for (const face of FACE_NAMES) {
    copy[face] = [...state[face]];
  }
  return copy;
}

// Apply a 4-cycle: a→b→c→d→a
function applyCycle(state, cycle) {
  const [a, b, c, d] = cycle;
  const temp = state[d[0]][d[1]];
  state[d[0]][d[1]] = state[c[0]][c[1]];
  state[c[0]][c[1]] = state[b[0]][b[1]];
  state[b[0]][b[1]] = state[a[0]][a[1]];
  state[a[0]][a[1]] = temp;
}

// Apply a 2-swap
function applySwap(state, pair) {
  const [a, b] = pair;
  const temp = state[a[0]][a[1]];
  state[a[0]][a[1]] = state[b[0]][b[1]];
  state[b[0]][b[1]] = temp;
}

// Apply a single move (mutates state)
// move: { face: 'R', type: 'cw' | 'ccw' | 'double' }
export function applyMove(state, move) {
  const { face, type } = move;

  if (type === 'cw') {
    for (const cycle of CW_MOVES[face]) {
      applyCycle(state, cycle);
    }
  } else if (type === 'ccw') {
    for (const cycle of CCW_MOVES[face]) {
      applyCycle(state, cycle);
    }
  } else if (type === 'double') {
    for (const pairs of DOUBLE_MOVES[face]) {
      for (const pair of pairs) {
        applySwap(state, pair);
      }
    }
  }

  return state;
}

// Apply a sequence of moves
export function applyMoves(state, moves) {
  for (const move of moves) {
    applyMove(state, move);
  }
  return state;
}

// Check if cube is solved
export function isSolved(state) {
  for (const face of FACE_NAMES) {
    const color = state[face][0];
    for (let i = 1; i < 9; i++) {
      if (state[face][i] !== color) return false;
    }
  }
  return true;
}

// Get the inverse of a move
export function inverseMove(move) {
  if (move.type === 'cw') return { face: move.face, type: 'ccw' };
  if (move.type === 'ccw') return { face: move.face, type: 'cw' };
  return { ...move }; // double is its own inverse
}

// Convert move to notation string
export function moveToString(move) {
  if (move.type === 'cw') return move.face;
  if (move.type === 'ccw') return move.face + "'";
  return move.face + '2';
}

// Convert state to the 54-char facelet string for cubejs (URFDLB order)
export function stateToFaceletString(state) {
  const CUBEJS_FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
  const COLOR_TO_FACE = {};
  for (const face of FACE_NAMES) {
    COLOR_TO_FACE[COLORS[face]] = face;
  }
  let result = '';
  for (const face of CUBEJS_FACE_ORDER) {
    for (let i = 0; i < 9; i++) {
      result += COLOR_TO_FACE[state[face][i]];
    }
  }
  return result;
}

// Validate that a state has the correct number of each color
export function validateColorCounts(state) {
  const counts = {};
  for (const face of FACE_NAMES) {
    for (const color of state[face]) {
      counts[color] = (counts[color] || 0) + 1;
    }
  }
  for (const face of FACE_NAMES) {
    if ((counts[COLORS[face]] || 0) !== 9) return false;
  }
  return true;
}
