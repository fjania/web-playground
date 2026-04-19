// pipeline.js — pure, DOM-free pattern computation for end-grain cutting boards.
//
// The woodworking pipeline every pattern reduces to:
//   strips → crosscut → reassemble → (repeat) → final end-grain face
//
// This module computes the *data* of the final face — a cell grid, or a list
// of polygons — from the input strips and pattern rule. Rendering (SVG) is
// handled elsewhere. Everything here is pure and testable.

// Species palette curated for end-grain cutting boards.
//
// Notes for the maker (surfaced in the UI as info tooltips):
//   - Red oak is *not* in this list — its open ray pores hold water and
//     contaminants, which is unsafe for food prep.
//   - Padauk and purpleheart oxidise to brown/grey within months. The colors
//     here represent freshly milled stock; finished boards age darker.
//   - Wenge dust is a respiratory irritant — handle with care.
export const SPECIES = {
  maple:       { name: 'hard maple',  color: '#e4cc8f', note: '' },
  walnut:      { name: 'walnut',      color: '#3d2416', note: '' },
  cherry:      { name: 'cherry',      color: '#8a3a1f', note: 'darkens with age' },
  white_oak:   { name: 'white oak',   color: '#c2994d', note: '' },
  hickory:     { name: 'hickory',     color: '#b88b58', note: '' },
  ash:         { name: 'ash',         color: '#d4b487', note: '' },
  padauk:      { name: 'padauk',      color: '#a83817', note: 'oxidizes brown' },
  purpleheart: { name: 'purpleheart', color: '#4a2a5e', note: 'oxidizes grey' },
  wenge:       { name: 'wenge',       color: '#1f1610', note: 'irritant dust' },
};

// The supported patterns. Each one has a label describing its reassembly rule
// and a default crosscut angle — the minimum the user needs to specify.
export const PATTERNS = {
  checkerboard: { label: '1 cell',           defaultAngle: 0  },
  brick:        { label: '½ cell',           defaultAngle: 0  },
  chevron:      { label: 'mirror at center', defaultAngle: 45 },
};

// ---------- Small utilities ----------

export function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

export function mod(n, m) { return ((n % m) + m) % m; }

// ---------- Board dimensions ----------

// Given strips + crosscut params, return the *final* end-grain face dimensions.
// After one pass of glueup → crosscut → reassemble, the final top face has:
//   width  = sum of strip widths (the glue-up's width)
//   height = numSlices × sliceThickness (the glue-up's length chopped up)
export function boardDimensions(strips, numSlices, sliceThickness) {
  return {
    width: sum(strips.map(s => s.width)),
    height: numSlices * sliceThickness,
    totalStripWidth: sum(strips.map(s => s.width)),
    boardLength: numSlices * sliceThickness,
  };
}

// ---------- Pass-2 shift composition ----------

// When the user enables a second cut-and-reglue pass, we compose its shift
// onto the first pass. Pass 2 = "take the pass-1 result, crosscut it again,
// shift each new slice by N cells before regluing."
//
// The control exposes `cellShift` directly as an integer in [1..(N-1)] so
// the user always gets a non-degenerate pattern. (The previous angle-based
// mapping silently collapsed to vertical stripes when (shift+1) shared a
// factor with N — confusing for the user.)
export function pass2Shift(pass2) {
  if (!pass2 || !pass2.enabled) return 0;
  // Backwards compat: accept either { cellShift } or { angle }
  if (typeof pass2.cellShift === 'number') return pass2.cellShift;
  if (typeof pass2.angle === 'number') return Math.round(pass2.angle / 15);
  return 0;
}

// Layout functions (checker / brick / chevron) live in layout.js. This
// module now only hosts the pattern metadata, unit conversion, and the
// cut-list text generator.

// ---------- Unit conversion + cut-list math ----------

const KERF_MM = 3;          // typical table-saw kerf
const WASTE_FACTOR = 1.20;  // +20% for snipe, square-up, mistakes
const FLATTEN_LOSS_MM = 6;  // ~3mm planed off each face after glue-up

export function mmToInches(mm) {
  const inches = mm / 25.4;
  // Round to nearest 1/16"
  const sixteenths = Math.round(inches * 16);
  const whole = Math.floor(sixteenths / 16);
  const frac = sixteenths % 16;
  if (frac === 0) return `${whole}"`;
  // Reduce fraction
  let n = frac, d = 16;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return whole > 0 ? `${whole} ${n}/${d}"` : `${n}/${d}"`;
}

// Required raw stock length for the edge-grain glue-up, accounting for kerf
// loss on each crosscut and a final waste factor for cleanup.
export function stockLengthMm(numSlices, sliceThickness) {
  const cutLoss = (numSlices - 1) * KERF_MM;
  const usable = numSlices * sliceThickness + cutLoss;
  return Math.ceil(usable * WASTE_FACTOR);
}

// Board feet = (thickness in inches × width in inches × length in inches) / 144
// We treat strip "thickness" as a constant 25mm (1") as a reasonable default.
export function boardFeet(strips, numSlices, sliceThickness) {
  const stripStockThicknessMm = 25; // assume 4/4 stock
  const lenMm = stockLengthMm(numSlices, sliceThickness);
  const byspecies = {};
  strips.forEach(s => {
    const widthIn = s.width / 25.4;
    const lenIn = lenMm / 25.4;
    const thickIn = stripStockThicknessMm / 25.4;
    const bf = (widthIn * lenIn * thickIn) / 144;
    byspecies[s.species] = (byspecies[s.species] || 0) + bf;
  });
  return byspecies;
}

// ---------- Plain text cut-list export ----------

// Build a virtual flat strip list from any state shape (checker/chevron
// use state.strips directly; brick synthesizes alternating brick+mortar).
// Kept local to cutListText so this module stays DOM-free.
function stripsForState(state) {
  if (state.pattern !== 'brick') return state.strips;
  const out = [];
  for (let i = 0; i < state.numBricks; i++) {
    out.push({ species: state.brickSpecies, width: state.brickWidth });
    if (i < state.numBricks - 1) {
      out.push({ species: state.mortarSpecies, width: state.mortarWidth });
    }
  }
  return out;
}

export function cutListText(state) {
  const { pattern, numSlices, sliceThickness, pass2 } = state;
  const strips = stripsForState(state);
  const cutAngle = pattern === 'chevron' ? 45 : 0;
  const totalW = sum(strips.map(s => s.width));
  const totalH = pattern === 'brick'
    ? numSlices * sliceThickness + Math.max(0, numSlices - 1) * (state.mortarSliceThickness || 0)
    : numSlices * sliceThickness;
  const stockLen = stockLengthMm(numSlices, sliceThickness);
  const finalThickness = Math.max(15, 25 - FLATTEN_LOSS_MM); // assume 25mm stock minus flattening
  const bf = boardFeet(strips, numSlices, sliceThickness);

  const lines = [
    `END-GRAIN CUTTING BOARD — ${pattern.toUpperCase()}`,
    `generated ${new Date().toISOString().slice(0, 10)}`,
    '',
    'LUMBER SHOPPING LIST',
    ...Object.entries(bf).map(([sp, b]) =>
      `  ${sp.padEnd(14)} ${b.toFixed(2).padStart(5)} bd-ft  (4/4 stock)`),
    `  ${'total'.padEnd(14)} ${Object.values(bf).reduce((a, b) => a + b, 0).toFixed(2).padStart(5)} bd-ft`,
    '  • includes 20% waste factor',
    '',
    'PASS 1 — EDGE-GRAIN GLUE-UP',
    `  raw stock length needed: ${stockLen}mm  (${mmToInches(stockLen)}) per strip`,
    '  strip order:',
    ...strips.map((s, i) =>
      `    ${String(i + 1).padStart(2, ' ')}. ${s.species.padEnd(14)} ${String(s.width).padStart(3)}mm  (${mmToInches(s.width)})`),
    `  total glue-up width: ${totalW}mm  (${mmToInches(totalW)})`,
    '',
    'PASS 1 — FLATTEN',
    '  • plane or drum-sand both faces flat before crosscutting',
    '  • lose ~3mm per face',
    '',
    `PASS 1 — CROSSCUT`,
    `  ${numSlices} slices × ${sliceThickness}mm  (${mmToInches(sliceThickness)})${cutAngle ? ` at ${cutAngle}°` : ' perpendicular'}`,
    `  kerf allowance: ${KERF_MM}mm × ${numSlices - 1} cuts = ${(numSlices - 1) * KERF_MM}mm`,
    '',
    `PASS 1 — REASSEMBLE`,
    `  rule: ${PATTERNS[pattern].label}`,
    `  → ROTATE EACH SLICE 90° so end grain faces up — this is the whole point`,
    `  → glue and clamp; mark slice numbers on the side for reference`,
  ];
  if (pass2 && pass2.enabled) {
    const shift = pass2.cellShift ?? Math.round((pass2.angle ?? 0) / 15);
    lines.push(
      '',
      `PASS 2 — SECOND CUT-AND-REGLUE`,
      `  • flatten the pass-1 panel`,
      `  • crosscut perpendicular to pass-1 glue lines`,
      `  • rotate each new slice by ${shift} cells before regluing`,
      `  • this is the ${shift} cells shift technique`,
    );
  }
  lines.push(
    '',
    `FINAL BOARD`,
    `  ${totalW} × ${totalH} mm  (${mmToInches(totalW)} × ${mmToInches(totalH)})`,
    `  finished thickness: ~${finalThickness}mm  (${mmToInches(finalThickness)})  (after flattening)`,
    `  species: ${[...new Set(strips.map(s => s.species))].join(', ')}`,
    '',
    'FINISHING',
    '  • flatten + sand to 220 grit',
    '  • optional: route juice groove, round edges, attach feet',
    '  • finish with food-safe mineral oil + beeswax',
  );
  return lines.join('\n');
}
