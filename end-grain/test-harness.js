// test-harness.js — renders all presets' pipelines for visual QA.
// Each preset shows every operation's snapshot + the final face.

import { evaluate, PRESETS, finalFace } from './evaluate.js';
import { drawLayout } from './render.js';

const NS = 'http://www.w3.org/2000/svg';
const root = document.getElementById('root');

function createSvg(w, h) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  return svg;
}

function renderWorkState(ws, svgW, svgH) {
  const svg = createSvg(svgW, svgH);
  const pad = 4;
  const box = { x: pad, y: pad, w: svgW - pad * 2, h: svgH - pad * 2 };

  if (ws.kind === 'panel') {
    drawLayout(svg, ws.workpiece.face, box);
  } else if (ws.kind === 'slices' && ws.slices.length > 0) {
    // Show first 3 slices side by side with gaps
    const maxShow = Math.min(ws.slices.length, 3);
    const gap = 4;
    const sliceW = (svgW - pad * 2 - gap * (maxShow - 1)) / maxShow;
    for (let i = 0; i < maxShow; i++) {
      const sliceBox = { x: pad + i * (sliceW + gap), y: pad, w: sliceW, h: svgH - pad * 2 };
      drawLayout(svg, ws.slices[i].face, sliceBox);
    }
    if (ws.slices.length > maxShow) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', svgW - pad);
      t.setAttribute('y', svgH - 4);
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('font-size', 9);
      t.setAttribute('fill', '#a8a29e');
      t.textContent = `+${ws.slices.length - maxShow} more`;
      svg.appendChild(t);
    }
  }
  return svg;
}

for (const [key, preset] of Object.entries(PRESETS)) {
  const section = document.createElement('div');
  section.className = 'preset';

  const h2 = document.createElement('h2');
  h2.textContent = preset.name;
  section.appendChild(h2);

  const snaps = evaluate(preset.stripPattern, preset.operations, preset.stockThickness);

  // Pipeline: each step as a small SVG
  const pipeline = document.createElement('div');
  pipeline.className = 'pipeline';

  snaps.forEach((snap, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      pipeline.appendChild(arrow);
    }

    const stage = document.createElement('div');
    stage.className = 'stage';

    const label = document.createElement('div');
    label.className = 'stage-label';
    const opLabel = snap.op.type + (snap.op.angle ? ` ${snap.op.angle}°` : '')
      + (snap.op.direction ? ` (${snap.op.direction})` : '');
    label.textContent = `${i + 1}. ${opLabel}`;
    stage.appendChild(label);

    stage.appendChild(renderWorkState(snap.workState, 140, 100));

    const ws = snap.workState;
    const dims = document.createElement('div');
    dims.className = 'stage-dims';
    if (ws.kind === 'panel') {
      const wp = ws.workpiece;
      dims.textContent = `${Math.round(wp.face.width)}×${Math.round(wp.face.height)} t=${wp.thickness}`;
    } else {
      const s = ws.slices[0];
      dims.textContent = `${ws.slices.length}× ${Math.round(s.face.width)}×${Math.round(s.face.height)} t=${s.thickness}`;
    }
    stage.appendChild(dims);
    pipeline.appendChild(stage);
  });

  section.appendChild(pipeline);

  // Final face — larger
  const face = finalFace(snaps);
  if (face) {
    const finalDiv = document.createElement('div');
    finalDiv.className = 'final';
    const fl = document.createElement('div');
    fl.className = 'final-label';
    fl.textContent = `Final face: ${Math.round(face.width)}×${Math.round(face.height)}mm`;
    finalDiv.appendChild(fl);

    const svg = createSvg(400, 300);
    drawLayout(svg, face, { x: 10, y: 10, w: 380, h: 280 });
    finalDiv.appendChild(svg);
    section.appendChild(finalDiv);
  }

  root.appendChild(section);
}
