import { stripPattern, updateStripUnit, addStrip, removeStrip } from '../state.js';
import { SpeciesSwatch } from './SliderRow.jsx';
import { SpeciesPicker } from './SpeciesPicker.jsx';

export function StripEditor() {
  const sp = stripPattern.value;

  return (
    <section class="panel">
      <h2 class="panel-title">
        Strip unit <span class="panel-hint">× {sp.repeat}</span>
      </h2>
      <div class="control-row">
        <label>Repeat</label>
        <div class="slider-group">
          <input
            type="range" min="1" max="8" step="1" value={sp.repeat}
            onInput={e => {
              stripPattern.value = { ...sp, repeat: +e.target.value };
            }}
          />
          <span class="value-tag">{sp.repeat}×</span>
        </div>
      </div>

      <div class="strip-list">
        {sp.unit.map((strip, i) => (
          <div class="strip-row" key={i}>
            <SpeciesPicker
              selected={strip.species}
              onSelect={species => updateStripUnit(i, { species })}
            >
              <SpeciesSwatch species={strip.species} />
            </SpeciesPicker>
            <span class="strip-name">{strip.species}</span>
            <input
              class="strip-width"
              type="number" min="4" max="80"
              value={strip.width}
              onInput={e => updateStripUnit(i, { width: Math.max(4, +e.target.value || 10) })}
            />
            <button
              class="strip-delete"
              onClick={() => removeStrip(i)}
              disabled={sp.unit.length <= 1}
            >×</button>
          </div>
        ))}
      </div>

      <button class="btn-add" onClick={addStrip}>+ add to unit</button>

      {sp.tail && sp.tail.length > 0 && (
        <div style="margin-top:8px">
          <span class="panel-hint">tail: {sp.tail.map(s => s.species).join(', ')}</span>
        </div>
      )}
    </section>
  );
}
