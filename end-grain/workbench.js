import { evaluate, expandStrips } from './evaluate.js';
import { drawLayout } from './render.js';
import { renderStage } from './stage-renderers.js';
import { SPECIES } from './pipeline.js';

const NS = 'http://www.w3.org/2000/svg';
const speciesKeys = Object.keys(SPECIES);

let state = {
  stripPattern: {
    unit: [{ species: 'maple', width: 25 }, { species: 'walnut', width: 25 }],
    repeat: 4,
  },
  stockThickness: 25,
  operations: [{ type: 'glueup' }],
};

const OP_TEMPLATES = {
  glueup:         () => ({ type: 'glueup' }),
  crosscut:       () => ({ type: 'crosscut', angle: 0, sliceThickness: 35, sliceCount: 6 }),
  stack:          () => ({ type: 'stack' }),
  rotate90:       () => ({ type: 'rotate90' }),
  flipAlternate:  () => ({ type: 'flipAlternate' }),
  shiftAlternate: () => ({ type: 'shiftAlternate', shift: 25 }),
  insertStrips:   () => ({ type: 'insertStrips', strips: [{ species: 'walnut', width: 4 }] }),
  flatten:        () => ({ type: 'flatten', targetThickness: 20 }),
  trim:           () => ({ type: 'trim' }),
};

// ─── Render ─────────────────────────────────────────────────────────

function renderAll() { renderSidebar(); renderMain(); }

function renderSidebar() {
  const el = document.getElementById('controls');
  el.innerHTML = '';

  // Strips
  const sec1 = mkEl('div', 'sb-section');
  sec1.innerHTML = `<div class="sb-title">Strip unit × ${state.stripPattern.repeat}</div>`;

  state.stripPattern.unit.forEach((s, i) => {
    const row = mkEl('div', 'strip-row');
    row.innerHTML = `
      <span class="strip-swatch" style="background:${SPECIES[s.species].color}"></span>
      <select class="strip-species" data-idx="${i}">${speciesKeys.map(k =>
        `<option value="${k}" ${k === s.species ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <div class="strip-width">
        <input type="range" min="4" max="80" value="${s.width}" data-idx="${i}" class="strip-w-range">
        <span class="val">${s.width}</span>
      </div>
      <button class="strip-remove" data-idx="${i}">×</button>`;
    sec1.appendChild(row);
  });

  const paramRepeat = mkEl('div', 'param-row');
  paramRepeat.innerHTML = `<label>repeat</label>
    <input type="range" min="1" max="8" value="${state.stripPattern.repeat}" class="sp-repeat">
    <span class="val">${state.stripPattern.repeat}×</span>`;
  sec1.appendChild(paramRepeat);

  const paramStock = mkEl('div', 'param-row');
  paramStock.innerHTML = `<label>stock</label>
    <input type="range" min="15" max="50" value="${state.stockThickness}" class="stock-t">
    <span class="val">${state.stockThickness}mm</span>`;
  sec1.appendChild(paramStock);

  const addStrip = mkEl('div', '');
  addStrip.innerHTML = `<button class="btn-sm sp-add" style="margin-top:6px">+ strip</button>`;
  sec1.appendChild(addStrip);
  el.appendChild(sec1);

  // Operations
  const sec2 = mkEl('div', 'sb-section');
  sec2.innerHTML = `<div class="sb-title">Operations (${state.operations.length})</div>`;

  state.operations.forEach((op, i) => {
    const item = mkEl('div', 'op-item');
    const head = mkEl('div', 'op-head');
    head.innerHTML = `<span class="op-num">${i + 1}</span>
      <span class="op-name">${op.type}</span>
      <button class="strip-remove op-remove" data-idx="${i}">×</button>`;
    item.appendChild(head);

    const params = mkEl('div', 'op-params-block');
    if (op.type === 'crosscut') {
      params.innerHTML = `
        ${slider('angle', 0, 60, 5, op.angle || 0, i, '°')}
        ${slider('sliceThickness', 10, 60, 5, op.sliceThickness, i, 'mm')}
        ${slider('sliceCount', 2, 20, 1, op.sliceCount, i, '')}`;
    } else if (op.type === 'shiftAlternate') {
      params.innerHTML = slider('shift', 1, 100, 1, op.shift, i, 'mm');
    } else if (op.type === 'flatten') {
      params.innerHTML = slider('targetThickness', 10, 40, 1, op.targetThickness, i, 'mm');
    } else if (op.type === 'insertStrips' && op.strips) {
      params.innerHTML = slider('insertWidth', 2, 20, 1, op.strips[0].width, i, 'mm');
    } else if (op.type === 'stack') {
      params.innerHTML = `<div style="font-size:9px;color:var(--muted)">auto: longest edge horizontal</div>`;
    }
    if (params.innerHTML) item.appendChild(params);
    sec2.appendChild(item);
  });

  const addRow = mkEl('div', 'add-row');
  addRow.innerHTML = `<select class="op-add-select">
    ${Object.keys(OP_TEMPLATES).map(k => `<option value="${k}">${k}</option>`).join('')}
  </select><button class="btn-sm btn-accent op-add-btn">+ add</button>`;
  sec2.appendChild(addRow);
  el.appendChild(sec2);

  // Wire events
  el.querySelectorAll('.strip-species').forEach(s => s.onchange = () => {
    state.stripPattern.unit[+s.dataset.idx].species = s.value; renderAll();
  });
  el.querySelectorAll('.strip-w-range').forEach(inp => inp.oninput = () => {
    state.stripPattern.unit[+inp.dataset.idx].width = +inp.value;
    inp.parentElement.querySelector('.val').textContent = inp.value;
    renderMain();
  });
  el.querySelectorAll('.strip-remove:not(.op-remove)').forEach(btn => btn.onclick = () => {
    if (state.stripPattern.unit.length > 1) { state.stripPattern.unit.splice(+btn.dataset.idx, 1); renderAll(); }
  });
  el.querySelector('.sp-add').onclick = () => {
    state.stripPattern.unit.push({ species: 'maple', width: 25 }); renderAll();
  };
  el.querySelector('.sp-repeat').oninput = (e) => {
    state.stripPattern.repeat = +e.target.value;
    e.target.parentElement.querySelector('.val').textContent = e.target.value + '×';
    renderMain();
  };
  el.querySelector('.stock-t').oninput = (e) => {
    state.stockThickness = +e.target.value;
    e.target.parentElement.querySelector('.val').textContent = e.target.value + 'mm';
    renderMain();
  };
  el.querySelectorAll('.op-remove').forEach(btn => btn.onclick = () => {
    state.operations.splice(+btn.dataset.idx, 1); renderAll();
  });
  el.querySelectorAll('.op-range').forEach(inp => inp.oninput = () => {
    const idx = +inp.dataset.idx, field = inp.dataset.field;
    if (field === 'insertWidth') state.operations[idx].strips[0].width = +inp.value;
    else state.operations[idx][field] = +inp.value;
    const valEl = inp.parentElement.querySelector('.val');
    if (valEl) valEl.textContent = inp.value + (valEl.textContent.match(/[a-z°]+$/)?.[0] || '');
    renderMain();
  });
  el.querySelector('.op-add-btn').onclick = () => {
    state.operations.push(OP_TEMPLATES[el.querySelector('.op-add-select').value]()); renderAll();
  };
}

function renderMain() {
  const el = document.getElementById('results');
  el.innerHTML = '';

  let snapshots;
  try { snapshots = evaluate(state.stripPattern, state.operations, state.stockThickness); }
  catch (e) { el.innerHTML = `<div class="error">${e.message}</div>`; return; }

  // Strips bar
  const strips = expandStrips(state.stripPattern);
  const barWrap = mkEl('div', 'strips-bar-wrap');
  barWrap.innerHTML = `<div class="strips-bar-title">Expanded strips (${strips.length})</div>
    <div class="strips-bar">${strips.map(s =>
      `<span style="width:${Math.max(8, s.width / 3)}px;background:${SPECIES[s.species].color}" title="${s.species} ${s.width}mm"></span>`
    ).join('')}</div>`;
  el.appendChild(barWrap);

  // Pipeline cards
  const cardWrap = mkEl('div', 'pipeline-cards');
  snapshots.forEach((snap, i) => {
    const card = mkEl('div', 'card');
    const ws = snap.workState;
    const dims = ws.kind === 'panel'
      ? `${r(ws.workpiece.face.width)}×${r(ws.workpiece.face.height)}`
      : `${ws.slices.length}× ${r(ws.slices[0].face.width)}×${r(ws.slices[0].face.height)}`;

    card.innerHTML = `<div class="card-head">
      <span class="card-title">${i + 1}. ${snap.op.type}</span>
      <span class="card-dims">${dims}</span>
    </div>`;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 220 150');
    svg.setAttribute('width', 204);
    svg.setAttribute('height', 139);
    renderStage(svg, snap, i > 0 ? snapshots[i - 1] : null, { x: 6, y: 6, w: 208, h: 138 });
    card.appendChild(svg);
    cardWrap.appendChild(card);
  });
  el.appendChild(cardWrap);

  // Result
  if (snapshots.length > 0) {
    const ws = snapshots[snapshots.length - 1].workState;
    const dims = ws.kind === 'panel'
      ? `${r(ws.workpiece.face.width)} × ${r(ws.workpiece.face.height)} mm`
      : `${ws.slices.length} slices`;
    const wrap = mkEl('div', 'result-wrap');
    wrap.innerHTML = `<div class="result-head">
      <span class="result-title">Result</span>
      <span class="result-dims">${dims}</span>
    </div>`;

    const svg = document.createElementNS(NS, 'svg');
    const svgW = 500, svgH = 280;
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', svgH);
    const pad = 10, box = { x: pad, y: pad, w: svgW - pad * 2, h: svgH - pad * 2 };

    if (ws.kind === 'panel') {
      drawLayout(svg, ws.workpiece.face, box);
    } else if (ws.slices.length > 0) {
      const gap = 3, shown = ws.slices.slice(0, 12);
      const totalH = shown.reduce((s, sl) => s + sl.face.height, 0) + gap * (shown.length - 1);
      const faceW = shown[0].face.width;
      const scale = Math.min(box.w / faceW, box.h / totalH);
      const xBase = box.x + (box.w - faceW * scale) / 2;
      let y = box.y + (box.h - totalH * scale) / 2;
      for (const slice of shown) {
        const sh = slice.face.height * scale;
        drawLayout(svg, slice.face, { x: xBase, y, w: faceW * scale, h: sh });
        y += sh + gap;
      }
    }
    wrap.appendChild(svg);
    el.appendChild(wrap);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function mkEl(tag, cls) { const d = document.createElement(tag); d.className = cls; return d; }
function r(n) { return Math.round(n * 10) / 10; }

function slider(field, min, max, step, value, idx, unit) {
  const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toLowerCase());
  return `<div class="param-row">
    <label>${label}</label>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-idx="${idx}" data-field="${field}" class="op-range">
    <span class="val">${value}${unit}</span>
  </div>`;
}

// ─── Init ───────────────────────────────────────────────────────────
renderAll();
