import { activePreset, applyPreset, PRESETS, snapshots } from '../state.js';
import { evaluate, finalFace } from '../evaluate.js';
import { layoutToSvgString } from '../render.js';

function thumbFor(key) {
  const p = PRESETS[key];
  const snaps = evaluate(p.stripPattern, p.operations, p.stockThickness);
  const f = finalFace(snaps);
  return f ? layoutToSvgString(f, 40, 40) : '';
}

export function PresetPicker() {
  return (
    <section class="panel">
      <h2 class="panel-title">Pattern</h2>
      <div class="pattern-grid">
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            class={`pattern-card ${activePreset.value === key ? 'active' : ''}`}
            onClick={() => applyPreset(key)}
          >
            <div
              class="pattern-thumb"
              dangerouslySetInnerHTML={{ __html: thumbFor(key) }}
            />
            <span class="pattern-label">{preset.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
