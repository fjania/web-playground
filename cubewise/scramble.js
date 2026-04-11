import { FACES } from './cube-moves.js';

const DIFFICULTY = {
  easy: { min: 6, max: 10 },
  medium: { min: 12, max: 18 },
  hard: { min: 20, max: 25 },
};

const TYPES = ['cw', 'ccw', 'double'];

// Opposite faces — avoid consecutive moves on parallel faces (WCA rule)
const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

export function generateScramble(difficulty = 'hard') {
  const { min, max } = DIFFICULTY[difficulty] || DIFFICULTY.hard;
  const length = min + Math.floor(Math.random() * (max - min + 1));

  const moves = [];
  let lastFace = null;
  let secondLastFace = null;

  for (let i = 0; i < length; i++) {
    let face;
    do {
      face = FACES[Math.floor(Math.random() * FACES.length)];
    } while (
      face === lastFace ||
      (face === secondLastFace && OPPOSITE[face] === lastFace)
    );

    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    moves.push({ face, type });

    secondLastFace = lastFace;
    lastFace = face;
  }

  return moves;
}

export function scrambleToString(moves) {
  return moves.map(m => {
    if (m.type === 'cw') return m.face;
    if (m.type === 'ccw') return m.face + "'";
    return m.face + '2';
  }).join(' ');
}
