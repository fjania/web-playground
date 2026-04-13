import { SPECIES } from '../pipeline.js';

export function SliderRow({ label, min, max, step, value, onChange, unit = '' }) {
  return (
    <div class="control-row">
      <label>{label}</label>
      <div class="slider-group">
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onInput={e => onChange(+e.target.value)}
        />
        <span class="value-tag">{value}{unit}</span>
      </div>
    </div>
  );
}

export function SpeciesSwatch({ species, onClick, size = 20 }) {
  return (
    <button
      class="strip-swatch"
      style={{ background: SPECIES[species]?.color || '#ccc', width: size, height: size }}
      onClick={onClick}
      aria-label={`change species (${species})`}
    />
  );
}
