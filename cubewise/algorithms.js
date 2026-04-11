// Catalog of beginner-method algorithms with names, notation, and descriptions.
// Grouped by the solving step they belong to.

export const ALGORITHMS = [
  // ---- Basic triggers ----
  {
    id: 'right-trigger',
    name: 'Right Trigger',
    moves: "R U R' U'",
    category: 'basic',
    description: 'The most fundamental algorithm. Used in nearly every step.',
  },
  {
    id: 'left-trigger',
    name: 'Left Trigger',
    moves: "L' U' L U",
    category: 'basic',
    description: 'Mirror of the right trigger for left-side insertions.',
  },

  // ---- White Cross (Step 1) ----
  {
    id: 'daisy-insert',
    name: 'Daisy Insert',
    moves: "F2",
    category: 'white-cross',
    description: 'Move a white edge from the daisy (top) to the white cross (bottom).',
  },

  // ---- White Corners (Step 2) ----
  {
    id: 'corner-insert-right',
    name: 'Corner Insert (Right)',
    moves: "R U R'",
    category: 'white-corners',
    description: 'Insert a white corner from the top layer into the bottom-right slot.',
  },
  {
    id: 'corner-insert-left',
    name: 'Corner Insert (Left)',
    moves: "L' U' L",
    category: 'white-corners',
    description: 'Insert a white corner from the top layer into the bottom-left slot.',
  },
  {
    id: 'corner-cycle',
    name: 'Corner Cycle',
    moves: "R U R' U'",
    category: 'white-corners',
    description: 'Cycle a misoriented corner out and reinsert it. Repeat until correct.',
  },

  // ---- Middle Layer (Step 3) ----
  {
    id: 'edge-insert-right',
    name: 'Edge Insert Right',
    moves: "U R U' R' U' F' U F",
    category: 'middle-layer',
    description: 'Insert a top-layer edge into the right middle-layer slot.',
  },
  {
    id: 'edge-insert-left',
    name: 'Edge Insert Left',
    moves: "U' L' U L U F U' F'",
    category: 'middle-layer',
    description: 'Insert a top-layer edge into the left middle-layer slot.',
  },

  // ---- Yellow Cross (Step 4) ----
  {
    id: 'yellow-cross',
    name: 'Yellow Cross',
    moves: "F R U R' U' F'",
    category: 'yellow-cross',
    description: 'Form the yellow cross. Apply from dot→L, L→line, or line→cross.',
  },

  // ---- Yellow Edges (Step 5) ----
  {
    id: 'yellow-edge-swap',
    name: 'Yellow Edge Swap',
    moves: "R U R' U R U2 R' U",
    category: 'yellow-edges',
    description: 'Cycle 3 yellow edges to match side centers. Hold solved edge at back.',
  },

  // ---- Yellow Corners (Step 6) ----
  {
    id: 'corner-position',
    name: 'Corner Position',
    moves: "U R U' L' U R' U' L",
    category: 'yellow-corners',
    description: 'Cycle 3 corners to their correct positions. Hold correct corner at front-right.',
  },
  {
    id: 'corner-orient',
    name: 'Corner Orient',
    moves: "R' D' R D",
    category: 'yellow-corners',
    description: 'Twist a corner in place. Repeat 2 or 4 times per corner, then rotate U to next.',
  },
];

export const STEP_ALGORITHMS = {
  'white-cross': ALGORITHMS.filter(a => a.category === 'white-cross' || a.category === 'basic'),
  'white-corners': ALGORITHMS.filter(a => a.category === 'white-corners'),
  'middle-layer': ALGORITHMS.filter(a => a.category === 'middle-layer'),
  'yellow-cross': ALGORITHMS.filter(a => a.category === 'yellow-cross'),
  'yellow-edges': ALGORITHMS.filter(a => a.category === 'yellow-edges'),
  'yellow-corners': ALGORITHMS.filter(a => a.category === 'yellow-corners'),
};

export const STEP_IDS = [
  'white-cross',
  'white-corners',
  'middle-layer',
  'yellow-cross',
  'yellow-edges',
  'yellow-corners',
];
