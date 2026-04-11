// End Grain - Cutting Board Designer
//
// This file handles: state, event wiring, and SVG rendering.
// All *pure* pattern math lives in pipeline.js (which is unit-tested).

import {
  SPECIES, PATTERNS,
  sum, boardDimensions,
  checkerboardGrid, brickLayout, chaosLayout,
  herringboneTiles, chevronBands, tumblingCubes,
  cutListText,
} from './pipeline.js';

const NS = 'http://www.w3.org/2000/svg';

// ---------- State ----------

// Defaults sized for a real ~12 × 16 inch cutting board, not a coaster.
// 8 strips × 35mm = 280mm wide; 12 slices × 35mm = 420mm long.
const DEFAULT_STRIPS = [
  { species: 'maple',  width: 35 },
  { species: 'walnut', width: 35 },
  { species: 'maple',  width: 35 },
  { species: 'walnut', width: 35 },
  { species: 'maple',  width: 35 },
  { species: 'walnut', width: 35 },
  { species: 'maple',  width: 35 },
  { species: 'walnut', width: 35 },
];

const state = {
  pattern: 'checkerboard',
  strips: clone(DEFAULT_STRIPS),
  cutAngle: 0,
  sliceThickness: 35,
  numSlices: 12,
  pass2: { enabled: false, cellShift: 2 },
  chaosSeed: 42,
  brickOffset: 0.5, // 0.5 = running bond, 0.333 = third bond, 0.25 = quarter
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ---------- Presets ----------

const PRESETS = [
  {
    name: 'classic checker',
    pattern: 'checkerboard',
    strips: [['maple', 30], ['walnut', 30], ['maple', 30], ['walnut', 30], ['maple', 30], ['walnut', 30]],
    sliceThickness: 30, numSlices: 6,
  },
  {
    name: 'tri-color brick',
    pattern: 'brick',
    strips: [['maple', 25], ['walnut', 25], ['cherry', 25], ['maple', 25], ['walnut', 25], ['cherry', 25]],
    sliceThickness: 25, numSlices: 8,
  },
  {
    name: 'purple accent',
    pattern: 'checkerboard',
    strips: [['maple', 30], ['purpleheart', 15], ['maple', 30], ['walnut', 30], ['maple', 30], ['purpleheart', 15]],
    sliceThickness: 30, numSlices: 7,
  },
  {
    name: 'wide herringbone',
    pattern: 'herringbone',
    strips: [['maple', 40], ['walnut', 40], ['maple', 40], ['walnut', 40]],
    sliceThickness: 40, numSlices: 6,
  },
  {
    name: 'padauk chevron',
    pattern: 'chevron',
    strips: [['padauk', 30], ['maple', 30], ['padauk', 30], ['maple', 30], ['padauk', 30], ['maple', 30]],
    sliceThickness: 30, numSlices: 6,
  },
  {
    name: 'tumbling blocks',
    pattern: 'tumbling',
    strips: [['maple', 30], ['cherry', 30], ['walnut', 30]],
    sliceThickness: 30, numSlices: 6,
  },
  {
    name: 'contrast chaos',
    pattern: 'chaos',
    strips: [['maple', 30], ['walnut', 30], ['purpleheart', 30], ['cherry', 30]],
    sliceThickness: 25, numSlices: 8,
  },
  {
    name: 'wenge & oak',
    pattern: 'brick',
    strips: [['white_oak', 35], ['wenge', 20], ['white_oak', 35], ['wenge', 20], ['white_oak', 35], ['wenge', 20]],
    sliceThickness: 28, numSlices: 7,
  },
];

// ---------- SVG helpers ----------

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function svgRect(x, y, w, h, fill, stroke = null, sw = 0.6, species = null) {
  const r = el('rect', { x, y, width: w, height: h, fill });
  if (stroke) { r.setAttribute('stroke', stroke); r.setAttribute('stroke-width', sw); }
  if (species) r.dataset.species = species;
  return r;
}
function svgLine(x1, y1, x2, y2, stroke, dash = null, sw = 1.5) {
  const l = el('line', { x1, y1, x2, y2, stroke, 'stroke-width': sw });
  if (dash) l.setAttribute('stroke-dasharray', dash);
  return l;
}
function svgText(x, y, str, opts = {}) {
  const t = el('text', {
    x, y,
    'font-family': 'Geist Mono, monospace',
    'font-size': 10,
    fill: '#a8a29e',
    ...opts,
  });
  t.textContent = str;
  return t;
}
function svgPoly(points, fill, stroke = '#1c1917', sw = 0.6) {
  return el('polygon', {
    points: points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
    fill, stroke, 'stroke-width': sw,
  });
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function clippedGroup(svg, id, ox, oy, w, h) {
  const defs = el('defs');
  const clip = el('clipPath', { id });
  clip.appendChild(svgRect(ox, oy, w, h, 'black'));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const g = el('g', { 'clip-path': `url(#${id})` });
  svg.appendChild(g);
  return g;
}

// ---------- Master render ----------

function render() {
  renderStripList();
  renderGlueup();
  renderCut();
  renderPass2();
  renderFinal();
  renderRuleInfo();
  updatePatternCardActive();
  updatePass2UI();
  updateChaosUI();
}

// ---------- Strip editor (list + drag reorder) ----------

let dragFromIdx = -1;

function renderStripList() {
  const list = document.getElementById('stripList');
  list.innerHTML = '';
  state.strips.forEach((strip, i) => {
    const row = document.createElement('div');
    row.className = 'strip-row';
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML = `
      <span class="strip-handle" aria-hidden="true">≡</span>
      <button class="strip-swatch" data-idx="${i}" aria-label="change species"
              style="background:${SPECIES[strip.species].color}"></button>
      <span class="strip-name">${strip.species}</span>
      <input class="strip-width" type="number" min="10" max="80" value="${strip.width}"
             data-idx="${i}" aria-label="strip width in mm">
      <button class="strip-delete" data-idx="${i}" aria-label="remove strip">×</button>
    `;
    list.appendChild(row);
  });
  document.getElementById('stripCount').textContent = `${state.strips.length} strips`;

  // Swatch click → species popover
  list.querySelectorAll('.strip-swatch').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openSpeciesPopover(btn, +btn.dataset.idx); };
  });

  // Width input
  list.querySelectorAll('.strip-width').forEach(inp => {
    inp.oninput = () => {
      const i = +inp.dataset.idx;
      state.strips[i].width = Math.max(10, Math.min(80, +inp.value || 30));
      renderGlueup(); renderCut(); renderPass2(); renderFinal();
    };
  });

  // Delete button
  list.querySelectorAll('.strip-delete').forEach(btn => {
    btn.onclick = () => {
      if (state.strips.length <= 2) return;
      state.strips.splice(+btn.dataset.idx, 1);
      render();
    };
  });

  // Drag & drop reorder
  list.querySelectorAll('.strip-row').forEach(row => {
    row.ondragstart = (e) => {
      dragFromIdx = +row.dataset.idx;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    };
    row.ondragend = () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.drop-above, .drop-below').forEach(el =>
        el.classList.remove('drop-above', 'drop-below'));
    };
    row.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      row.classList.toggle('drop-above', above);
      row.classList.toggle('drop-below', !above);
    };
    row.ondragleave = () => {
      row.classList.remove('drop-above', 'drop-below');
    };
    row.ondrop = (e) => {
      e.preventDefault();
      const toIdx = +row.dataset.idx;
      if (dragFromIdx < 0 || dragFromIdx === toIdx) return;
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      const insertAt = above ? toIdx : toIdx + 1;
      const [moved] = state.strips.splice(dragFromIdx, 1);
      const adjusted = insertAt > dragFromIdx ? insertAt - 1 : insertAt;
      state.strips.splice(adjusted, 0, moved);
      dragFromIdx = -1;
      render();
    };
  });
}

// ---------- Stage 1: Glue-up ----------

function renderGlueup() {
  const svg = document.getElementById('svgGlueup');
  clear(svg);
  const W = 600, H = 200, pad = 28;
  const totalW = sum(state.strips.map(s => s.width));
  const boardLen = state.numSlices * state.sliceThickness;

  const scale = Math.min((W - pad * 2) / boardLen, (H - pad * 2) / totalW);
  const w = boardLen * scale, h = totalW * scale;
  const ox = (W - w) / 2, oy = (H - h) / 2;

  svg.appendChild(svgRect(ox + 3, oy + 3, w, h, 'rgba(28,25,23,0.08)'));

  // Each strip is clickable: click cycles through the species palette.
  let y = oy;
  state.strips.forEach((strip, i) => {
    const sh = strip.width * scale;
    const r = svgRect(ox, y, w, sh, SPECIES[strip.species].color, '#1c1917');
    r.style.cursor = 'pointer';
    r.dataset.stripIdx = i;
    r.addEventListener('click', (ev) => {
      ev.stopPropagation();
      cycleSpecies(i);
    });
    r.addEventListener('mouseenter', () => highlightStrip(i));
    r.addEventListener('mouseleave', () => highlightStrip(-1));
    svg.appendChild(r);
    y += sh;
  });

  svg.appendChild(svgText(ox, oy - 10, `length ${boardLen}mm →`));
  svg.appendChild(svgText(ox - 8, oy + h / 2 + 3, `${totalW}mm`, { 'text-anchor': 'end' }));
}

// Cycle a strip's species through the palette in order.
function cycleSpecies(idx) {
  const keys = Object.keys(SPECIES);
  const cur = keys.indexOf(state.strips[idx].species);
  state.strips[idx].species = keys[(cur + 1) % keys.length];
  render();
}

// Highlight all cells in the final-face that come from the given strip index.
// Adds an outline + dim-others effect; idx < 0 clears the highlight.
function highlightStrip(idx) {
  const finalSvg = document.getElementById('svgFinal');
  const rects = finalSvg.querySelectorAll('rect[data-species]');
  rects.forEach(r => {
    if (idx < 0) {
      r.style.opacity = '';
      r.style.strokeWidth = '';
      r.style.stroke = '';
    } else if (r.dataset.species === state.strips[idx].species) {
      r.style.opacity = '1';
      r.style.stroke = '#b45309';
      r.style.strokeWidth = '1.5';
    } else {
      r.style.opacity = '0.45';
    }
  });
}

// ---------- Stage 2: Crosscut ----------

function renderCut() {
  const svg = document.getElementById('svgCut');
  clear(svg);
  const W = 600, H = 200, pad = 28;
  const totalW = sum(state.strips.map(s => s.width));
  const boardLen = state.numSlices * state.sliceThickness;

  const scale = Math.min((W - pad * 2) / boardLen, (H - pad * 2) / totalW);
  const w = boardLen * scale, h = totalW * scale;
  const ox = (W - w) / 2, oy = (H - h) / 2;

  let y = oy;
  state.strips.forEach((strip) => {
    const sh = strip.width * scale;
    svg.appendChild(svgRect(ox, y, w, sh, SPECIES[strip.species].color, '#1c1917'));
    y += sh;
  });

  const slice = state.sliceThickness * scale;
  const rad = state.cutAngle * Math.PI / 180;
  const dx = h * Math.tan(rad);

  for (let i = 1; i < state.numSlices; i++) {
    const cx = ox + i * slice;
    svg.appendChild(svgLine(cx - dx / 2, oy, cx + dx / 2, oy + h, '#b45309', '4,3', 1.6));
  }

  for (let i = 0; i < state.numSlices; i++) {
    svg.appendChild(svgText(ox + i * slice + slice / 2, oy + h + 16,
      `${i + 1}`, { 'text-anchor': 'middle', fill: '#a8a29e' }));
  }

  svg.appendChild(svgText(ox, oy - 10,
    `${state.numSlices} slices × ${state.sliceThickness}mm` + (state.cutAngle ? ` @ ${state.cutAngle}°` : '')));
}

// ---------- Pass-2 preview ----------

function renderPass2() {
  if (!state.pass2.enabled) return;
  const svg = document.getElementById('svgPass2');
  if (!svg) return;
  clear(svg);
  const W = 600, H = 200, pad = 24;

  const totalW = sum(state.strips.map(s => s.width));
  const totalH = state.numSlices * state.sliceThickness;
  const scale = Math.min((W - pad * 2) / totalH, (H - pad * 2) / totalW);
  // Display the pass-1 face on its side (long dimension horizontal) so the
  // pass-2 cuts (vertical lines) make visual sense as a second crosscut.
  const w = totalH * scale, h = totalW * scale;
  const ox = (W - w) / 2, oy = (H - h) / 2;

  // Underlay: render whichever pass-1 layout matches the current pattern,
  // not always a checkerboard. We rotate the layout 90° (transpose rows/cols)
  // so it sits horizontally in this card.
  const N = state.strips.length;
  let grid;
  if (state.pattern === 'brick') {
    const rows = brickLayout(state.strips, state.numSlices, null, state.brickOffset);
    // Project to a uniform grid for the underlay only
    grid = rows.map(r => r.cells);
  } else if (state.pattern === 'chaos') {
    // Just show the strip palette repeated; chaos layout has variable cells
    grid = Array.from({ length: state.numSlices }, (_, k) =>
      state.strips.map((_, j) => state.strips[(j + k) % N].species));
  } else {
    grid = checkerboardGrid(state.strips, state.numSlices);
  }

  const colW = w / state.numSlices;
  let yy = oy;
  state.strips.forEach((strip, rowIdx) => {
    const cellH = strip.width * scale;
    for (let col = 0; col < state.numSlices; col++) {
      const species = (grid[col] && grid[col][rowIdx]) || strip.species;
      svg.appendChild(svgRect(ox + col * colW, yy, colW, cellH,
        SPECIES[species].color, 'rgba(28,25,23,0.25)'));
    }
    yy += cellH;
  });

  // Pass-2 cuts: draw exactly `numSlices` evenly-spaced cut lines, the same
  // count as pass 1. The shift is conveyed by the *direction arrow* below,
  // not by changing slice count (which would be misleading).
  const cuts = state.numSlices;
  const step = w / cuts;
  for (let i = 1; i < cuts; i++) {
    const cx = ox + i * step;
    svg.appendChild(svgLine(cx, oy - 4, cx, oy + h + 4, '#b45309', '4,3', 1.6));
  }

  svg.appendChild(svgText(ox, oy - 8,
    `crosscut perpendicular, shift each slice ${state.pass2.cellShift} cells →`));
}

// Pass 2 only meaningfully affects grid patterns. The herringbone, chevron,
// and tumbling renderers don't consume the shift, so we hide the toggle for
// those to avoid suggesting it does something it doesn't.
const PASS2_PATTERNS = new Set(['checkerboard', 'brick', 'chaos']);

function updatePass2UI() {
  const stage = document.getElementById('pass2Stage');
  const toggle = document.getElementById('pass2Toggle');
  const pipeline = document.getElementById('pipeline');
  const supports = PASS2_PATTERNS.has(state.pattern);
  // If pattern was switched away from a grid pattern while pass-2 was active,
  // disable pass-2 silently.
  if (!supports && state.pass2.enabled) state.pass2.enabled = false;
  stage.hidden = !state.pass2.enabled;
  toggle.classList.toggle('hidden', state.pass2.enabled || !supports);
  pipeline.classList.toggle('has-pass2', state.pass2.enabled);
  document.getElementById('finalPasses').textContent = state.pass2.enabled ? '2' : '1';
}

// ---------- Chaos seed UI ----------

function updateChaosUI() {
  const panel = document.getElementById('chaosPanel');
  if (panel) panel.hidden = state.pattern !== 'chaos';
  const brickPanel = document.getElementById('brickPanel');
  if (brickPanel) brickPanel.hidden = state.pattern !== 'brick';
}

// ---------- Stage 3: Final end-grain face ----------

function renderFinal() {
  const svg = document.getElementById('svgFinal');
  clear(svg);
  const W = 600, H = 500, pad = 28;

  const totalW = sum(state.strips.map(s => s.width));
  const totalH = state.numSlices * state.sliceThickness;

  const scale = Math.min((W - pad * 2) / totalW, (H - pad * 2) / totalH);
  const w = totalW * scale, h = totalH * scale;
  const ox = (W - w) / 2, oy = (H - h) / 2;

  // Define an end-grain texture pattern: subtle concentric rings + radial dot.
  // This is what makes "end grain" actually look like end grain.
  const defs = el('defs');
  const grain = el('pattern', {
    id: 'endgrain', x: 0, y: 0, width: 30, height: 30, patternUnits: 'userSpaceOnUse',
  });
  grain.innerHTML = `
    <circle cx="15" cy="15" r="13" fill="none" stroke="#000" stroke-width="0.4" stroke-opacity="0.10"/>
    <circle cx="15" cy="15" r="9"  fill="none" stroke="#000" stroke-width="0.4" stroke-opacity="0.08"/>
    <circle cx="15" cy="15" r="5"  fill="none" stroke="#000" stroke-width="0.4" stroke-opacity="0.10"/>
    <circle cx="15" cy="15" r="1.2" fill="#000" fill-opacity="0.18"/>
  `;
  defs.appendChild(grain);
  svg.appendChild(defs);

  // Subtle shadow
  svg.appendChild(svgRect(ox + 4, oy + 4, w, h, 'rgba(28,25,23,0.12)'));

  if      (state.pattern === 'checkerboard') renderCheckerFinal(svg, ox, oy, scale);
  else if (state.pattern === 'brick')        renderBrickFinalSvg(svg, ox, oy, scale);
  else if (state.pattern === 'herringbone')  renderHerringboneFinalSvg(svg, ox, oy, w, h);
  else if (state.pattern === 'chevron')      renderChevronFinalSvg(svg, ox, oy, w, h);
  else if (state.pattern === 'tumbling')     renderTumblingFinalSvg(svg, ox, oy, w, h);
  else if (state.pattern === 'chaos')        renderChaosFinalSvg(svg, ox, oy, scale);

  // End-grain texture overlay (skip on tumbling — its top faces aren't end grain)
  if (state.pattern !== 'tumbling') {
    svg.appendChild(svgRect(ox, oy, w, h, 'url(#endgrain)'));
  }

  // Strong border around the board
  svg.appendChild(svgRect(ox, oy, w, h, 'none', '#1c1917', 1.5));

  // Update footer metadata
  document.getElementById('finalSize').textContent = `${totalW} × ${totalH} mm`;
  const speciesSet = [...new Set(state.strips.map(s => s.species))];
  document.getElementById('finalSpecies').textContent = speciesSet.join(' + ');
}

function renderCheckerFinal(svg, ox, oy, scale) {
  const grid = checkerboardGrid(state.strips, state.numSlices, state.pass2);
  const ss = state.sliceThickness * scale;
  for (let row = 0; row < grid.length; row++) {
    const y = oy + row * ss;
    let x = ox;
    for (let col = 0; col < grid[row].length; col++) {
      const species = grid[row][col];
      const sw = state.strips[col % state.strips.length].width * scale;
      svg.appendChild(svgRect(x, y, sw, ss, SPECIES[species].color, 'rgba(28,25,23,0.35)', 0.6, species));
      x += sw;
    }
  }
}

function renderBrickFinalSvg(svg, ox, oy, scale) {
  const rows = brickLayout(state.strips, state.numSlices, state.pass2, state.brickOffset);
  const ss = state.sliceThickness * scale;
  const totalW = sum(state.strips.map(s => s.width)) * scale;
  // Average strip width — used for the offset step. Brick patterns with
  // wildly varying strip widths look best when the offset is consistent
  // (matching the overall cell pitch) rather than tied to strip[0].
  const avgW = totalW / state.strips.length;

  // Clip rect so partial cells at row ends don't overflow.
  const clipId = 'brick-clip';
  // Reuse a stable id; clear() before render guarantees no conflict.
  const defs = el('defs');
  const clip = el('clipPath', { id: clipId });
  clip.appendChild(svgRect(ox, oy, totalW, state.numSlices * ss, 'black'));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const g = el('g', { 'clip-path': `url(#${clipId})` });
  svg.appendChild(g);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const y = oy + r * ss;
    const xOff = -row.offsetFraction * avgW;
    // Tile the row twice (start at -1×rowWidth so wraparound is covered).
    for (let pass = 0; pass <= 1; pass++) {
      let x = ox + xOff + pass * totalW;
      for (let j = 0; j < row.cells.length; j++) {
        const sw = state.strips[j].width * scale;
        const sp = row.cells[j];
        g.appendChild(svgRect(x, y, sw, ss, SPECIES[sp].color, 'rgba(28,25,23,0.35)', 0.6, sp));
        x += sw;
      }
    }
  }
}

function renderHerringboneFinalSvg(svg, ox, oy, w, h) {
  const g = clippedGroup(svg, 'hbClip', ox, oy, w, h);
  g.appendChild(svgRect(ox, oy, w, h, SPECIES[state.strips[0].species].color));

  // Real herringbone: 2:1 rectangles in two perpendicular orientations.
  // Unit scales with strip width so the pattern reads at any board size.
  const unit = Math.max(20, Math.min(40, state.strips[0].width * 0.8));
  const tiles = herringboneTiles(state.strips, w, h, unit);
  tiles.forEach(t => {
    g.appendChild(svgRect(ox + t.x, oy + t.y, t.w, t.h, SPECIES[t.species].color, '#1c1917', 0.6, t.species));
  });
}

function renderChevronFinalSvg(svg, ox, oy, w, h) {
  const g = clippedGroup(svg, 'cvClip', ox, oy, w, h);
  g.appendChild(svgRect(ox, oy, w, h, SPECIES[state.strips[0].species].color));

  const bands = chevronBands(state.strips, w, h, 34);
  bands.forEach(b => {
    const color = SPECIES[b.color].color;
    const left = b.left.map(([x, y]) => [ox + x, oy + y]);
    const right = b.right.map(([x, y]) => [ox + x, oy + y]);
    g.appendChild(svgPoly(left, color));
    g.appendChild(svgPoly(right, color));
  });
}

function renderTumblingFinalSvg(svg, ox, oy, w, h) {
  const g = clippedGroup(svg, 'tbClip', ox, oy, w, h);
  // Warm beige background (visible behind cube grid)
  g.appendChild(svgRect(ox, oy, w, h, '#f0e8d4'));

  const cubes = tumblingCubes(state.strips, w, h, 20);
  cubes.forEach(c => {
    const shift = ([x, y]) => [ox + x, oy + y];
    // Draw back-to-front: left, right, top
    g.appendChild(svgPoly(c.left.points.map(shift),  darken(SPECIES[c.left.species].color, 0.7)));
    g.appendChild(svgPoly(c.right.points.map(shift), darken(SPECIES[c.right.species].color, 0.85)));
    g.appendChild(svgPoly(c.top.points.map(shift),   SPECIES[c.top.species].color));
  });
}

function renderChaosFinalSvg(svg, ox, oy, scale) {
  const layout = chaosLayout(state.strips, state.numSlices, state.sliceThickness, state.chaosSeed, state.pass2);
  const ss = state.sliceThickness * scale;
  for (let r = 0; r < layout.cells.length; r++) {
    const y = oy + r * ss;
    let x = ox;
    for (let c = 0; c < layout.cells[r].length; c++) {
      const sw = layout.widths[r][c] * scale;
      const species = layout.cells[r][c];
      svg.appendChild(svgRect(x, y, sw, ss, SPECIES[species].color, 'rgba(28,25,23,0.35)', 0.6, species));
      x += sw;
    }
  }
}

function darken(hex, factor) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const [r, g, b] = [1, 2, 3].map(i => Math.round(parseInt(m[i], 16) * factor));
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------- Pattern thumbnails ----------

function renderThumbs() {
  document.querySelectorAll('.pattern-thumb').forEach(t => {
    t.innerHTML = thumbSvg(t.dataset.thumb);
  });
}

function thumbSvg(pattern) {
  const c1 = '#e4cc8f', c2 = '#3d2416';
  if (pattern === 'checkerboard') {
    let s = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">`;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      s += `<rect x="${j * 10}" y="${i * 10}" width="10" height="10" fill="${(i + j) % 2 ? c1 : c2}"/>`;
    }
    return s + `</svg>`;
  }
  if (pattern === 'brick') {
    let s = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" fill="${c2}"/>`;
    for (let i = 0; i < 4; i++) {
      const off = (i % 2) * 6;
      for (let j = -1; j < 5; j++) {
        s += `<rect x="${j * 12 + off}" y="${i * 10 + 0.5}" width="11" height="9" fill="${c1}" stroke="${c2}" stroke-width="0.6"/>`;
      }
    }
    return s + `</svg>`;
  }
  if (pattern === 'herringbone') {
    // Tiny rotated brick preview
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="${c1}"/>
      <g transform="rotate(45 20 20)" stroke="#1c1917" stroke-width="0.3">
        <rect x="-20" y="0"  width="16" height="8" fill="${c2}"/>
        <rect x="-4"  y="0"  width="16" height="8" fill="${c1}"/>
        <rect x="12"  y="0"  width="16" height="8" fill="${c2}"/>
        <rect x="-12" y="8"  width="16" height="8" fill="${c1}"/>
        <rect x="4"   y="8"  width="16" height="8" fill="${c2}"/>
        <rect x="20"  y="8"  width="16" height="8" fill="${c1}"/>
        <rect x="-20" y="16" width="16" height="8" fill="${c2}"/>
        <rect x="-4"  y="16" width="16" height="8" fill="${c1}"/>
        <rect x="12"  y="16" width="16" height="8" fill="${c2}"/>
        <rect x="-12" y="24" width="16" height="8" fill="${c1}"/>
        <rect x="4"   y="24" width="16" height="8" fill="${c2}"/>
        <rect x="20"  y="24" width="16" height="8" fill="${c1}"/>
      </g>
    </svg>`;
  }
  if (pattern === 'chevron') {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="${c1}"/>
      <g stroke="#1c1917" stroke-width="0.4">
        <polygon points="0,6 20,-4 20,4 0,14" fill="${c2}"/>
        <polygon points="40,6 20,-4 20,4 40,14" fill="${c2}"/>
        <polygon points="0,22 20,12 20,20 0,30" fill="${c2}"/>
        <polygon points="40,22 20,12 20,20 40,30" fill="${c2}"/>
        <polygon points="0,38 20,28 20,36 0,46" fill="${c2}"/>
        <polygon points="40,38 20,28 20,36 40,46" fill="${c2}"/>
      </g>
    </svg>`;
  }
  if (pattern === 'tumbling') {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f0e8d4"/>
      <g stroke="#1c1917" stroke-width="0.5">
        <polygon points="20,5 33,12 20,20 7,12" fill="${c1}"/>
        <polygon points="20,20 33,12 33,27 20,35" fill="#8a6f35"/>
        <polygon points="20,20 7,12 7,27 20,35" fill="${c2}"/>
      </g>
    </svg>`;
  }
  if (pattern === 'chaos') {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect x="0"  y="0"  width="14" height="18" fill="${c1}"/>
      <rect x="14" y="0"  width="12" height="12" fill="${c2}"/>
      <rect x="26" y="0"  width="14" height="22" fill="${c1}"/>
      <rect x="0"  y="18" width="10" height="22" fill="${c2}"/>
      <rect x="10" y="12" width="18" height="16" fill="${c1}"/>
      <rect x="10" y="28" width="14" height="12" fill="${c2}"/>
      <rect x="24" y="22" width="16" height="18" fill="${c1}"/>
    </svg>`;
  }
  return '';
}

// ---------- Sidebar info ----------

function renderRuleInfo() {
  let label = PATTERNS[state.pattern].label;
  if (state.pattern === 'brick') {
    if (state.brickOffset === 0.5)         label = '½ cell (running bond)';
    else if (Math.abs(state.brickOffset - 1 / 3) < 0.01) label = '⅓ cell (third bond)';
    else if (state.brickOffset === 0.25)   label = '¼ cell (quarter bond)';
  }
  if (state.pattern === 'chaos') {
    label = `seed ${state.chaosSeed}`;
  }
  document.getElementById('ruleValue').textContent = label;
}

function updatePatternCardActive() {
  document.querySelectorAll('.pattern-card').forEach(c => {
    c.classList.toggle('active', c.dataset.pattern === state.pattern);
  });
}

// ---------- Species popover ----------

let popoverTargetIdx = -1;
function openSpeciesPopover(anchor, idx) {
  popoverTargetIdx = idx;
  const pop = document.getElementById('speciesPopover');
  const r = anchor.getBoundingClientRect();
  pop.style.left = (r.left + window.scrollX) + 'px';
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
  pop.hidden = false;

  const grid = document.getElementById('speciesGrid');
  grid.innerHTML = '';
  Object.entries(SPECIES).forEach(([key, sp]) => {
    const b = document.createElement('button');
    b.className = 'species-option';
    b.innerHTML = `<span class="sw" style="background:${sp.color}"></span>${sp.name}`;
    b.onclick = () => {
      state.strips[popoverTargetIdx].species = key;
      pop.hidden = true;
      render();
    };
    grid.appendChild(b);
  });
}

document.addEventListener('click', (e) => {
  const pop = document.getElementById('speciesPopover');
  if (!pop.hidden && !pop.contains(e.target) && !e.target.classList.contains('strip-swatch')) {
    pop.hidden = true;
  }
  const exp = document.getElementById('exportMenu');
  if (exp && !exp.hidden && !exp.contains(e.target) && e.target.id !== 'exportBtn') {
    exp.hidden = true;
  }
});

// ---------- Presets ----------

function renderPresets() {
  const list = document.getElementById('presetList');
  list.innerHTML = '';
  PRESETS.forEach((preset, i) => {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.innerHTML = `
      <span class="preset-thumb" data-preset="${i}"></span>
      <span class="preset-name">${preset.name}</span>
    `;
    b.onclick = () => applyPreset(preset);
    list.appendChild(b);
  });
  // Render preset thumbnails as mini-previews of their final patterns
  document.querySelectorAll('.preset-thumb').forEach(t => {
    const preset = PRESETS[+t.dataset.preset];
    t.innerHTML = thumbSvg(preset.pattern);
  });
}

function applyPreset(preset) {
  state.pattern = preset.pattern;
  state.strips = preset.strips.map(([species, width]) => ({ species, width }));
  state.sliceThickness = preset.sliceThickness;
  state.numSlices = preset.numSlices;
  state.cutAngle = PATTERNS[preset.pattern].defaultAngle;
  state.pass2 = { enabled: false, cellShift: 2 };
  state.brickOffset = 0.5;
  state.chaosSeed = 42;

  document.getElementById('angleInput').value = state.cutAngle;
  document.getElementById('angleValue').textContent = `${state.cutAngle}°`;
  document.getElementById('thicknessInput').value = state.sliceThickness;
  document.getElementById('thicknessValue').textContent = `${state.sliceThickness}mm`;
  document.getElementById('slicesInput').value = state.numSlices;
  document.getElementById('slicesValue').textContent = `${state.numSlices}`;
  if (seedInput) {
    seedInput.value = 42;
    document.getElementById('chaosSeedValue').textContent = '42';
  }
  document.querySelectorAll('[data-brick]').forEach(b => b.classList.remove('active'));
  const half = document.querySelector('[data-brick="0.5"]');
  if (half) half.classList.add('active');

  render();
}

// ---------- Export ----------

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCutList() {
  const txt = cutListText(state);
  downloadBlob(txt, `cutting-board-${state.pattern}.txt`, 'text/plain');
}

function exportSvg() {
  const svg = document.getElementById('svgFinal');
  const serializer = new XMLSerializer();
  let src = serializer.serializeToString(svg);
  if (!src.match(/^<svg[^>]+xmlns="[^"]+"/)) {
    src = src.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const wrapped = `<?xml version="1.0" encoding="UTF-8"?>\n${src}`;
  downloadBlob(wrapped, `cutting-board-${state.pattern}.svg`, 'image/svg+xml');
}

async function copyCutList() {
  const txt = cutListText(state);
  try {
    await navigator.clipboard.writeText(txt);
    flashStatus('copied to clipboard');
  } catch {
    flashStatus('copy failed');
  }
}

function flashStatus(msg) {
  const el = document.getElementById('flashStatus');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- Event wiring ----------

document.getElementById('patternGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.pattern-card');
  if (!card || card.disabled) return;
  const pat = card.dataset.pattern;
  if (!PATTERNS[pat]) return;
  state.pattern = pat;
  state.cutAngle = PATTERNS[pat].defaultAngle;
  document.getElementById('angleInput').value = state.cutAngle;
  document.getElementById('angleValue').textContent = `${state.cutAngle}°`;
  render();
});

document.getElementById('addStripBtn').onclick = () => {
  const last = state.strips[state.strips.length - 1];
  const next = last.species === 'maple' ? 'walnut' : 'maple';
  state.strips.push({ species: next, width: 30 });
  render();
};

[
  ['angle', 'cutAngle', v => `${v}°`],
  ['thickness', 'sliceThickness', v => `${v}mm`],
  ['slices', 'numSlices', v => `${v}`],
].forEach(([key, prop, fmt]) => {
  const inp = document.getElementById(key + 'Input');
  inp.oninput = () => {
    state[prop] = +inp.value;
    document.getElementById(key + 'Value').textContent = fmt(state[prop]);
    renderGlueup(); renderCut(); renderPass2(); renderFinal();
  };
});

// Pass 2 controls
document.getElementById('pass2Toggle').onclick = () => {
  state.pass2.enabled = true;
  render();
};
document.getElementById('removePass2').onclick = () => {
  state.pass2.enabled = false;
  render();
};
document.getElementById('pass2ShiftInput').oninput = (e) => {
  state.pass2.cellShift = +e.target.value;
  document.getElementById('pass2ShiftValue').textContent = `${state.pass2.cellShift} cells`;
  renderPass2(); renderFinal();
};

// Brick offset segmented control
document.querySelectorAll('[data-brick]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('[data-brick]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.brickOffset = +btn.dataset.brick;
    renderFinal();
    renderRuleInfo();
  };
});

// Chaos seed
const seedInput = document.getElementById('chaosSeedInput');
if (seedInput) {
  seedInput.oninput = (e) => {
    state.chaosSeed = +e.target.value;
    document.getElementById('chaosSeedValue').textContent = state.chaosSeed;
    renderFinal();
    renderRuleInfo();
  };
  document.getElementById('chaosRerollBtn').onclick = () => {
    state.chaosSeed = Math.floor(Math.random() * 1000);
    seedInput.value = state.chaosSeed;
    document.getElementById('chaosSeedValue').textContent = state.chaosSeed;
    renderFinal();
    renderRuleInfo();
  };
}

const DEFAULT_STATE = {
  pattern: 'checkerboard',
  cutAngle: 0,
  sliceThickness: 35,
  numSlices: 12,
  brickOffset: 0.5,
  pass2: { enabled: false, cellShift: 2 },
  chaosSeed: 42,
};

document.getElementById('resetBtn').onclick = () => {
  Object.assign(state, clone(DEFAULT_STATE));
  state.strips = clone(DEFAULT_STRIPS);
  state.pass2 = { enabled: false, cellShift: 2 };
  document.getElementById('pass2ShiftInput').value = 2;
  document.getElementById('pass2ShiftValue').textContent = '2 cells';
  document.getElementById('angleInput').value = state.cutAngle;
  document.getElementById('thicknessInput').value = state.sliceThickness;
  document.getElementById('slicesInput').value = state.numSlices;
  document.getElementById('angleValue').textContent = `${state.cutAngle}°`;
  document.getElementById('thicknessValue').textContent = `${state.sliceThickness}mm`;
  document.getElementById('slicesValue').textContent = `${state.numSlices}`;
  if (seedInput) {
    seedInput.value = state.chaosSeed;
    document.getElementById('chaosSeedValue').textContent = `${state.chaosSeed}`;
  }
  // Reset brick offset segmented control
  document.querySelectorAll('[data-brick]').forEach(b => b.classList.remove('active'));
  const half = document.querySelector('[data-brick="0.5"]');
  if (half) half.classList.add('active');
  render();
};

// Export menu
document.getElementById('exportBtn').onclick = (e) => {
  e.stopPropagation();
  const menu = document.getElementById('exportMenu');
  const rect = e.target.getBoundingClientRect();
  menu.style.left = (rect.right + window.scrollX - 180) + 'px';
  menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  menu.hidden = !menu.hidden;
};
document.getElementById('exportTxtBtn').onclick = () => { exportCutList(); document.getElementById('exportMenu').hidden = true; };
document.getElementById('exportSvgBtn').onclick = () => { exportSvg(); document.getElementById('exportMenu').hidden = true; };
document.getElementById('exportCopyBtn').onclick = () => { copyCutList(); document.getElementById('exportMenu').hidden = true; };

// ---------- Init ----------

renderThumbs();
renderPresets();
render();
