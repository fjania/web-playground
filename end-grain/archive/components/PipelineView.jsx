import { snapshots } from '../state.js';
import { StageViz } from './StageViz.jsx';

const OP_LABELS = {
  glueup: 'Glue-up',
  flatten: 'Flatten',
  crosscut: 'Crosscut',
  stack: 'Stack',
  rotate90: 'Rotate 90°',
  flipAlternate: 'Flip alternate',
  shiftAlternate: 'Shift alternate',
  insertStrips: 'Insert strips',
  trim: 'Trim',
};

function dims(ws) {
  if (ws.kind === 'panel') {
    const wp = ws.workpiece;
    return `${Math.round(wp.face.width)}×${Math.round(wp.face.height)} t=${wp.thickness}mm`;
  }
  const s = ws.slices[0];
  return `${ws.slices.length}× ${Math.round(s.face.width)}×${Math.round(s.face.height)}`;
}

export function PipelineView() {
  const snaps = snapshots.value;
  if (!snaps.length) return null;

  return (
    <div class="pipeline-stages">
      <div class="pipeline-label">
        <span class="pipeline-label-text">pipeline</span>
        <span class="pipeline-label-rule" />
      </div>
      <div class="pipeline">
        {snaps.map((snap, i) => {
          const label = OP_LABELS[snap.op.type] || snap.op.type;
          const suffix = snap.op.angle ? ` ${snap.op.angle}°` : '';
          return (
            <article class="stage stage--small" key={i}>
              <div class="stage-head">
                <span class="stage-num">{i + 1}</span>
                <h3 class="stage-title">{label}{suffix}</h3>
              </div>
              <div class="stage-canvas">
                <StageViz
                  snap={snap}
                  prevSnap={snaps[i - 1] || null}
                  width={300}
                  height={120}
                />
              </div>
              <div class="stage-dims">{dims(snap.workState)}</div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
