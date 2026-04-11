import { COLORS } from './cube-state.js';
import { STEP_ALGORITHMS, STEP_IDS } from './algorithms.js';

// The beginner layer-by-layer method has 6 steps.
// Each step has a goal test (is this step complete?) and hint generation.

const STEPS = [
  {
    id: 'white-cross',
    name: 'White Cross',
    description: 'Form a white cross on the bottom face with edge colors matching the side centers.',
    goalTest: whiteCrossComplete,
    hints: {
      1: 'Find a white edge piece. Look at which face it\'s on and which other color it has. Move it to the top (yellow) face to form a "daisy" — white edges around the yellow center. Then align each white edge so its side color matches the center below it, and do <strong>F2</strong> (or the equivalent for that face) to drop it into place.',
      2: 'Look for white edge pieces. Get them to the top face as a daisy, then align and insert each one.',
      3: 'Get all 4 white edges into a cross with matching side colors.',
    },
  },
  {
    id: 'white-corners',
    name: 'White Corners',
    description: 'Place all 4 white corners to complete the first layer.',
    goalTest: whiteCornersComplete,
    hints: {
      1: 'Find a white corner in the top layer. Position it above where it needs to go (match the two side colors to their centers). Then use <strong>R U R\'</strong> (or the left-side mirror) repeatedly until it drops into place with white facing down.',
      2: 'Find white corners in the top layer. Position above the target slot and use corner insertions.',
      3: 'Complete all 4 white corners to finish the first layer.',
    },
  },
  {
    id: 'middle-layer',
    name: 'Middle Layer',
    description: 'Insert the 4 middle-layer edge pieces without disturbing the white face.',
    goalTest: middleLayerComplete,
    hints: {
      1: 'Find a top-layer edge that does NOT have yellow. Rotate U until that edge\'s front color matches the center below it. If the other color matches the right center, use: <strong>U R U\' R\' U\' F\' U F</strong>. If it matches the left center, use the mirror: <strong>U\' L\' U L U F U\' F\'</strong>.',
      2: 'Find non-yellow edges in the top layer. Align the front color with its center, then use the right or left insertion algorithm.',
      3: 'Insert all 4 middle-layer edges.',
    },
  },
  {
    id: 'yellow-cross',
    name: 'Yellow Cross',
    description: 'Form a yellow cross on the top face (edges only, ignore corners).',
    goalTest: yellowCrossComplete,
    hints: {
      1: 'Look at the yellow face. You\'ll see a dot, an L-shape, or a line of yellow edges. Apply <strong>F R U R\' U\' F\'</strong> to advance: dot→L, L→line, line→cross. For the L, hold it at top-left. For the line, hold it horizontal.',
      2: 'Use <strong>F R U R\' U\' F\'</strong> repeatedly. Orient the L at top-left or line horizontally before applying.',
      3: 'Get yellow edges into a cross pattern on top.',
    },
  },
  {
    id: 'yellow-edges',
    name: 'Yellow Edges',
    description: 'Position the yellow cross edges so they match the side centers.',
    goalTest: yellowEdgesComplete,
    hints: {
      1: 'Rotate U to get as many edges matching as possible. If 2 adjacent edges match, hold them at the back and left, then use <strong>R U R\' U R U2 R\' U</strong>. If 2 opposite edges match, apply the algorithm once to get adjacent matches, then repeat.',
      2: 'Rotate U to match edges, then use <strong>R U R\' U R U2 R\' U</strong> with matching edges at back-left.',
      3: 'Match all yellow cross edges with their side centers.',
    },
  },
  {
    id: 'yellow-corners',
    name: 'Yellow Corners',
    description: 'Position and orient all yellow corners to solve the cube.',
    goalTest: yellowCornersComplete,
    hints: {
      1: 'First, position corners: find a corner in the correct position (colors match, even if twisted). Hold it at front-right and use <strong>U R U\' L\' U R\' U\' L</strong> until all corners are in the right spots. Then orient: hold an unsolved corner at front-right and repeat <strong>R\' D\' R D</strong> until it\'s solved. Rotate U (don\'t move the cube!) to bring the next unsolved corner to front-right.',
      2: 'Position corners with <strong>U R U\' L\' U R\' U\' L</strong>, then orient each with <strong>R\' D\' R D</strong> (repeat per corner, rotate U between).',
      3: 'Position all corners, then twist each into place.',
    },
  },
];

// ---- Goal Tests ----
// All tests examine the state object { U:[9], R:[9], F:[9], D:[9], L:[9], B:[9] }
// We solve with white on BOTTOM (D face), yellow on top (U face).
// But state starts with W on U. For teaching, we flip: the user should put white on bottom.
// Actually, standard beginner method: white cross on bottom = D face = color Y on U.
// Wait — our state has standard orientation: U=W, D=Y.
// Beginner method typically starts by solving the white cross on the D face.
// So "white cross complete" means D face has a white cross and edges match side centers at their bottom row.

function whiteCrossComplete(s) {
  // D face edge positions: D[1], D[3], D[5], D[7] should be W
  if (s.D[1] !== 'W' || s.D[3] !== 'W' || s.D[5] !== 'W' || s.D[7] !== 'W') return false;
  // The adjacent edges should match their face center
  // D[1] adj = F[7] should = F center = F[4]
  // D[3] adj = L[7] should = L center = L[4]
  // D[5] adj = R[7] should = R center = R[4]
  // D[7] adj = B[7] should = B center = B[4]
  if (s.F[7] !== s.F[4]) return false;
  if (s.L[7] !== s.L[4]) return false;
  if (s.R[7] !== s.R[4]) return false;
  if (s.B[7] !== s.B[4]) return false;
  return true;
}

function whiteCornersComplete(s) {
  // White cross must still be done
  if (!whiteCrossComplete(s)) return false;
  // D face corners should be W
  if (s.D[0] !== 'W' || s.D[2] !== 'W' || s.D[6] !== 'W' || s.D[8] !== 'W') return false;
  // Adjacent corner facelets should match their face center
  // DFL: F[6]=F[4], L[8]=L[4]
  if (s.F[6] !== s.F[4] || s.L[8] !== s.L[4]) return false;
  // DFR: F[8]=F[4], R[6]=R[4]
  if (s.F[8] !== s.F[4] || s.R[6] !== s.R[4]) return false;
  // DBL: B[8]=B[4], L[6]=L[4]
  if (s.B[8] !== s.B[4] || s.L[6] !== s.L[4]) return false;
  // DBR: B[6]=B[4], R[8]=R[4]
  if (s.B[6] !== s.B[4] || s.R[8] !== s.R[4]) return false;
  return true;
}

function middleLayerComplete(s) {
  if (!whiteCornersComplete(s)) return false;
  // Middle layer edges: F[3]=F[4], F[5]=F[4], etc.
  // FL: F[3]=F[4], L[5]=L[4]
  if (s.F[3] !== s.F[4] || s.L[5] !== s.L[4]) return false;
  // FR: F[5]=F[4], R[3]=R[4]
  if (s.F[5] !== s.F[4] || s.R[3] !== s.R[4]) return false;
  // BL: B[5]=B[4], L[3]=L[4]
  if (s.B[5] !== s.B[4] || s.L[3] !== s.L[4]) return false;
  // BR: B[3]=B[4], R[5]=R[4]
  if (s.B[3] !== s.B[4] || s.R[5] !== s.R[4]) return false;
  return true;
}

function yellowCrossComplete(s) {
  if (!middleLayerComplete(s)) return false;
  // U face edges should be Y (yellow)
  return s.U[1] === 'Y' && s.U[3] === 'Y' && s.U[5] === 'Y' && s.U[7] === 'Y';
}

function yellowEdgesComplete(s) {
  if (!yellowCrossComplete(s)) return false;
  // Each U-face edge's adjacent side should match that side's center
  if (s.F[1] !== s.F[4]) return false;
  if (s.R[1] !== s.R[4]) return false;
  if (s.B[1] !== s.B[4]) return false;
  if (s.L[1] !== s.L[4]) return false;
  return true;
}

function yellowCornersComplete(s) {
  // Cube should be fully solved if all prior steps + corners are done
  if (!yellowEdgesComplete(s)) return false;
  // U face all Y
  for (let i = 0; i < 9; i++) {
    if (s.U[i] !== 'Y') return false;
  }
  // Check all side faces are uniform
  for (const face of ['F', 'R', 'B', 'L']) {
    for (let i = 0; i < 9; i++) {
      if (s[face][i] !== s[face][4]) return false;
    }
  }
  return true;
}

// ---- Teaching Engine ----

export class TeachingEngine {
  constructor() {
    this.currentStep = 0;
    this.hintTier = 1; // 1=full, 2=partial, 3=minimal
  }

  getSteps() {
    return STEPS;
  }

  getCurrentStep() {
    return STEPS[this.currentStep];
  }

  setStep(idx) {
    this.currentStep = Math.max(0, Math.min(idx, STEPS.length - 1));
  }

  setHintTier(tier) {
    this.hintTier = tier;
  }

  // Check which steps are complete for the given state
  getStepStatuses(state) {
    return STEPS.map((step, i) => ({
      ...step,
      index: i,
      completed: step.goalTest(state),
    }));
  }

  // Auto-advance to the first incomplete step
  autoAdvance(state) {
    for (let i = 0; i < STEPS.length; i++) {
      if (!STEPS[i].goalTest(state)) {
        this.currentStep = i;
        return i;
      }
    }
    this.currentStep = STEPS.length - 1;
    return STEPS.length - 1;
  }

  // Get hint HTML for the current step and tier
  getHint(state) {
    const step = STEPS[this.currentStep];
    if (!step) return '';

    if (step.goalTest(state)) {
      return '<strong>Step complete!</strong> Move to the next step.';
    }

    return step.hints[this.hintTier] || step.hints[3] || step.description;
  }

  // Get the algorithms relevant to the current step
  getAlgorithms() {
    const step = STEPS[this.currentStep];
    if (!step) return [];
    return STEP_ALGORITHMS[step.id] || [];
  }
}
