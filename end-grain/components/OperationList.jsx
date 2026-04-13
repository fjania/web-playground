import { operations, updateOp } from '../state.js';
import { SliderRow, SpeciesSwatch } from './SliderRow.jsx';
import { SpeciesPicker } from './SpeciesPicker.jsx';

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

function OperationCard({ op, index }) {
  const onChange = (changes) => updateOp(index, changes);

  return (
    <div class="op-card">
      <div class="op-card-head">
        <span class="op-num">{index + 1}</span>
        <span class="op-label">{OP_LABELS[op.type] || op.type}</span>
      </div>

      {op.type === 'crosscut' && (
        <div class="op-card-body">
          <SliderRow label="Angle" min={0} max={60} step={5} value={op.angle || 0}
            onChange={v => onChange({ angle: v })} unit="°" />
          <SliderRow label="Thickness" min={15} max={60} step={5} value={op.sliceThickness}
            onChange={v => onChange({ sliceThickness: v })} unit="mm" />
          <SliderRow label="Count" min={3} max={20} step={1} value={op.sliceCount}
            onChange={v => onChange({ sliceCount: v })} />
        </div>
      )}

      {op.type === 'flatten' && (
        <div class="op-card-body">
          <SliderRow label="Target" min={10} max={40} step={1} value={op.targetThickness}
            onChange={v => onChange({ targetThickness: v })} unit="mm" />
        </div>
      )}

      {op.type === 'shiftAlternate' && (
        <div class="op-card-body">
          <SliderRow label="Shift" min={5} max={60} step={1} value={op.shift}
            onChange={v => onChange({ shift: v })} unit="mm" />
        </div>
      )}

      {op.type === 'insertStrips' && op.strips && (
        <div class="op-card-body">
          {op.strips.map((ins, j) => (
            <div class="control-row" key={j}>
              <SpeciesPicker
                selected={ins.species}
                onSelect={species => {
                  const strips = [...op.strips];
                  strips[j] = { ...strips[j], species };
                  onChange({ strips });
                }}
              >
                <SpeciesSwatch species={ins.species} />
              </SpeciesPicker>
              <SliderRow label="Width" min={2} max={20} step={1} value={ins.width}
                onChange={v => {
                  const strips = [...op.strips];
                  strips[j] = { ...strips[j], width: v };
                  onChange({ strips });
                }} unit="mm" />
            </div>
          ))}
        </div>
      )}

      {op.type === 'stack' && (
        <div class="op-card-body">
          <span class="panel-hint">longest edge horizontal, stacked vertically</span>
        </div>
      )}
    </div>
  );
}

export function OperationList() {
  const ops = operations.value;

  return (
    <section class="panel">
      <h2 class="panel-title">Operations <span class="panel-hint">{ops.length} steps</span></h2>
      <div class="op-list">
        {ops.map((op, i) => (
          <OperationCard key={i} op={op} index={i} />
        ))}
      </div>
    </section>
  );
}
