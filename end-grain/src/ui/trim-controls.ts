/**
 * Trim controls — reusable DOM component for authoring a TrimPanel.
 *
 * Mirrors cut-controls.ts / strip-inventory.ts in shape: plain DOM,
 * mount(el, state, options) → handle API, no framework. Shared
 * between the Trim harness and the workbench canvas so authoring UI
 * stays authoritative in one place.
 *
 * Surface:
 *   - mode selector: flush · rectangle · bbox (segmented)
 *   - bounds inputs (xMin / xMax / zMin / zMax) — visible only when
 *     mode === 'bbox'; optional fields (blank = use panel extent).
 *
 * Commit behaviour: mode change fires immediately. Bounds inputs
 * fire on change / Enter.
 */

export interface TrimControlsState {
  mode: 'flush' | 'rectangle' | 'bbox';
  bounds?: {
    xMin?: number;
    xMax?: number;
    zMin?: number;
    zMax?: number;
  };
}

export interface TrimControlsOptions {
  onChange: (next: TrimControlsState) => void;
}

export interface TrimControlsHandle {
  update: (next: TrimControlsState) => void;
  dispose: () => void;
}

const MODES: ReadonlyArray<TrimControlsState['mode']> = ['flush', 'rectangle', 'bbox'];

export function mountTrimControls(
  el: HTMLElement,
  initial: TrimControlsState,
  options: TrimControlsOptions,
): TrimControlsHandle {
  let state: TrimControlsState = cloneState(initial);

  let modeBtns: Record<string, HTMLButtonElement> = {};
  let boundsSection: HTMLElement;
  let boundsInputs: Record<'xMin' | 'xMax' | 'zMin' | 'zMax', HTMLInputElement> = {
    xMin: null!,
    xMax: null!,
    zMin: null!,
    zMax: null!,
  };

  function build(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'trim-controls';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '0.4rem';
    wrap.style.fontSize = '0.72rem';

    // --- mode segmented selector ------------------------------------
    const modeRow = document.createElement('div');
    modeRow.style.display = 'flex';
    modeRow.style.alignItems = 'center';
    modeRow.style.gap = '0.4rem';

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
    seg.style.flex = '1 1 auto';

    for (const m of MODES) {
      const btn = buildSegButton(m, () => setMode(m));
      modeBtns[m] = btn;
      seg.appendChild(btn);
    }
    modeRow.appendChild(seg);
    wrap.appendChild(modeRow);

    // --- bounds section (visible only when mode === 'bbox') ---------
    boundsSection = document.createElement('div');
    boundsSection.style.display = 'flex';
    boundsSection.style.flexDirection = 'column';
    boundsSection.style.gap = '0.2rem';
    boundsSection.style.borderTop = '1px dashed #e4e4e0';
    boundsSection.style.paddingTop = '0.35rem';

    const boundsHelp = document.createElement('p');
    boundsHelp.style.margin = '0';
    boundsHelp.style.fontSize = '0.62rem';
    boundsHelp.style.color = '#888';
    boundsHelp.textContent = 'blank = use the panel extent for that edge';
    boundsSection.appendChild(boundsHelp);

    const xRow = buildBoundsRow('X', 'xMin', 'xMax');
    const zRow = buildBoundsRow('Z', 'zMin', 'zMax');
    boundsSection.appendChild(xRow);
    boundsSection.appendChild(zRow);

    wrap.appendChild(boundsSection);

    refreshModeButtons();
    refreshBoundsSection();

    return wrap;
  }

  function buildBoundsRow(
    axis: 'X' | 'Z',
    minKey: 'xMin' | 'zMin',
    maxKey: 'xMax' | 'zMax',
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '0.4rem';

    const label = document.createElement('label');
    label.textContent = axis;
    label.style.flex = '0 0 14px';
    label.style.color = '#666';
    label.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
    label.style.fontSize = '0.66rem';
    row.appendChild(label);

    boundsInputs[minKey] = boundsNumberInput((v) => {
      ensureBounds().__setKey(minKey, v);
      emit();
    });
    boundsInputs[maxKey] = boundsNumberInput((v) => {
      ensureBounds().__setKey(maxKey, v);
      emit();
    });

    row.appendChild(boundsInputs[minKey]);
    const sep = document.createElement('span');
    sep.textContent = '→';
    sep.style.color = '#c0bcb4';
    sep.style.fontSize = '0.7rem';
    row.appendChild(sep);
    row.appendChild(boundsInputs[maxKey]);

    return row;
  }

  function boundsNumberInput(
    onCommit: (v: number | undefined) => void,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.placeholder = '—';
    input.style.flex = '1 1 0';
    input.style.minWidth = '0';
    input.style.padding = '2px 4px';
    input.style.border = '1px solid #d6d3cd';
    input.style.borderRadius = '2px';
    input.style.fontFamily = 'ui-monospace, monospace';
    input.style.fontSize = '0.66rem';
    const commit = () => {
      const raw = input.value.trim();
      if (raw === '') { onCommit(undefined); return; }
      const v = Number(raw);
      if (!Number.isFinite(v)) { onCommit(undefined); return; }
      onCommit(v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.blur(); }
    });
    return input;
  }

  function ensureBounds(): TrimControlsState['bounds'] & { __setKey: (k: keyof NonNullable<TrimControlsState['bounds']>, v: number | undefined) => void } {
    if (!state.bounds) state.bounds = {};
    const b = state.bounds;
    const api = b as typeof b & { __setKey: (k: keyof NonNullable<TrimControlsState['bounds']>, v: number | undefined) => void };
    if (!api.__setKey) {
      Object.defineProperty(api, '__setKey', {
        enumerable: false,
        value: (k: keyof NonNullable<TrimControlsState['bounds']>, v: number | undefined) => {
          if (v === undefined) delete b[k];
          else b[k] = v;
        },
      });
    }
    return api;
  }

  function setMode(next: TrimControlsState['mode']): void {
    if (state.mode === next) return;
    state.mode = next;
    refreshModeButtons();
    refreshBoundsSection();
    emit();
  }

  function refreshModeButtons(): void {
    for (const m of MODES) {
      modeBtns[m].classList.toggle('on', state.mode === m);
    }
  }

  function refreshBoundsSection(): void {
    boundsSection.style.display = state.mode === 'bbox' ? 'flex' : 'none';
    // Populate inputs from state.bounds.
    const b = state.bounds ?? {};
    boundsInputs.xMin.value = b.xMin === undefined ? '' : String(b.xMin);
    boundsInputs.xMax.value = b.xMax === undefined ? '' : String(b.xMax);
    boundsInputs.zMin.value = b.zMin === undefined ? '' : String(b.zMin);
    boundsInputs.zMax.value = b.zMax === undefined ? '' : String(b.zMax);
  }

  function syncAllFromState(): void {
    refreshModeButtons();
    refreshBoundsSection();
  }

  function emit(): void {
    options.onChange(cloneState(state));
  }

  el.innerHTML = '';
  el.appendChild(build());

  return {
    update(next: TrimControlsState): void {
      state = cloneState(next);
      syncAllFromState();
    },
    dispose(): void {
      el.innerHTML = '';
    },
  };
}

// ---- helpers ----

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
  btn.style.flex = '1 1 0';
  btn.addEventListener('click', onClick);
  ensureSegStyle();
  return btn;
}

let segStyleInjected = false;
function ensureSegStyle(): void {
  if (segStyleInjected) return;
  const s = document.createElement('style');
  s.textContent = `
    .trim-controls .seg button.on {
      background: #fff3dc;
      color: #5b4a2e;
    }
    .trim-controls .seg button + button {
      border-left: 1px solid #d6d3cd;
    }
  `;
  document.head.appendChild(s);
  segStyleInjected = true;
}

function cloneState(s: TrimControlsState): TrimControlsState {
  return {
    mode: s.mode,
    bounds: s.bounds ? { ...s.bounds } : undefined,
  };
}
