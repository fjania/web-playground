// Move definitions for a 3x3 Rubik's cube.
// Each CW move is a list of 4-cycles: [a, b, c, d] means a→b→c→d→a
// (the value at position a moves to position b, etc.)
// Each element is [face, index] where face ∈ {U,R,F,D,L,B} and index ∈ 0..8.
//
// Facelet layout per face (looking at it from outside):
//   0 1 2
//   3 4 5
//   6 7 8
//
// Standard color scheme: U=White, D=Yellow, F=Green, B=Blue, R=Red, L=Orange

export const CW_MOVES = {
  U: [
    // Face rotation (standard visual CW looking at U from above)
    [['U',0],['U',2],['U',8],['U',6]],
    [['U',1],['U',5],['U',7],['U',3]],
    // Adjacent: CW from above sends F→L→B→R→F
    [['F',0],['L',0],['B',0],['R',0]],
    [['F',1],['L',1],['B',1],['R',1]],
    [['L',2],['B',2],['R',2],['F',2]],
  ],

  D: [
    // Face rotation (standard visual CW looking at D from below)
    [['D',0],['D',2],['D',8],['D',6]],
    [['D',1],['D',5],['D',7],['D',3]],
    // Adjacent: CW from below sends F→R→B→L→F
    [['F',6],['R',6],['B',6],['L',6]],
    [['F',7],['R',7],['B',7],['L',7]],
    [['L',8],['F',8],['R',8],['B',8]],
  ],

  R: [
    [['R',0],['R',2],['R',8],['R',6]],
    [['R',1],['R',5],['R',7],['R',3]],
    [['F',2],['U',2],['B',6],['D',2]],
    [['F',5],['U',5],['B',3],['D',5]],
    [['F',8],['U',8],['B',0],['D',8]],
  ],

  L: [
    [['L',0],['L',2],['L',8],['L',6]],
    [['L',1],['L',5],['L',7],['L',3]],
    [['U',0],['F',0],['D',0],['B',8]],
    [['U',3],['F',3],['D',3],['B',5]],
    [['B',2],['U',6],['F',6],['D',6]],
  ],

  F: [
    [['F',0],['F',2],['F',8],['F',6]],
    [['F',1],['F',5],['F',7],['F',3]],
    [['U',6],['R',0],['D',2],['L',8]],
    [['U',7],['R',3],['D',1],['L',5]],
    [['L',2],['U',8],['R',6],['D',0]],
  ],

  B: [
    [['B',0],['B',2],['B',8],['B',6]],
    [['B',1],['B',5],['B',7],['B',3]],
    [['R',2],['U',0],['L',6],['D',8]],
    [['U',1],['L',3],['D',7],['R',5]],
    [['U',2],['L',0],['D',6],['R',8]],
  ],
};

// Derive CCW (prime) moves by reversing each cycle
function reverseCycle(cycle) {
  const [a, b, c, d] = cycle;
  return [a, d, c, b];
}

// Derive double moves by converting 4-cycles to pairs of 2-swaps
function doubleCycle(cycle) {
  const [a, b, c, d] = cycle;
  return [[a, c], [b, d]]; // two 2-cycles
}

export const CCW_MOVES = {};
export const DOUBLE_MOVES = {};

for (const [face, cycles] of Object.entries(CW_MOVES)) {
  CCW_MOVES[face] = cycles.map(reverseCycle);
  DOUBLE_MOVES[face] = cycles.map(doubleCycle);
}

// All 18 moves: R, R', R2, L, L', L2, ...
export const FACES = ['U', 'D', 'R', 'L', 'F', 'B'];

// Parse a move string like "R", "R'", "R2" into { face, type }
export function parseMove(str) {
  const face = str[0];
  if (str.length === 1) return { face, type: 'cw' };
  if (str[1] === "'") return { face, type: 'ccw' };
  if (str[1] === '2') return { face, type: 'double' };
  return null;
}

// Parse a sequence like "R U R' U'" into array of move objects
export function parseMoveSequence(seq) {
  return seq.trim().split(/\s+/).map(parseMove).filter(Boolean);
}

// Rotation axis and direction for each face move (used by the 3D renderer)
// axis: 'x' | 'y' | 'z', sign: +1 or -1 for CW rotation
export const MOVE_ROTATIONS = {
  R: { axis: 'x', layer:  1, sign: -1 },
  L: { axis: 'x', layer: -1, sign:  1 },
  U: { axis: 'y', layer:  1, sign: -1 },
  D: { axis: 'y', layer: -1, sign:  1 },
  F: { axis: 'z', layer:  1, sign: -1 },
  B: { axis: 'z', layer: -1, sign:  1 },
};
