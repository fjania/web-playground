import { signal, computed, batch } from '@preact/signals';
import { evaluate, finalFace, PRESETS } from './evaluate.js';

export { PRESETS };

export const stripPattern = signal(PRESETS.checkerboard.stripPattern);
export const operations = signal(PRESETS.checkerboard.operations);
export const stockThickness = signal(PRESETS.checkerboard.stockThickness);
export const activePreset = signal('checkerboard');

export const snapshots = computed(() => {
  try {
    return evaluate(stripPattern.value, operations.value, stockThickness.value);
  } catch {
    return [];
  }
});

export const face = computed(() => finalFace(snapshots.value));

export function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  batch(() => {
    stripPattern.value = p.stripPattern;
    operations.value = p.operations;
    stockThickness.value = p.stockThickness;
    activePreset.value = key;
  });
}

export function updateOp(index, changes) {
  const ops = [...operations.value];
  ops[index] = { ...ops[index], ...changes };

  operations.value = ops;
  activePreset.value = null;
}

export function updateStripUnit(index, changes) {
  const sp = { ...stripPattern.value };
  const unit = [...sp.unit];
  unit[index] = { ...unit[index], ...changes };
  sp.unit = unit;
  stripPattern.value = sp;
  activePreset.value = null;
}

export function addStrip() {
  const sp = { ...stripPattern.value };
  const last = sp.unit[sp.unit.length - 1];
  sp.unit = [...sp.unit, { species: last.species === 'maple' ? 'walnut' : 'maple', width: last.width }];
  stripPattern.value = sp;
  activePreset.value = null;
}

export function removeStrip(index) {
  const sp = { ...stripPattern.value };
  if (sp.unit.length <= 1) return;
  sp.unit = sp.unit.filter((_, i) => i !== index);
  stripPattern.value = sp;
  activePreset.value = null;
}
