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

// The 6 supported patterns. Each one has a label describing its reassembly rule
// and a default crosscut angle — the minimum the user needs to specify.
export const PATTERNS = {
  checkerboard: { label: '1 cell',           defaultAngle: 0  },
  brick:        { label: '½ cell',           defaultAngle: 0  },
  herringbone:  { label: 'flip every slice', defaultAngle: 45 },
  chevron:      { label: 'mirror at center', defaultAngle: 45 },
  tumbling:     { label: '3-face isometric', defaultAngle: 30 },
  chaos:        { label: 'seeded shuffle',   defaultAngle: 0  },
};

// ---------- Small utilities ----------

export function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

export function mod(n, m) { return ((n % m) + m) % m; }

// Seeded RNG (mulberry32) — deterministic for chaos reproducibility.
export function rng(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// ---------- Checkerboard ----------

// Returns a 2D grid of species names. cells[row][col] ∈ strips.
// rows = numSlices (vertical), cols = strips.length (horizontal).
export function checkerboardGrid(strips, numSlices, pass2 = null) {
  const N = strips.length;
  const extra = pass2Shift(pass2);
  const cells = [];
  for (let row = 0; row < numSlices; row++) {
    const r = [];
    for (let col = 0; col < N; col++) {
      const idx = mod(col + row + row * extra, N);
      r.push(strips[idx].species);
    }
    cells.push(r);
  }
  return cells;
}

// ---------- Brick ----------

// Brick: each row is shifted horizontally by `offset × cellWidth` relative to
// row 0. Common offsets:
//   0.5    — running bond (every other row offset by half)
//   0.333  — third bond (rows step 1/3, 2/3, 0, 1/3 ...)
//   0.25   — quarter bond
// For visualization simplicity we model the offset as a *cumulative* per-row
// horizontal shift, expressed in units of strip[0].width. The renderer wraps
// the row by drawing two partial cells at the ends.
//
// Returns rows: [{ cells: speciesName[], offsetFraction: number, headSpecies, tailSpecies }]
export function brickLayout(strips, numSlices, pass2 = null, offsetType = 0.5) {
  const N = strips.length;
  const extra = pass2Shift(pass2);
  const rows = [];
  for (let row = 0; row < numSlices; row++) {
    const rowShift = row * extra;
    const first = mod(rowShift, N);
    // Cumulative fractional offset for this row, wrapped to [0, 1)
    const cum = (row * offsetType) % 1;
    const r = [];
    for (let j = 0; j < N; j++) r.push(strips[(j + first) % N].species);
    rows.push({
      cells: r,
      offsetFraction: cum,
    });
  }
  return rows;
}

// ---------- Chaos ----------

// Chaos is a cell grid with random cell widths (bounded) and random species
// picked from the strip palette. Seeded so previews are reproducible.
// Returns: { cells: string[][], widths: number[][], heights: number[] }
export function chaosLayout(strips, numSlices, sliceThickness, seed = 1, pass2 = null) {
  const r = rng(seed);
  const palette = strips.map(s => s.species);
  const targetWidth = sum(strips.map(s => s.width));
  const cells = [];
  const widths = [];
  const heights = [];
  const minW = 15, maxW = 50;
  const passes = pass2 && pass2.enabled ? 2 : 1;
  for (let row = 0; row < numSlices; row++) {
    const rowCells = [];
    const rowWidths = [];
    let used = 0;
    while (used < targetWidth) {
      const w = Math.min(maxW, Math.max(minW, Math.round(r() * (maxW - minW) + minW)));
      const remaining = targetWidth - used;
      // If remaining space is too small for a new cell, absorb it into the
      // previous cell so the row fills exactly.
      if (remaining < minW) {
        if (rowWidths.length > 0) rowWidths[rowWidths.length - 1] += remaining;
        break;
      }
      const clamped = Math.min(w, remaining);
      rowWidths.push(clamped);
      rowCells.push(palette[Math.floor(r() * palette.length)]);
      used += clamped;
    }
    // Pass 2 optionally reshuffles the row
    if (passes === 2) {
      const cut = Math.floor(r() * rowCells.length);
      rowCells.push(...rowCells.splice(0, cut));
      rowWidths.push(...rowWidths.splice(0, cut));
    }
    cells.push(rowCells);
    widths.push(rowWidths);
    heights.push(sliceThickness);
  }
  return { cells, widths, heights };
}

// ---------- Herringbone (geometry) ----------

// Herringbone-style tile generation.
//
// Honest disclaimer: a strict herringbone tiling — every adjacent rect
// perpendicular along long edges — is *not* possible with axis-aligned 2:1
// rectangles in a small fundamental domain. Real herringbone parquet uses a
// non-rectangular lattice (with offset diagonal stripes), which is hard to
// implement cleanly in 2D.
//
// We use a 4u × 4u fundamental tile with 8 rectangles that *visually* reads
// as herringbone — clear L-pair structure of perpendicular H + V rects — even
// though some adjacent verticals share long edges (technically a brick-like
// adjacency). For a *design preview* tool, this is the right tradeoff: the
// visual unmistakably communicates "herringbone" without engineering a
// complex non-axis-aligned tiling.
//
// Tile layout (4u × 4u, 8 rects, full coverage):
//   H1 = (0,0,2,1)  H2 = (2,2,2,1)  H3 = (0,3,2,1)  H4 = (2,3,2,1)
//   V1 = (2,0,1,2)  V2 = (3,0,1,2)  V3 = (0,1,1,2)  V4 = (1,1,1,2)
//
// Returns [{ x, y, w, h, orientation: 'h'|'v', species }]
export function herringboneTiles(strips, boardW, boardH, unit = 30) {
  const colors = strips.map(s => s.species);
  const u = unit;

  const TILE = [
    { dx: 0, dy: 0, w: 2, h: 1, orientation: 'h' },
    { dx: 2, dy: 0, w: 1, h: 2, orientation: 'v' },
    { dx: 3, dy: 0, w: 1, h: 2, orientation: 'v' },
    { dx: 0, dy: 1, w: 1, h: 2, orientation: 'v' },
    { dx: 1, dy: 1, w: 1, h: 2, orientation: 'v' },
    { dx: 2, dy: 2, w: 2, h: 1, orientation: 'h' },
    { dx: 0, dy: 3, w: 2, h: 1, orientation: 'h' },
    { dx: 2, dy: 3, w: 2, h: 1, orientation: 'h' },
  ];

  const tiles = [];
  const tileSize = 4;
  const colsTotal = Math.ceil(boardW / (tileSize * u)) + 1;
  const rowsTotal = Math.ceil(boardH / (tileSize * u)) + 1;
  let c = 0;
  for (let by = -1; by < rowsTotal; by++) {
    for (let bx = -1; bx < colsTotal; bx++) {
      const baseX = bx * tileSize * u;
      const baseY = by * tileSize * u;
      for (const t of TILE) {
        tiles.push({
          x: baseX + t.dx * u,
          y: baseY + t.dy * u,
          w: t.w * u,
          h: t.h * u,
          orientation: t.orientation,
          species: colors[c % colors.length],
        });
        c++;
      }
    }
  }
  return tiles;
}

// ---------- Chevron (geometry) ----------

// Chevron is diagonal bands, mirrored at the board's vertical centerline.
// Returns a list of parallelograms per band.
export function chevronBands(strips, boardW, boardH, unit = 34) {
  const colors = strips.map(s => s.species);
  const bands = [];
  const slope = 1;
  const rise = (boardW / 2) * slope;
  const rows = Math.ceil(boardH / unit) + 4;
  let c = 0;
  for (let i = -rows; i < rows; i++) {
    const color = colors[c % colors.length];
    const yBase = i * unit;
    bands.push({
      color,
      left: [
        [0, yBase],
        [boardW / 2, yBase + rise],
        [boardW / 2, yBase + rise + unit],
        [0, yBase + unit],
      ],
      right: [
        [boardW / 2, yBase + rise],
        [boardW, yBase],
        [boardW, yBase + unit],
        [boardW / 2, yBase + rise + unit],
      ],
    });
    c++;
  }
  return bands;
}

// ---------- Tumbling blocks (3D cube) ----------

// Isometric cube tiling. Each "cube" is three rhombi sharing a center point,
// representing the top, left, and right faces. Rhombi tile the plane in a
// hex-ish grid. Three shades per cube are drawn from three sequential strips
// in the palette.
//
// The cube unit:
//   - Top face:   rhombus with vertices (0,-u), (h,-u/2), (0,0), (-h,-u/2)
//   - Right face: rhombus with vertices (0,0), (h,-u/2), (h,u/2), (0,u)
//   - Left face:  rhombus with vertices (0,0), (-h,-u/2), (-h,u/2), (0,u)
// where u = vertical unit, h = u * cos(30°) * 2 ≈ u * √3.
//
// Cubes tile on a hex grid: horizontal step = 2h, vertical step = 3u/2 (rowwise).
export function tumblingCubes(strips, boardW, boardH, unit = 22) {
  const u = unit;
  const h = u * Math.sqrt(3) / 2 * 2; // = u * √3 ≈ 1.732u
  const cubes = [];
  const palette = strips.map(s => s.species);
  if (palette.length < 3) {
    // Repeat species to fill if there aren't enough
    while (palette.length < 3) palette.push(strips[palette.length % strips.length].species);
  }
  const stepX = h * 2;
  const stepY = u * 3;
  const rowsUp = Math.ceil(boardH / stepY) + 2;
  const colsUp = Math.ceil(boardW / stepX) + 2;
  let c = 0;
  for (let row = -1; row < rowsUp; row++) {
    const yOff = row * stepY;
    const xOff = (row % 2) * h; // hex offset every other row
    for (let col = -1; col < colsUp; col++) {
      const cx = col * stepX + xOff;
      const cy = yOff;
      // Two cubes per tile step — stacked vertically with offset
      [0, stepY / 2].forEach((dy, k) => {
        const x = cx + (k ? h : 0);
        const y = cy + dy;
        const i = (c * 3) % palette.length;
        const top   = palette[i];
        const right = palette[(i + 1) % palette.length];
        const left  = palette[(i + 2) % palette.length];
        cubes.push({
          cx: x, cy: y, h, u,
          top: { species: top,   points: [[x, y - u], [x + h, y - u / 2], [x, y], [x - h, y - u / 2]] },
          right: { species: right, points: [[x, y], [x + h, y - u / 2], [x + h, y + u / 2], [x, y + u]] },
          left: { species: left,  points: [[x, y], [x - h, y - u / 2], [x - h, y + u / 2], [x, y + u]] },
        });
        c++;
      });
    }
  }
  return cubes;
}

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

export function cutListText(state) {
  const { strips, pattern, numSlices, sliceThickness, cutAngle, pass2 } = state;
  const totalW = sum(strips.map(s => s.width));
  const totalH = numSlices * sliceThickness;
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
