/**
 * Cut controls — reusable DOM component for authoring a Cut feature.
 *
 * Lifts the Cut-specific authoring surface out of URL-only knobs so
 * the same component can mount into:
 *   - the Cut harness (3d-cut.html) — replacing the URL-param-only
 *     control surface with real UI while `?rip=...` etc. still seed
 *     initial state.
 *   - the integrated workbench (cutting-board-workbench.html) — where
 *     each Cut stage embeds this component into its controls pane.
 *
 * Keeping the same component in both places is how we enforce the
 * "harness and canvas must not diverge" rule — any visual or
 * behavioural improvement lands in one place and ships to both.
 *
 * Shape:
 *   - Plain DOM + pointer/keyboard events (no Svelte / Preact / React).
 *   - `mount(el, state, options)` returns a handle with `update()` and
 *     `dispose()`, same as strip-inventory.ts / strip-reorder.ts.
 *   - State = the subset of the Cut feature this surface edits. Owner
 *     threads the rest (id, kind, status) through separately.
 *
 * Commit behaviour: sliders fire `onChange` on `input` events (live),
 * number inputs fire on `change` / Enter. The pipeline debounces
 * downstream so live slider dragging stays smooth without rerunning
 * the pipeline 60 times a second.
 */

export interface CutControlsState {
  /** -90..90 degrees. */
  rip: number;
  /** 45..90 degrees. */
  bevel: number;
  /** Which param drives slice density. */
  spacingMode: 'pitch' | 'slices';
  /** mm, used when spacingMode = 'pitch'. */
  pitch: number;
  /** count, used when spacingMode = 'slices'. */
  slices: number;
  /** Show thin offcut pieces alongside slices. */
  showOffcuts: boolean;
}

export interface CutControlsOptions {
  onChange: (next: CutControlsState) => void;
}

export interface CutControlsHandle {
  update: (next: CutControlsState) => void;
  dispose: () => void;
}

const MIN_RIP = -90;
const MAX_RIP = 90;
const MIN_BEVEL = 45;
const MAX_BEVEL = 90;
const MIN_SLICES = 2;
const MAX_SLICES = 32;
const MIN_PITCH = 1;
const MAX_PITCH = 500;

export function mountCutControls(
  el: HTMLElement,
  initial: CutControlsState,
  options: CutControlsOptions,
): CutControlsHandle {
  let state: CutControlsState = cloneState(initial);

  // Kept as outer vars so `update()` can poke DOM inputs directly
  // without rebuilding from scratch (avoids clobbering focus).
  let ripInput: HTMLInputElement;
  let ripValue: HTMLSpanElement;
  let bevelInput: HTMLInputElement;
  let bevelValue: HTMLSpanElement;
  let pitchBtn: HTMLButtonElement;
  let slicesBtn: HTMLButtonElement;
  let spacingInput: HTMLInputElement;
  let spacingLabel: HTMLSpanElement;
  let spacingUnit: HTMLSpanElement;
  let offcutsInput: HTMLInputElement;

  function build(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cut-controls';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '0.35rem';
    wrap.style.fontSize = '0.72rem';

    // --- rip ---------------------------------------------------------
    const ripRow = buildSliderRow({
      label: 'rip',
      min: MIN_RIP,
      max: MAX_RIP,
      step: 1,
      value: state.rip,
      unit: '°',
    });
    ripInput = ripRow.input;
    ripValue = ripRow.valueLabel;
    ripInput.addEventListener('input', () => {
      state.rip = clamp(Number(ripInput.value), MIN_RIP, MAX_RIP);
      ripValue.textContent = `${state.rip}°`;
      emit();
    });
    wrap.appendChild(ripRow.row);

    // --- bevel -------------------------------------------------------
    const bevelRow = buildSliderRow({
      label: 'bevel',
      min: MIN_BEVEL,
      max: MAX_BEVEL,
      step: 1,
      value: state.bevel,
      unit: '°',
    });
    bevelInput = bevelRow.input;
    bevelValue = bevelRow.valueLabel;
    bevelInput.addEventListener('input', () => {
      state.bevel = clamp(Number(bevelInput.value), MIN_BEVEL, MAX_BEVEL);
      bevelValue.textContent = `${state.bevel}°`;
      emit();
    });
    wrap.appendChild(bevelRow.row);

    // --- spacingMode toggle -----------------------------------------
    const modeRow = document.createElement('div');
    modeRow.className = 'cut-row';
    modeRow.style.display = 'flex';
    modeRow.style.alignItems = 'center';
    modeRow.style.gap = '0.4rem';
    modeRow.style.padding = '0.2rem 0 0';

    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'mode';
    modeLabel.style.flex = '0 0 58px';
    modeLabel.style.color = '#666';
    modeLabel.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
    modeLabel.style.fontSize = '0.66rem';
    modeRow.appendChild(modeLabel);

    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.display = 'inline-flex';
    seg.style.border = '1px solid #d6d3cd';
    seg.style.borderRadius = '3px';
    seg.style.overflow = 'hidden';

    slicesBtn = buildSegButton('slices', () => setMode('slices'));
    pitchBtn = buildSegButton('pitch', () => setMode('pitch'));
    seg.appendChild(slicesBtn);
    seg.appendChild(pitchBtn);
    modeRow.appendChild(seg);

    wrap.appendChild(modeRow);

    // --- spacing value (slices or pitch) ----------------------------
    const spacingRow = document.createElement('div');
    spacingRow.className = 'cut-row';
    spacingRow.style.display = 'flex';
    spacingRow.style.alignItems = 'center';
    spacingRow.style.gap = '0.4rem';

    spacingLabel = document.createElement('label');
    spacingLabel.style.flex = '0 0 58px';
    spacingLabel.style.color = '#666';
    spacingLabel.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
    spacingLabel.style.fontSize = '0.66rem';
    spacingRow.appendChild(spacingLabel);

    spacingInput = document.createElement('input');
    spacingInput.type = 'range';
    spacingInput.style.flex = '1';
    spacingInput.style.height = '16px';

    spacingUnit = document.createElement('span');
    spacingUnit.style.flex = '0 0 46px';
    spacingUnit.style.padding = '1px 4px';
    spacingUnit.style.border = '1px solid #d6d3cd';
    spacingUnit.style.borderRadius = '2px';
    spacingUnit.style.fontFamily = 'ui-monospace, monospace';
    spacingUnit.style.fontSize = '0.66rem';
    spacingUnit.style.textAlign = 'right';
    spacingUnit.style.background = '#fff';

    spacingRow.appendChild(spacingInput);
    spacingRow.appendChild(spacingUnit);

    spacingInput.addEventListener('input', () => {
      const v = Number(spacingInput.value);
      if (!Number.isFinite(v)) return;
      if (state.spacingMode === 'slices') {
        state.slices = Math.max(MIN_SLICES, Math.min(MAX_SLICES, Math.floor(v)));
        spacingUnit.textContent = String(state.slices);
      } else {
        state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.round(v)));
        spacingUnit.textContent = `${state.pitch} mm`;
      }
      emit();
    });

    wrap.appendChild(spacingRow);

    // --- show offcuts checkbox --------------------------------------
    const offcutsRow = document.createElement('label');
    offcutsRow.style.display = 'flex';
    offcutsRow.style.alignItems = 'center';
    offcutsRow.style.gap = '0.3rem';
    offcutsRow.style.color = '#666';
    offcutsRow.style.fontSize = '0.66rem';
    offcutsRow.style.paddingTop = '0.15rem';

    offcutsInput = document.createElement('input');
    offcutsInput.type = 'checkbox';
    offcutsInput.checked = state.showOffcuts;
    offcutsInput.addEventListener('change', () => {
      state.showOffcuts = offcutsInput.checked;
      emit();
    });
    offcutsRow.appendChild(offcutsInput);
    offcutsRow.appendChild(document.createTextNode('show offcuts'));
    wrap.appendChild(offcutsRow);

    // Set spacing state from current mode.
    refreshSpacingFields();
    refreshModeButtons();

    return wrap;
  }

  function setMode(next: 'pitch' | 'slices'): void {
    if (state.spacingMode === next) return;
    state.spacingMode = next;
    refreshSpacingFields();
    refreshModeButtons();
    emit();
  }

  function refreshSpacingFields(): void {
    if (state.spacingMode === 'slices') {
      spacingLabel.textContent = 'slices';
      spacingInput.min = String(MIN_SLICES);
      spacingInput.max = String(MAX_SLICES);
      spacingInput.step = '1';
      spacingInput.value = String(state.slices);
      spacingUnit.textContent = String(state.slices);
    } else {
      spacingLabel.textContent = 'pitch';
      spacingInput.min = String(MIN_PITCH);
      spacingInput.max = String(MAX_PITCH);
      spacingInput.step = '1';
      spacingInput.value = String(state.pitch);
      spacingUnit.textContent = `${state.pitch} mm`;
    }
  }

  function refreshModeButtons(): void {
    slicesBtn.classList.toggle('on', state.spacingMode === 'slices');
    pitchBtn.classList.toggle('on', state.spacingMode === 'pitch');
  }

  function syncAllFromState(): void {
    ripInput.value = String(state.rip);
    ripValue.textContent = `${state.rip}°`;
    bevelInput.value = String(state.bevel);
    bevelValue.textContent = `${state.bevel}°`;
    offcutsInput.checked = state.showOffcuts;
    refreshSpacingFields();
    refreshModeButtons();
  }

  function emit(): void {
    options.onChange(cloneState(state));
  }

  el.innerHTML = '';
  el.appendChild(build());

  return {
    update(next: CutControlsState): void {
      state = cloneState(next);
      syncAllFromState();
    },
    dispose(): void {
      el.innerHTML = '';
    },
  };
}

// ---- helpers ----

function buildSliderRow(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
}): { row: HTMLElement; input: HTMLInputElement; valueLabel: HTMLSpanElement } {
  const row = document.createElement('div');
  row.className = 'cut-row';
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '0.4rem';

  const label = document.createElement('label');
  label.textContent = opts.label;
  label.style.flex = '0 0 58px';
  label.style.color = '#666';
  label.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  label.style.fontSize = '0.66rem';
  row.appendChild(label);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.style.flex = '1';
  input.style.height = '16px';
  row.appendChild(input);

  const valueLabel = document.createElement('span');
  valueLabel.textContent = `${opts.value}${opts.unit}`;
  valueLabel.style.flex = '0 0 46px';
  valueLabel.style.padding = '1px 4px';
  valueLabel.style.border = '1px solid #d6d3cd';
  valueLabel.style.borderRadius = '2px';
  valueLabel.style.fontFamily = 'ui-monospace, monospace';
  valueLabel.style.fontSize = '0.66rem';
  valueLabel.style.textAlign = 'right';
  valueLabel.style.background = '#fff';
  row.appendChild(valueLabel);

  return { row, input, valueLabel };
}

function buildSegButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.border = 'none';
  btn.style.background = '#fff';
  btn.style.color = '#666';
  btn.style.padding = '2px 8px';
  btn.style.fontSize = '0.66rem';
  btn.style.cursor = 'pointer';
  btn.style.fontFamily = 'inherit';
  btn.addEventListener('click', onClick);
  // :hover / .on are handled via class toggles; inline-styles for base.
  // We add a dynamic style node once so the .on variant applies.
  ensureSegStyle();
  return btn;
}

let segStyleInjected = false;
function ensureSegStyle(): void {
  if (segStyleInjected) return;
  const s = document.createElement('style');
  s.textContent = `
    .cut-controls .seg button.on {
      background: #fff3dc;
      color: #5b4a2e;
    }
    .cut-controls .seg button + button {
      border-left: 1px solid #d6d3cd;
    }
  `;
  document.head.appendChild(s);
  segStyleInjected = true;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function cloneState(s: CutControlsState): CutControlsState {
  return {
    rip: s.rip,
    bevel: s.bevel,
    spacingMode: s.spacingMode,
    pitch: s.pitch,
    slices: s.slices,
    showOffcuts: s.showOffcuts,
  };
}
