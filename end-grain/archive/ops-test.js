// ops-test.js — test each operation in isolation.
// Each row creates its own input, applies one operation, shows input → op → output.

import { evaluate, expandStrips } from './evaluate.js';
import { drawLayout } from './render.js';
import { renderStage } from './stage-renderers.js';
import { SPECIES } from './pipeline.js';

const NS = 'http://www.w3.org/2000/svg';

const defaultStrips = {
  unit: [{ species: 'maple', width: 25 }, { species: 'walnut', width: 25 }],
  repeat: 4,
};

// Helper: run a mini-pipeline and return the last workState
function run(ops, sp = defaultStrips, stockT = 25) {
  const snaps = evaluate(sp, ops, stockT);
  return snaps[snaps.length - 1].workState;
}

// Each test: { name, inputOps (pipeline to create the input), op (the operation to test), stripPattern?, stockThickness? }
const tests = [
  {
    name: 'glueup (initial)',
    inputOps: [],
    op: { type: 'glueup' },
  },
  {
    name: 'crosscut 0°',
    inputOps: [{ type: 'glueup' }],
    op: { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 },
  },
  {
    name: 'crosscut 20°',
    inputOps: [{ type: 'glueup' }],
    op: { type: 'crosscut', angle: 20, sliceThickness: 35, sliceCount: 6 },
  },
  {
    name: 'crosscut 45°',
    inputOps: [{ type: 'glueup' }],
    op: { type: 'crosscut', angle: 45, sliceThickness: 35, sliceCount: 6 },
  },
  {
    name: 'stack (from 0°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 }],
    op: { type: 'stack' },
  },
  {
    name: 'stack (from 45°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 45, sliceThickness: 35, sliceCount: 6 }],
    op: { type: 'stack' },
  },
  {
    name: 'rotate90 (from 0°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }],
    op: { type: 'rotate90' },
  },
  {
    name: 'rotate90 (from 45°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 45, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }],
    op: { type: 'rotate90' },
  },
  {
    name: 'flipAlternate (0°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }, { type: 'rotate90' }],
    op: { type: 'flipAlternate' },
  },
  {
    name: 'flipAlternate (45°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 45, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }, { type: 'rotate90' }],
    op: { type: 'flipAlternate' },
  },
  {
    name: 'shiftAlternate',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 25, sliceCount: 7 }, { type: 'stack' }, { type: 'rotate90' }],
    op: { type: 'shiftAlternate', shift: 28 },
    strips: { unit: [{ species: 'maple', width: 50 }, { species: 'walnut', width: 6 }], repeat: 4, tail: [{ species: 'maple', width: 50 }] },
  },
  {
    name: 'insertStrips',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 25, sliceCount: 7 }, { type: 'stack' }, { type: 'rotate90' }],
    op: { type: 'insertStrips', strips: [{ species: 'walnut', width: 4 }] },
    strips: { unit: [{ species: 'maple', width: 50 }, { species: 'walnut', width: 6 }], repeat: 4, tail: [{ species: 'maple', width: 50 }] },
  },
  {
    name: 'glueup (reassemble 0°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }, { type: 'rotate90' }, { type: 'flipAlternate' }],
    op: { type: 'glueup' },
  },
  {
    name: 'glueup (reassemble 45°)',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 45, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }, { type: 'rotate90' }, { type: 'flipAlternate' }],
    op: { type: 'glueup' },
  },
  {
    name: 'flatten',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }, { type: 'rotate90' }, { type: 'flipAlternate' }, { type: 'glueup' }],
    op: { type: 'flatten', targetThickness: 20 },
  },
  {
    name: 'trim',
    inputOps: [{ type: 'glueup' }, { type: 'crosscut', angle: 45, sliceThickness: 35, sliceCount: 6 }, { type: 'stack' }, { type: 'rotate90' }, { type: 'flipAlternate' }, { type: 'glueup' }],
    op: { type: 'trim' },
  },
];

// ─── Rendering ──────────────────────────────────────────────────────

function createSvg(w, h) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  return svg;
}

function renderWorkState(ws, svgW, svgH) {
  const svg = createSvg(svgW, svgH);
  const pad = 6;
  const box = { x: pad, y: pad, w: svgW - pad * 2, h: svgH - pad * 2 };
  if (ws.kind === 'panel') {
    drawLayout(svg, ws.workpiece.face, box);
  } else if (ws.kind === 'slices' && ws.slices.length > 0) {
    const gap = 2;
    const shown = ws.slices.slice(0, 10);
    const totalFaceH = shown.reduce((s, sl) => s + sl.face.height, 0);
    const faceW = shown[0].face.width;
    const scale = Math.min(box.w / faceW, (box.h - gap * (shown.length - 1)) / totalFaceH);
    const actualW = faceW * scale;
    const xBase = box.x + (box.w - actualW) / 2;
    let y = box.y + (box.h - (totalFaceH * scale + gap * (shown.length - 1))) / 2;
    for (const slice of shown) {
      const sh = slice.face.height * scale;
      drawLayout(svg, slice.face, { x: xBase, y, w: actualW, h: sh });
      y += sh + gap;
    }
  }
  return svg;
}

function dimsText(ws) {
  if (!ws) return '(none)';
  if (ws.kind === 'panel') {
    const wp = ws.workpiece;
    return `panel ${r(wp.face.width)}×${r(wp.face.height)} t=${wp.thickness}mm ${wp.grainDir}`;
  }
  const s = ws.slices[0];
  return `${ws.slices.length} slices ${r(s.face.width)}×${r(s.face.height)} t=${s.thickness}mm ${s.grainDir}`;
}

function r(n) { return Math.round(n * 10) / 10; }

// ─── Render table ───────────────────────────────────────────────────

const tbody = document.getElementById('tbody');

tests.forEach(test => {
  const sp = test.strips || defaultStrips;
  const stockT = test.stockThickness || 25;
  const tr = document.createElement('tr');

  // INPUT
  const inputTd = document.createElement('td');
  inputTd.className = 'viz';
  if (test.inputOps.length === 0) {
    const strips = expandStrips(sp);
    inputTd.innerHTML = `<div class="dims">${strips.length} strips</div>`;
    const viz = document.createElement('div');
    viz.style.cssText = 'display:flex;gap:1px;margin:4px auto;justify-content:center';
    strips.forEach(s => {
      const dot = document.createElement('span');
      dot.style.cssText = `width:${Math.max(6, s.width / 4)}px;height:16px;background:${SPECIES[s.species].color};border-radius:2px;display:inline-block`;
      viz.appendChild(dot);
    });
    inputTd.appendChild(viz);
  } else {
    try {
      const inputWs = run(test.inputOps, sp, stockT);
      inputTd.appendChild(renderWorkState(inputWs, 280, 130));
      inputTd.innerHTML += `<div class="dims">${dimsText(inputWs)}</div>`;
    } catch (e) {
      inputTd.innerHTML = `<div class="err">input error: ${e.message}</div>`;
    }
  }
  tr.appendChild(inputTd);

  // Arrow
  let td = document.createElement('td');
  td.className = 'arrow';
  td.textContent = '→';
  tr.appendChild(td);

  // OPERATION
  const opTd = document.createElement('td');
  opTd.className = 'viz';
  try {
    const allOps = [...test.inputOps, test.op];
    const snaps = evaluate(sp, allOps, stockT);
    const snap = snaps[snaps.length - 1];
    const prevSnap = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const opSvg = createSvg(200, 100);
    renderStage(opSvg, snap, prevSnap, { x: 4, y: 4, w: 192, h: 92 });
    opTd.appendChild(opSvg);
  } catch (e) {
    opTd.innerHTML = `<div class="err">${e.message}</div>`;
  }
  const label = document.createElement('div');
  label.style.cssText = 'font-weight:600;font-size:11px;margin-top:4px';
  label.textContent = test.name;
  opTd.appendChild(label);
  tr.appendChild(opTd);

  // Arrow
  td = document.createElement('td');
  td.className = 'arrow';
  td.textContent = '→';
  tr.appendChild(td);

  // OUTPUT
  const outputTd = document.createElement('td');
  outputTd.className = 'viz';
  try {
    const allOps = [...test.inputOps, test.op];
    const outputWs = run(allOps, sp, stockT);
    outputTd.appendChild(renderWorkState(outputWs, 280, 130));
    outputTd.innerHTML += `<div class="dims">${dimsText(outputWs)}</div>`;
  } catch (e) {
    outputTd.innerHTML = `<div class="err">output error: ${e.message}</div>`;
  }
  tr.appendChild(outputTd);

  tbody.appendChild(tr);
});
