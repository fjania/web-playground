// stage-renderers.js — per-operation visualization for pipeline stage cards.
//
// Each renderer shows what the woodworker sees on the bench after that step.
// They use the actual workpiece data (species colors, dimensions) and add
// pedagogical annotations (cut lines, flip arrows, dimension labels).

import { drawLayout, el } from './render.js';
import { SPECIES } from './pipeline.js';

// ─── Shared helpers ─────────────────────────────────────────────────

function line(x1, y1, x2, y2, stroke, opts = {}) {
  const l = el('line', { x1, y1, x2, y2, stroke, 'stroke-width': opts.sw || 1 });
  if (opts.dash) l.setAttribute('stroke-dasharray', opts.dash);
  return l;
}

function text(x, y, str, opts = {}) {
  const t = el('text', {
    x, y,
    'font-family': 'Geist Mono, monospace',
    'font-size': opts.size || 8,
    fill: opts.fill || '#a8a29e',
    'text-anchor': opts.anchor || 'start',
  });
  t.textContent = str;
  return t;
}

function rect(x, y, w, h, fill, stroke = null, sw = 0.5) {
  const r = el('rect', { x, y, width: w, height: h, fill });
  if (stroke) { r.setAttribute('stroke', stroke); r.setAttribute('stroke-width', sw); }
  return r;
}

// Fit a face into a box, returning placement info.
function fitFace(face, box) {
  const scale = Math.min(box.w / face.width, box.h / face.height);
  const dw = face.width * scale, dh = face.height * scale;
  const ox = box.x + (box.w - dw) / 2;
  const oy = box.y + (box.h - dh) / 2;
  return { ox, oy, dw, dh, scale };
}

// Draw slices in a horizontal row with gaps.
function drawSliceRow(svg, slices, box, opts = {}) {
  const maxShow = opts.maxShow || Math.min(slices.length, 8);
  const gap = opts.gap || 3;
  const shown = slices.slice(0, maxShow);

  const totalFaceW = shown.reduce((s, sl) => s + sl.face.width, 0);
  const totalGap = gap * (shown.length - 1);
  const faceH = shown[0].face.height;
  const scaleX = (box.w - totalGap) / totalFaceW;
  const scaleY = box.h / faceH;
  const scale = Math.min(scaleX, scaleY);

  const actualW = totalFaceW * scale + totalGap;
  const actualH = faceH * scale;
  let x = box.x + (box.w - actualW) / 2;
  const y = box.y + (box.h - actualH) / 2;

  const positions = [];
  for (const slice of shown) {
    const sw = slice.face.width * scale;
    drawLayout(svg, slice.face, { x, y, w: sw, h: actualH });
    positions.push({ x, y, w: sw, h: actualH });
    x += sw + gap;
  }

  if (slices.length > maxShow) {
    svg.appendChild(text(x - gap + 4, y + actualH / 2 + 3, `+${slices.length - maxShow}`, { size: 7 }));
  }

  return { positions, scale, y, h: actualH };
}

// Draw slices in a vertical stack with gaps.
function drawSliceStack(svg, slices, box, opts = {}) {
  const gap = opts.gap || 2;
  const maxShow = opts.maxShow || Math.min(slices.length, 14);
  const shown = slices.slice(0, maxShow);

  const totalFaceH = shown.reduce((s, sl) => s + sl.face.height, 0);
  const totalGap = gap * (shown.length - 1);
  const faceW = shown[0].face.width;
  const scaleX = box.w / faceW;
  const scaleY = (box.h - totalGap) / totalFaceH;
  const scale = Math.min(scaleX, scaleY);

  const actualW = faceW * scale;
  const actualH = totalFaceH * scale + totalGap;
  const xBase = box.x + (box.w - actualW) / 2;
  let y = box.y + (box.h - actualH) / 2;

  const positions = [];
  for (const slice of shown) {
    const sh = slice.face.height * scale;
    drawLayout(svg, slice.face, { x: xBase, y, w: actualW, h: sh });
    positions.push({ x: xBase, y, w: actualW, h: sh });
    y += sh + gap;
  }

  return { positions, scale, xBase, w: actualW };
}

// ─── Per-operation renderers ────────────────────────────────────────

// GLUE-UP (initial): striped panel with faint seam lines
function renderGlueupInitial(svg, snap, box) {
  const face = snap.workState.workpiece.face;
  const p = fitFace(face, box);
  drawLayout(svg, face, { x: p.ox, y: p.oy, w: p.dw, h: p.dh });

  // Faint dashed seam lines at each strip boundary
  const rects = [...face.rects].sort((a, b) => a.x - b.x);
  let cx = 0;
  for (const r of rects) {
    if (cx > 0.5) {
      const sx = p.ox + cx * p.scale;
      svg.appendChild(line(sx, p.oy, sx, p.oy + p.dh, 'rgba(0,0,0,0.15)', { dash: '2,2', sw: 0.5 }));
    }
    cx += r.w;
  }
}

// GLUE-UP (final): complete board with faint glue-joint lines
function renderGlueupFinal(svg, snap, box) {
  const face = snap.workState.workpiece.face;
  const p = fitFace(face, box);
  drawLayout(svg, face, { x: p.ox, y: p.oy, w: p.dw, h: p.dh }, { stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.3 });

  svg.appendChild(rect(p.ox, p.oy, p.dw, p.dh, 'none', '#1c1917', 1));
}

// CROSSCUT: show the INPUT panel with red dashed cut lines
function renderCrosscut(svg, snap, prevSnap, box) {
  if (!prevSnap) return;
  const face = prevSnap.workState.workpiece.face;
  const p = fitFace(face, box);
  drawLayout(svg, face, { x: p.ox, y: p.oy, w: p.dw, h: p.dh });

  const { angle = 0, sliceThickness, sliceCount } = snap.op;
  const cutColor = '#c0392b';

  // Draw parallel cut lines at the given angle.
  // At 0°: horizontal lines. At θ > 0: diagonal lines with slope = tan(θ).
  // Lines are spaced by sliceThickness / cos(θ) in the vertical direction.
  const rad = angle * Math.PI / 180;
  const cosA = Math.cos(rad);
  const tanA = Math.tan(rad);
  const vertSpacing = sliceThickness / cosA * p.scale;
  const dx = p.dw * tanA; // how much the line rises across the panel width

  for (let i = 1; i < sliceCount; i++) {
    const baseY = p.oy + i * vertSpacing;
    svg.appendChild(line(
      p.ox - 4, baseY,
      p.ox + p.dw + 4, baseY - dx,
      cutColor, { dash: '4,3', sw: 1.2 }
    ));
  }

  // Dimension annotation: slice thickness
  if (sliceCount >= 2) {
    const label = `${sliceThickness}mm`;
    svg.appendChild(text(p.ox + p.dw + 6, p.oy + sliceThickness * p.scale / 2 + 3, label, { size: 7, fill: cutColor }));
  }
}

// STACK: slices oriented longest-edge-horizontal, stacked vertically.
function renderStack(svg, snap, box) {
  drawSliceStack(svg, snap.workState.slices, box, { gap: 3 });
}

// ROTATE 90°: same vertical stack, end-grain now visible.
function renderRotate90(svg, snap, box) {
  drawSliceStack(svg, snap.workState.slices, box, { gap: 3 });
  svg.appendChild(text(box.x + box.w - 2, box.y + 8, 'end grain ↑', { size: 6, anchor: 'end', fill: '#b45309' }));
}

// FLIP ALTERNATE: vertical stack with flip arrows on odd slices.
function renderFlipAlternate(svg, snap, box) {
  const { positions } = drawSliceStack(svg, snap.workState.slices, box, { gap: 3 });

  for (let i = 0; i < positions.length; i++) {
    if (i % 2 === 1) {
      const p = positions[i];
      const ax = p.x - 5;
      const ay = p.y + p.h / 2;
      svg.appendChild(line(ax - 4, ay, ax + 4, ay, '#b45309', { sw: 1 }));
      svg.appendChild(el('polygon', {
        points: `${ax - 4},${ay - 1.5} ${ax - 4},${ay + 1.5} ${ax - 7},${ay}`,
        fill: '#b45309',
      }));
      svg.appendChild(el('polygon', {
        points: `${ax + 4},${ay - 1.5} ${ax + 4},${ay + 1.5} ${ax + 7},${ay}`,
        fill: '#b45309',
      }));
    }
  }
}

// SHIFT ALTERNATE: vertical stack with visible stagger
function renderShiftAlternate(svg, snap, box) {
  const slices = snap.workState.slices;
  const { positions } = drawSliceStack(svg, slices, box);

  // Faint vertical alignment guides at first slice's seam positions
  if (positions.length >= 2) {
    const first = positions[0];
    const last = positions[positions.length - 1];
    const top = first.y;
    const bot = last.y + last.h;

    // Draw guides at 25% and 75% of first slice width
    for (const frac of [0.25, 0.5, 0.75]) {
      const gx = first.x + first.w * frac;
      svg.appendChild(line(gx, top, gx, bot, 'rgba(0,0,0,0.06)', { dash: '1,3', sw: 0.5 }));
    }
  }
}

// INSERT STRIPS: vertical stack with thin mortar strips visible + annotation
function renderInsertStrips(svg, snap, box) {
  const slices = snap.workState.slices;
  drawSliceStack(svg, slices, box, { gap: 1 });
}

// FLATTEN: board face with thickness annotation
function renderFlatten(svg, snap, prevSnap, box) {
  const face = snap.workState.workpiece.face;
  const innerBox = { ...box, h: box.h - 14 };
  const p = fitFace(face, innerBox);
  drawLayout(svg, face, { x: p.ox, y: p.oy, w: p.dw, h: p.dh });
  svg.appendChild(rect(p.ox, p.oy, p.dw, p.dh, 'none', '#1c1917', 0.8));

  const oldT = prevSnap?.workState?.workpiece?.thickness || '?';
  const newT = snap.workState.workpiece.thickness;
  svg.appendChild(text(p.ox + p.dw / 2, p.oy + p.dh + 12,
    `${oldT}mm → ${newT}mm`, { size: 7, anchor: 'middle', fill: '#78716c' }));
}

// TRIM: board with waste areas highlighted
function renderTrim(svg, snap, prevSnap, box) {
  const face = snap.workState.workpiece.face;
  const p = fitFace(face, box);

  // Draw the face
  drawLayout(svg, face, { x: p.ox, y: p.oy, w: p.dw, h: p.dh });

  // Trim boundary
  svg.appendChild(rect(p.ox, p.oy, p.dw, p.dh, 'none', '#c0392b', 1.5));

  // "trim" label
  svg.appendChild(text(p.ox + p.dw + 4, p.oy + p.dh / 2 + 3, 'trim', { size: 7, fill: '#c0392b' }));
}

// ─── Dispatcher ─────────────────────────────────────────────────────

export function renderStage(svg, snap, prevSnap, box) {
  const op = snap.op;

  if (op.type === 'glueup') {
    if (!prevSnap || prevSnap.workState.kind === 'panel' || !prevSnap) {
      renderGlueupInitial(svg, snap, box);
    } else {
      renderGlueupFinal(svg, snap, box);
    }
    return;
  }

  switch (op.type) {
    case 'crosscut':       return renderCrosscut(svg, snap, prevSnap, box);
    case 'stack':          return renderStack(svg, snap, box);
    case 'rotate90':       return renderRotate90(svg, snap, box);
    case 'flipAlternate':  return renderFlipAlternate(svg, snap, box);
    case 'shiftAlternate': return renderShiftAlternate(svg, snap, box);
    case 'insertStrips':   return renderInsertStrips(svg, snap, box);
    case 'flatten':        return renderFlatten(svg, snap, prevSnap, box);
    case 'trim':           return renderTrim(svg, snap, prevSnap, box);
    default:
      // Fallback: render the face directly
      if (snap.workState.kind === 'panel') {
        drawLayout(svg, snap.workState.workpiece.face, box);
      }
  }
}
