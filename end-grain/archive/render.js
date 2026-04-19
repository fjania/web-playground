// render.js — the ONE way a layout becomes pixels.
//
// Both the main DOM renderer and the thumbnail SVG-string renderer route
// through here so thumbnails and the final face always agree.

import { SPECIES } from './pipeline.js';

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// Draw a pure layout into an SVG DOM node, fitting inside `box`.
//   svg    : SVG element to append into
//   layout : { width, height, rects, polys } from layout.js
//   box    : { x, y, w, h } destination rectangle in svg user space
//   opts   : { stroke, strokeWidth }
// Returns the { ox, oy, scale, dw, dh } for the layout's placement.
export function drawLayout(svg, layout, box, opts = {}) {
  const stroke = opts.stroke ?? null;
  const strokeWidth = opts.strokeWidth ?? 0.5;
  const { width: lw, height: lh, rects, polys } = layout;
  const scale = Math.min(box.w / lw, box.h / lh);
  const dw = lw * scale, dh = lh * scale;
  const ox = box.x + (box.w - dw) / 2;
  const oy = box.y + (box.h - dh) / 2;
  const g = el('g');

  for (const r of rects) {
    const rect = el('rect', {
      x: ox + r.x * scale,
      y: oy + r.y * scale,
      width: r.w * scale,
      height: r.h * scale,
      fill: SPECIES[r.species].color,
    });
    if (stroke) {
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', strokeWidth);
    }
    rect.dataset.species = r.species;
    g.appendChild(rect);
  }
  for (const p of polys) {
    const poly = el('polygon', {
      points: p.points.map(([x, y]) => `${ox + x * scale},${oy + y * scale}`).join(' '),
      fill: SPECIES[p.species].color,
    });
    if (stroke) {
      poly.setAttribute('stroke', stroke);
      poly.setAttribute('stroke-width', strokeWidth);
    }
    poly.dataset.species = p.species;
    g.appendChild(poly);
  }
  svg.appendChild(g);
  return { ox, oy, scale, dw, dh };
}

// Render a layout to a self-contained SVG string. Used for pattern
// thumbnails — the same layout path as the main view, serialized.
export function layoutToSvgString(layout, viewW, viewH) {
  const { rects, polys, width: lw, height: lh } = layout;
  const scale = Math.min(viewW / lw, viewH / lh);
  const dw = lw * scale, dh = lh * scale;
  const ox = (viewW - dw) / 2;
  const oy = (viewH - dh) / 2;
  const parts = [`<svg viewBox="0 0 ${viewW} ${viewH}" xmlns="http://www.w3.org/2000/svg">`];
  for (const r of rects) {
    const x = ox + r.x * scale, y = oy + r.y * scale;
    const w = r.w * scale, h = r.h * scale;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${SPECIES[r.species].color}"/>`);
  }
  for (const p of polys) {
    const pts = p.points.map(([x, y]) => `${ox + x * scale},${oy + y * scale}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="${SPECIES[p.species].color}"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
