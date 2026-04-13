import { face, snapshots, stripPattern, stockThickness } from '../state.js';
import { expandStrips } from '../evaluate.js';
import { cutListText } from '../pipeline.js';
import { SvgFace } from './SvgFace.jsx';

export function FinalFace() {
  const f = face.value;
  if (!f) return null;

  const snaps = snapshots.value;
  const last = snaps[snaps.length - 1]?.workState;
  const thickness = last?.kind === 'panel' ? last.workpiece.thickness : null;
  const strips = expandStrips(stripPattern.value);
  const speciesSet = [...new Set(strips.map(s => s.species))];

  return (
    <div>
      <div class="final-label">
        <span class="final-label-rule" />
        <span class="final-label-text">end-grain face</span>
        <span class="final-label-rule" />
      </div>

      <article class="stage stage--final">
        <div class="stage-canvas">
          <SvgFace face={f} width={600} height={500} />
        </div>
        <div class="stage-footer">
          <div class="dimension-tag">
            <span>size</span>
            <strong>{Math.round(f.width)} × {Math.round(f.height)} mm</strong>
          </div>
          <div class="dimension-tag">
            <span>species</span>
            <strong>{speciesSet.join(' + ')}</strong>
          </div>
          {thickness && (
            <div class="dimension-tag">
              <span>thickness</span>
              <strong>{thickness}mm</strong>
            </div>
          )}
          <ExportButton />
        </div>
      </article>
    </div>
  );
}

function ExportButton() {
  const handleExport = () => {
    const strips = expandStrips(stripPattern.value);
    const state = {
      pattern: 'custom',
      strips,
      numSlices: 8,
      sliceThickness: 30,
      pass2: { enabled: false, cellShift: 1 },
    };
    const txt = cutListText(state);
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cutting-board.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <button class="btn-ghost" onClick={handleExport}>export cut list</button>;
}
