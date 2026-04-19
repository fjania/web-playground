// evaluate.js — pure pipeline for end-grain cutting board design.
//
// Patterns are compositions of atomic operations. This module evaluates
// an ordered list of operations against a starting strip pattern and
// produces a snapshot after each step. Every snapshot carries a 3D-aware
// workpiece with a renderable 2D face. No DOM. Fully unit-testable.

import { stockLengthMm } from './pipeline.js';

// ─── Helpers ────────────────────────────────────────────────────────

export function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// Clip a polygon to a horizontal band [yMin, yMax] using Sutherland-Hodgman.
function clipPolyToHBand(points, yMin, yMax) {
  let pts = points;
  // Clip against y >= yMin
  pts = clipPolyEdge(pts, (p) => p[1] >= yMin, (a, b) => {
    const t = (yMin - a[1]) / (b[1] - a[1]);
    return [a[0] + t * (b[0] - a[0]), yMin];
  });
  // Clip against y <= yMax
  pts = clipPolyEdge(pts, (p) => p[1] <= yMax, (a, b) => {
    const t = (yMax - a[1]) / (b[1] - a[1]);
    return [a[0] + t * (b[0] - a[0]), yMax];
  });
  return pts;
}

function clipPolyEdge(points, inside, intersect) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const prev = points[(i + points.length - 1) % points.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (prevIn && curIn) {
      out.push(cur);
    } else if (prevIn && !curIn) {
      out.push(intersect(prev, cur));
    } else if (!prevIn && curIn) {
      out.push(intersect(prev, cur));
      out.push(cur);
    }
  }
  return out;
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// Expand a strip pattern (repeating unit + optional tail) into a flat
// list. The user edits the unit; the tool tiles it.
export function expandStrips({ unit, repeat, tail }) {
  const out = [];
  for (let i = 0; i < repeat; i++) {
    for (const s of unit) out.push({ species: s.species, width: s.width });
  }
  if (tail) {
    for (const s of tail) out.push({ species: s.species, width: s.width });
  }
  return out;
}

// ─── Diagonal-band clipping (for 45° crosscut) ─────────────────────

// Build diagonal band polygons for a column of width `colW` and height
// `colH`, tiling the strip sequence diagonally. `flipped` reverses the
// stripe direction (−45° instead of +45°).
export function buildDiagonalBands(strips, colW, colH, flipped) {
  const diag = colW + colH;
  const bands = [];
  let offset = -colH;
  while (offset < diag) {
    for (const s of strips) {
      bands.push({ start: offset, end: offset + s.width, species: s.species });
      offset += s.width;
      if (offset >= diag) break;
    }
  }
  const polys = [];
  for (const band of bands) {
    const pts = clipDiagonalBand(band.start, band.end, colW, colH, flipped);
    if (pts.length >= 3) {
      polys.push({ points: pts, species: band.species });
    }
  }
  return polys;
}

// Clip {b0 ≤ v ± u ≤ b1} to [0,w] × [0,h]. Returns [u,v][] in CCW order.
function clipDiagonalBand(b0, b1, w, h, flipped) {
  const points = [];
  const push = (u, v) => {
    if (u >= -1e-6 && u <= w + 1e-6 && v >= -1e-6 && v <= h + 1e-6) {
      points.push([clamp(u, 0, w), clamp(v, 0, h)]);
    }
  };
  const lineVal = (u, v) => flipped ? v - u : v + u;
  for (const [u, v] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    if (lineVal(u, v) >= b0 - 1e-6 && lineVal(u, v) <= b1 + 1e-6) push(u, v);
  }
  for (const b of [b0, b1]) {
    push(0, b);
    push(w, flipped ? b + w : b - w);
    push(flipped ? -b : b, 0);
    push(flipped ? h - b : b - h, h);
  }
  if (points.length < 3) return [];
  const cx = sum(points.map(p => p[0])) / points.length;
  const cy = sum(points.map(p => p[1])) / points.length;
  points.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const out = [];
  for (const p of points) {
    if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-4) {
      out.push(p);
    }
  }
  if (out.length >= 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4) {
    out.pop();
  }
  return out.length >= 3 ? out : [];
}

// ─── WorkState types ────────────────────────────────────────────────
//
// { kind: 'panel', workpiece }     — a glued-up panel (single piece)
// { kind: 'slices', slices: [] }   — array of crosscut pieces
//
// Workpiece = { width, height, thickness, grainDir, face }
// face      = { width, height, rects: [{x,y,w,h,species}], polys: [{points,species}] }

function makePanel(wp) { return { kind: 'panel', workpiece: wp }; }
function makeSlices(sl, prev) {
  const s = { kind: 'slices', slices: sl };
  if (prev && prev.direction) s.direction = prev.direction;
  return s;
}

// ─── Operations ─────────────────────────────────────────────────────

// 1. GLUEUP — join strips or slices into a panel
function applyGlueup(state, _params, ctx) {
  if (!state) {
    // Initial glueup from raw strips
    const { strips, stockLength, stockThickness } = ctx;
    const panelW = sum(strips.map(s => s.width));
    const rects = [];
    let x = 0;
    for (const s of strips) {
      rects.push({ x, y: 0, w: s.width, h: stockLength, species: s.species });
      x += s.width;
    }
    return makePanel({
      width: panelW,
      height: stockLength,
      thickness: stockThickness,
      grainDir: 'long-grain',
      face: { width: panelW, height: stockLength, rects, polys: [] },
    });
  }
  if (state.kind !== 'slices') throw new Error('glueup requires slices or initial');

  // Re-glue: join slices. Direction comes from a prior stack operation
  // (stored on the workState), or from the op params, or defaults to vertical.
  const dir = state.direction || _params.direction || 'vertical';
  const rects = [];
  const polys = [];
  let off = 0;
  for (const slice of state.slices) {
    if (dir === 'vertical') {
      for (const r of slice.face.rects) rects.push({ ...r, y: r.y + off });
      for (const p of slice.face.polys) polys.push({ ...p, points: p.points.map(([x, y]) => [x, y + off]) });
      off += slice.face.height;
    } else {
      for (const r of slice.face.rects) rects.push({ ...r, x: r.x + off });
      for (const p of slice.face.polys) polys.push({ ...p, points: p.points.map(([x, y]) => [x + off, y]) });
      off += slice.face.width;
    }
  }
  const first = state.slices[0];
  const totalW = dir === 'horizontal' ? off : first.face.width;
  const totalH = dir === 'vertical'   ? off : first.face.height;
  return makePanel({
    width: totalW,
    height: totalH,
    thickness: first.thickness,
    grainDir: first.grainDir,
    face: { width: totalW, height: totalH, rects, polys },
  });
}

// 2. FLATTEN — plane to target thickness
function applyFlatten(state, params) {
  if (state.kind !== 'panel') throw new Error('flatten requires a panel');
  const wp = state.workpiece;
  return makePanel({ ...wp, thickness: params.targetThickness });
}

// 3. CROSSCUT — slice a panel into pieces at any angle.
//
// The cut lines are PARALLEL lines across the panel, spaced by
// sliceThickness (measured perpendicular to the cut direction).
// At 0° they're horizontal; at θ > 0 they're diagonal.
//
// Each slice's LONG-GRAIN face (viewed from above, before rotate)
// shows the strip pattern clipped to a rectangular window. The
// window height = sliceThickness / cos(θ) at x=0. For angled cuts,
// the physical shape is a parallelogram, but we represent the face
// as a rectangle in the slice's local coordinate system. The cut
// angle is stored as metadata for rotate90 and rendering.
function applyCrosscut(state, params, ctx) {
  if (state.kind !== 'panel') throw new Error('crosscut requires a panel');
  const { angle = 0, sliceThickness, sliceCount } = params;
  const wp = state.workpiece;
  const rad = angle * Math.PI / 180;
  const cosA = Math.cos(rad);

  // Vertical spacing between consecutive cuts at x=0
  const sliceH = sliceThickness / cosA;

  // Extract strip info from the panel face for later use by rotate90
  const strips = wp.face.rects
    .sort((a, b) => a.x - b.x)
    .map(r => ({ species: r.species, width: r.w }));

  const tanA = Math.tan(rad);
  const rise = wp.face.width * tanA;

  const slices = [];
  for (let i = 0; i < sliceCount; i++) {
    if (angle === 0) {
      // Perpendicular: rectangular slices. Clip both rects AND polys
      // to the horizontal band [yStart, yStart + sliceH].
      const yStart = i * sliceH;
      const yEnd = yStart + sliceH;

      const clippedRects = [];
      for (const r of wp.face.rects) {
        const ry0 = Math.max(r.y, yStart);
        const ry1 = Math.min(r.y + r.h, yEnd);
        if (ry1 - ry0 > 1e-6) {
          clippedRects.push({ x: r.x, y: ry0 - yStart, w: r.w, h: ry1 - ry0, species: r.species });
        }
      }

      const clippedPolys = [];
      for (const p of wp.face.polys) {
        const clipped = clipPolyToHBand(p.points, yStart, yEnd);
        if (clipped.length >= 3) {
          clippedPolys.push({
            species: p.species,
            points: clipped.map(([x, y]) => [x, y - yStart]),
          });
        }
      }

      slices.push({
        width: wp.width,
        height: sliceH,
        thickness: wp.thickness,
        grainDir: wp.grainDir,
        face: { width: wp.face.width, height: sliceH, rects: clippedRects, polys: clippedPolys },
        _cutAngle: 0,
        _strips: strips.length > 0 ? strips : ctx.strips,
      });
    } else {
      // Angled: parallelogram slices. Face uses cut-edge-aligned coords
      // (cut edge horizontal). Strip boundaries skew by sliceThickness·tan(θ)
      // between bottom and top edges, producing parallelogram strip bands.
      //   width  = panelWidth/cos(θ) + sliceThickness·tan(θ)
      //   height = sliceThickness
      const stripSeq = strips.length > 0 ? strips : ctx.strips;
      const skew = sliceThickness * tanA;
      const faceW = wp.face.width / cosA + skew;
      const polys = [];
      let cumU = 0;
      for (const s of stripSeq) {
        const uW = s.width / cosA;
        polys.push({
          species: s.species,
          points: [
            [cumU, 0],
            [cumU + uW, 0],
            [cumU + uW + skew, sliceThickness],
            [cumU + skew, sliceThickness],
          ],
        });
        cumU += uW;
      }
      slices.push({
        width: faceW,
        height: sliceThickness,
        thickness: wp.thickness,
        grainDir: wp.grainDir,
        face: { width: faceW, height: sliceThickness, rects: [], polys },
        _cutAngle: angle,
        _strips: stripSeq,
      });
    }
  }
  return makeSlices(slices);
}

// 4. ROTATE90 — turn slices so end grain faces up.
//
// After stack, all slices are oriented longest-edge-horizontal. Rotate
// swaps each slice's face to show the end-grain cross-section:
//   face width  = current face width (the long dimension, unchanged)
//   face height = stockThickness (now visible after rotating)
//   thickness   = current face height (the short dimension, now depth)
//
// For cut angle > 0: face content uses diagonal bands instead of rects.
function applyRotate90(state) {
  if (state.kind !== 'slices') throw new Error('rotate90 requires slices');

  const rotated = state.slices.map(slice => {
    const angle = slice._cutAngle || 0;
    const strips = slice._strips || [];
    const stockT = slice.thickness;
    const faceW = slice.face.width;
    const faceH = stockT;
    const newThickness = slice.face.height;

    let rects = [], polys = [];

    // The end-grain face = the cut surface. Each strip appears as a
    // band at its actual panel position. For angled cuts, the bands
    // skew by stockThickness × tan(θ) between bottom and top.
    const panelW = sum(strips.map(s => s.width));
    const egH = stockT;
    const skew = angle > 0 ? stockT * Math.tan(angle * Math.PI / 180) : 0;
    const egW = panelW + skew;

    let cumX = 0;
    for (const s of strips) {
      if (angle === 0) {
        rects.push({ x: cumX, y: 0, w: s.width, h: egH, species: s.species });
      } else {
        polys.push({
          species: s.species,
          points: [
            [cumX, 0],
            [cumX + s.width, 0],
            [cumX + s.width + skew, egH],
            [cumX + skew, egH],
          ],
        });
      }
      cumX += s.width;
    }

    return {
      width: egW,
      height: egH,
      thickness: newThickness,
      grainDir: 'end-grain',
      face: { width: egW, height: egH, rects, polys },
      _cutAngle: angle,
      _strips: strips,
    };
  });
  return makeSlices(rotated, state);
}

// 5. FLIP ALTERNATE — flip every other slice 180° in-plane
function applyFlipAlternate(state) {
  if (state.kind !== 'slices') throw new Error('flipAlternate requires slices');

  const flipped = state.slices.map((slice, i) => {
    if (i % 2 === 0) return slice;
    return flipFace(slice);
  });
  return makeSlices(flipped, state);
}

function flipFace(slice) {
  const fw = slice.face.width;
  // Horizontal mirror: x → fw - x for all geometry
  const rects = slice.face.rects.map(r => ({
    ...r, x: fw - r.x - r.w,
  }));
  const polys = slice.face.polys.map(p => ({
    ...p, points: p.points.map(([x, y]) => [fw - x, y]),
  }));

  return {
    ...slice,
    face: { ...slice.face, rects, polys },
  };
}

// 6. SHIFT ALTERNATE — offset every other slice by an absolute amount (mm).
// For running-bond brick: shift = (brickWidth + mortarWidth) / 2.
function applyShiftAlternate(state, params) {
  if (state.kind !== 'slices') throw new Error('shiftAlternate requires slices');
  const { shift } = params;

  const shifted = state.slices.map((slice, i) => {
    if (i % 2 === 0) return slice;
    return shiftFace(slice, shift);
  });
  return makeSlices(shifted, state);
}

function shiftFace(slice, shift) {
  const fw = slice.face.width;
  const fh = slice.face.height;

  const rects = [];
  for (const r of slice.face.rects) {
    // Shift left by `shift`, wrapping around
    const x1 = r.x - shift;
    // This rect might wrap around; split into up to 2 pieces
    if (x1 + r.w <= fw && x1 >= 0) {
      rects.push({ ...r, x: x1 });
    } else if (x1 < 0) {
      // Wraps off left edge
      const leftPart = -x1;
      if (r.w - leftPart > 1e-6) {
        rects.push({ ...r, x: 0, w: r.w - leftPart });
      }
      rects.push({ ...r, x: fw - leftPart, w: leftPart });
    } else {
      // x1 >= 0 but extends past fw
      const rightPart = (x1 + r.w) - fw;
      if (r.w - rightPart > 1e-6) {
        rects.push({ ...r, x: x1, w: r.w - rightPart });
      }
      rects.push({ ...r, x: 0, w: rightPart });
    }
  }

  return {
    ...slice,
    face: { ...slice.face, rects, polys: slice.face.polys },
  };
}

// 7. INSERT STRIPS — interleave thin strips between existing slices.
// The inserted strip runs the full width of the existing slice (it's a
// spacer placed between two slices during reassembly). Its face is:
//   width = existing slice face.width (full board width)
//   height = ins.width (the strip's physical thickness = its contribution
//            to the stacking direction)
function applyInsertStrips(state, params) {
  if (state.kind !== 'slices') throw new Error('insertStrips requires slices');
  const { strips: insertList } = params;

  const out = [];
  for (let i = 0; i < state.slices.length; i++) {
    out.push(state.slices[i]);
    if (i < state.slices.length - 1) {
      const existingW = state.slices[i].face.width;
      for (const ins of insertList) {
        out.push({
          width: existingW,
          height: ins.width,
          thickness: state.slices[i].thickness,
          grainDir: state.slices[i].grainDir,
          face: {
            width: existingW,
            height: ins.width,
            rects: [{ x: 0, y: 0, w: existingW, h: ins.width, species: ins.species }],
            polys: [],
          },
        });
      }
    }
  }
  return makeSlices(out, state);
}

// 8. STACK — arrange slices on the bench. No parameters.
// Auto-orients each slice so its longest edge is horizontal, then
// marks direction as 'vertical' (slices stack top-to-bottom).
// This is how a woodworker naturally lays out pieces — longest
// edge flat on the bench, pieces stacked in rows.
function applyStack(state) {
  if (state.kind !== 'slices') throw new Error('stack requires slices');

  const oriented = state.slices.map(slice => {
    if (slice.face.height <= slice.face.width) return slice;
    // Rotate 90° CW: (x, y) → (oldH - y, x)
    // This turns the piece on the bench so its longest edge is horizontal,
    // preserving the visual appearance of the strip bands.
    const f = slice.face;
    const oldH = f.height;
    const rects = f.rects.map(r => ({
      species: r.species,
      x: oldH - r.y - r.h,
      y: r.x,
      w: r.h,
      h: r.w,
    }));
    const polys = f.polys.map(p => ({
      species: p.species,
      points: p.points.map(([x, y]) => [oldH - y, x]),
    }));
    return {
      ...slice,
      width: slice.height,
      height: slice.width,
      face: { width: f.height, height: f.width, rects, polys },
    };
  });

  return { kind: 'slices', slices: oriented, direction: 'vertical' };
}

// 9. TRIM — square up edges (remove waste triangles from angled cuts)
function applyTrim(state) {
  if (state.kind !== 'panel') throw new Error('trim requires a panel');
  const wp = state.workpiece;
  const face = wp.face;

  // Find the largest rectangle fully covered by content.
  // Scan all geometry to find the innermost x bounds where every row
  // has full coverage. For skewed parallelogram bands, the left edge
  // of coverage = max of all polys' leftmost x at each y, and the
  // right edge = min of all polys' rightmost x at each y.
  //
  // Simplified approach: find the x range where ALL shapes overlap.
  // For each poly/rect, compute its x extent at every y. The trim
  // rectangle x range = [max of all left edges, min of all right edges].
  //
  // For parallelogram bands from angled cuts: each band has a left
  // edge that varies with y. The leftmost band's right edge and the
  // rightmost band's left edge define the clean rectangle.

  // Find the largest rectangle fully covered by content by sampling
  // y positions and finding the x range with content at each level.
  // The clean rect = intersection of all per-y x ranges.
  const allShapes = [
    ...face.rects.map(r => ({
      points: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]],
    })),
    ...face.polys,
  ];

  // Sample y at many positions to find narrowest x coverage
  const steps = 50;
  let xMin = 0;
  let xMax = face.width;

  for (let s = 0; s <= steps; s++) {
    const y = (s / steps) * face.height;
    // Find x range of all shapes at this y by intersecting the scan line
    // with each polygon's edges.
    let rowLeft = face.width;
    let rowRight = 0;
    for (const shape of allShapes) {
      const pts = shape.points;
      const n = pts.length;
      const intersections = [];
      for (let j = 0; j < n; j++) {
        const [x1, y1] = pts[j];
        const [x2, y2] = pts[(j + 1) % n];
        if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) {
          if (Math.abs(y2 - y1) < 1e-9) {
            intersections.push(x1, x2);
          } else {
            const t = (y - y1) / (y2 - y1);
            intersections.push(x1 + t * (x2 - x1));
          }
        }
      }
      if (intersections.length > 0) {
        rowLeft = Math.min(rowLeft, Math.min(...intersections));
        rowRight = Math.max(rowRight, Math.max(...intersections));
      }
    }
    if (rowRight > rowLeft) {
      xMin = Math.max(xMin, rowLeft);
      xMax = Math.min(xMax, rowRight);
    }
  }

  if (xMax <= xMin) {
    xMin = 0; xMax = face.width;
  }

  const trimW = xMax - xMin;
  const yMin = 0;
  const yMax = face.height;
  const trimH = yMax - yMin;

  // Clip and shift all geometry into the trim rectangle
  const rects = face.rects.map(r => {
    const nx = clamp(r.x, xMin, xMax) - xMin;
    const nw = Math.min(r.x + r.w, xMax) - Math.max(r.x, xMin);
    if (nw <= 0) return null;
    return { ...r, x: nx, y: r.y - yMin, w: nw };
  }).filter(Boolean);

  const polys = face.polys.map(p => {
    const pts = p.points.map(([x, y]) => [clamp(x, xMin, xMax) - xMin, clamp(y, yMin, yMax) - yMin]);
    return { ...p, points: pts };
  });

  return makePanel({
    ...wp,
    width: trimW,
    height: trimH,
    face: { width: trimW, height: trimH, rects, polys },
  });
}

// ─── Dispatcher ─────────────────────────────────────────────────────

function applyOperation(state, op, ctx) {
  switch (op.type) {
    case 'glueup':         return applyGlueup(state, op, ctx);
    case 'flatten':        return applyFlatten(state, op);
    case 'crosscut':       return applyCrosscut(state, op, ctx);
    case 'rotate90':       return applyRotate90(state);
    case 'flipAlternate':  return applyFlipAlternate(state);
    case 'shiftAlternate': return applyShiftAlternate(state, op);
    case 'insertStrips':   return applyInsertStrips(state, op);
    case 'stack':          return applyStack(state, op);
    case 'trim':           return applyTrim(state);
    default: throw new Error(`unknown operation: ${op.type}`);
  }
}

// ─── Main evaluator ─────────────────────────────────────────────────

export function evaluate(stripPattern, operations, stockThickness = 25) {
  const strips = expandStrips(stripPattern);
  const crosscutOp = operations.find(op => op.type === 'crosscut');
  const stockLength = crosscutOp
    ? stockLengthMm(crosscutOp.sliceCount, crosscutOp.sliceThickness)
    : 300;

  const ctx = { strips, stockLength, stockThickness };
  let workState = null;
  const snapshots = [];

  for (const op of operations) {
    workState = applyOperation(workState, op, ctx);
    snapshots.push({ op: clone(op), workState: clone(workState) });
  }

  return snapshots;
}

// Convenience: get the final face from a set of snapshots.
// If the last snapshot is slices, returns the first slice's face.
export function finalFace(snapshots) {
  if (!snapshots.length) return null;
  const last = snapshots[snapshots.length - 1].workState;
  if (last.kind === 'panel') return last.workpiece.face;
  if (last.slices.length) return last.slices[0].face;
  return null;
}

// ─── Presets ─────────────────────────────────────────────────────────

export const PRESETS = {
  checkerboard: {
    name: 'Checkerboard',
    stripPattern: {
      unit: [{ species: 'maple', width: 25 }, { species: 'walnut', width: 25 }],
      repeat: 4,
    },
    stockThickness: 25,
    operations: [
      { type: 'glueup' },
      { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 8 },
      { type: 'stack' },
      { type: 'rotate90' },
      { type: 'flipAlternate' },
      { type: 'glueup' },
    ],
  },
  brick: {
    name: 'Brick',
    stripPattern: {
      unit: [{ species: 'maple', width: 50 }, { species: 'walnut', width: 6 }],
      repeat: 4,
      tail: [{ species: 'maple', width: 50 }],
    },
    stockThickness: 25,
    operations: [
      { type: 'glueup' },
      { type: 'crosscut', angle: 0, sliceThickness: 25, sliceCount: 7 },
      { type: 'stack' },
      { type: 'rotate90' },
      { type: 'shiftAlternate', shift: 28 },
      { type: 'insertStrips', strips: [{ species: 'walnut', width: 4 }] },
      { type: 'glueup' },
    ],
  },
  chevron: {
    name: 'Chevron',
    stripPattern: {
      unit: [{ species: 'walnut', width: 30 }, { species: 'maple', width: 10 }],
      repeat: 4,
    },
    stockThickness: 25,
    operations: [
      { type: 'glueup' },
      { type: 'crosscut', angle: 45, sliceThickness: 30, sliceCount: 6 },
      { type: 'stack' },
      { type: 'rotate90' },
      { type: 'flipAlternate' },
      { type: 'glueup' },
      { type: 'trim' },
    ],
  },
};
