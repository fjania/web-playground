/**
 * Strip inventory editor — framework-agnostic DOM component.
 *
 * Mount into a container element; the component renders a list of
 * per-strip rows (species dropdown + width input + remove button),
 * plus an "add strip" button and global `stripHeight` /
 * `stripLength` inputs.
 *
 * The component is pure-imperative: every edit fires `onChange(next)`
 * with a full snapshot of the new inventory state. The owner is
 * responsible for re-rendering (via `update()`) if they want the DOM
 * to reflect programmatic changes — typed edits mutate only the DOM's
 * live input values until blur/change fires, and we re-render at
 * that point.
 *
 * Designed so a future Svelte app can import the same module and
 * mount it into a container. No Svelte, no Preact, no React — just
 * DOM + event listeners.
 *
 * Data model (matches the ComposeStrips feature type):
 *   - inventory: StripDef[] — ordered strip list (id / species /
 *     width). Order here is insertion order, NOT the arrangement
 *     order the pipeline ultimately consumes. The arrangement lives
 *     in a separate module (strip-reorder.ts).
 *   - stripHeight: number (mm) — global, applies to every strip.
 *   - stripLength: number (mm) — global, applies to every strip.
 *
 * Bounds: 1..MAX_STRIPS (64). Add/remove buttons disable at the
 * bounds.
 */

import type { Species, StripDef } from '../state/types';
import { SPECIES_COLOURS } from '../render/summary';

const SPECIES_LIST: Species[] = [
  'maple',
  'walnut',
  'cherry',
  'padauk',
  'purpleheart',
];

export const MIN_STRIPS = 1;
export const MAX_STRIPS = 64;

export interface InventoryState {
  inventory: StripDef[];
  /**
   * Ordered stripIds — the arrangement sequence. Rows render in this
   * order, not in the order they appear in the `inventory` array.
   * That keeps the Input list visually in lockstep with the Operation
   * tile's drag-to-reorder and the 3D Output. Add/remove operations
   * splice both arrays in parallel to preserve the invariant that
   * `order` is a permutation of `inventory.map(s => s.stripId)`.
   */
  order: string[];
  stripHeight: number;
  stripLength: number;
}

export interface InventoryMountOptions {
  /**
   * Called to allocate a new stripId when the user adds a strip.
   * Caller typically wires this to `allocateId(counter, 'strip')`.
   */
  allocateStripId: () => string;
  onChange: (next: InventoryState) => void;
}

export interface InventoryHandle {
  /** Rerender with a new state (e.g. after programmatic mutation). */
  update: (next: InventoryState) => void;
  /** Tear down event listeners and DOM. */
  dispose: () => void;
}

export function mountStripInventory(
  el: HTMLElement,
  initial: InventoryState,
  options: InventoryMountOptions,
): InventoryHandle {
  let state: InventoryState = cloneState(initial);

  function render(): void {
    el.innerHTML = '';
    el.appendChild(buildUi());
  }

  function buildUi(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'strip-inventory';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '0.5rem';
    wrap.style.fontSize = '0.78rem';
    wrap.style.lineHeight = '1.3';

    // Global controls (thickness + length + strip count summary)
    const globals = document.createElement('div');
    globals.style.display = 'grid';
    globals.style.gridTemplateColumns = 'auto 1fr auto 1fr';
    globals.style.gap = '0.35rem 0.5rem';
    globals.style.alignItems = 'center';

    globals.appendChild(labelFor('Thickness'));
    globals.appendChild(
      buildNumberInput(state.stripHeight, (v) => {
        if (!Number.isFinite(v) || v <= 0) return;
        state.stripHeight = v;
        emit();
      }),
    );
    globals.appendChild(labelFor('Length'));
    globals.appendChild(
      buildNumberInput(state.stripLength, (v) => {
        if (!Number.isFinite(v) || v <= 0) return;
        state.stripLength = v;
        emit();
      }),
    );
    wrap.appendChild(globals);

    // Header row
    const header = document.createElement('div');
    header.style.display = 'grid';
    header.style.gridTemplateColumns = '20px 1.2fr 1fr 24px';
    header.style.gap = '0.4rem';
    header.style.fontSize = '0.68rem';
    header.style.textTransform = 'uppercase';
    header.style.letterSpacing = '0.03em';
    header.style.color = '#888';
    header.style.marginTop = '0.25rem';
    for (const t of ['#', 'Species', 'Width (mm)', '']) {
      const cell = document.createElement('div');
      cell.textContent = t;
      header.appendChild(cell);
    }
    wrap.appendChild(header);

    // Strip rows — scrollable
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '0.25rem';
    list.style.maxHeight = '320px';
    list.style.overflowY = 'auto';
    list.style.paddingRight = '4px';

    // Render rows in arrangement order (state.order), not inventory
    // insertion order. Keeps the list visually synced with the
    // Operation tile and the 3D Output.
    const byId = new Map(state.inventory.map((s) => [s.stripId, s]));
    state.order.forEach((stripId, idx) => {
      const strip = byId.get(stripId);
      if (!strip) return; // defensive — should never happen if order is a permutation
      list.appendChild(buildRow(strip, idx));
    });
    wrap.appendChild(list);

    // Add button + count summary
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.gap = '0.5rem';
    footer.style.marginTop = '0.25rem';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Add strip';
    styleButton(addBtn);
    addBtn.disabled = state.inventory.length >= MAX_STRIPS;
    addBtn.addEventListener('click', () => {
      if (state.inventory.length >= MAX_STRIPS) return;
      // "Last" = last in the current arrangement (state.order), so a
      // newly added strip inherits the species/width of the strip
      // currently at the bottom of the displayed list.
      const lastId = state.order[state.order.length - 1];
      const last = lastId
        ? state.inventory.find((s) => s.stripId === lastId)
        : state.inventory[state.inventory.length - 1];
      const next: StripDef = {
        stripId: options.allocateStripId(),
        species: last?.species ?? 'maple',
        width: last?.width ?? 50,
      };
      state.inventory = [...state.inventory, next];
      state.order = [...state.order, next.stripId];
      emit();
      render();
    });
    footer.appendChild(addBtn);

    const count = document.createElement('span');
    count.style.color = '#888';
    count.style.fontSize = '0.7rem';
    count.textContent = `${state.inventory.length} / ${MAX_STRIPS} strips`;
    footer.appendChild(count);

    wrap.appendChild(footer);

    return wrap;
  }

  function buildRow(strip: StripDef, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '20px 1.2fr 1fr 24px';
    row.style.gap = '0.4rem';
    row.style.alignItems = 'center';

    // Colour swatch + idx
    const sw = document.createElement('div');
    sw.style.display = 'flex';
    sw.style.alignItems = 'center';
    sw.style.gap = '4px';
    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = SPECIES_COLOURS[strip.species];
    dot.style.border = '1px solid #00000033';
    sw.appendChild(dot);
    const idxLabel = document.createElement('span');
    idxLabel.style.fontSize = '0.68rem';
    idxLabel.style.color = '#888';
    idxLabel.textContent = String(idx);
    sw.appendChild(idxLabel);
    row.appendChild(sw);

    // Species dropdown
    const select = document.createElement('select');
    select.style.width = '100%';
    select.style.fontSize = '0.78rem';
    select.style.padding = '2px 4px';
    for (const sp of SPECIES_LIST) {
      const opt = document.createElement('option');
      opt.value = sp;
      opt.textContent = sp;
      if (sp === strip.species) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const sp = select.value as Species;
      state.inventory = state.inventory.map((s) =>
        s.stripId === strip.stripId ? { ...s, species: sp } : s,
      );
      emit();
      // Update dot colour without a full re-render.
      dot.style.background = SPECIES_COLOURS[sp];
    });
    row.appendChild(select);

    // Width input
    const widthInput = buildNumberInput(strip.width, (v) => {
      if (!Number.isFinite(v) || v <= 0) return;
      state.inventory = state.inventory.map((s) =>
        s.stripId === strip.stripId ? { ...s, width: v } : s,
      );
      emit();
    });
    row.appendChild(widthInput);

    // Remove button
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    styleButton(rm);
    rm.style.padding = '0';
    rm.style.width = '22px';
    rm.style.height = '22px';
    rm.style.fontSize = '0.9rem';
    rm.disabled = state.inventory.length <= MIN_STRIPS;
    rm.title = 'Remove strip';
    rm.addEventListener('click', () => {
      if (state.inventory.length <= MIN_STRIPS) return;
      state.inventory = state.inventory.filter(
        (s) => s.stripId !== strip.stripId,
      );
      state.order = state.order.filter((id) => id !== strip.stripId);
      emit();
      render();
    });
    row.appendChild(rm);

    return row;
  }

  function emit(): void {
    options.onChange(cloneState(state));
  }

  render();

  return {
    update(next: InventoryState): void {
      state = cloneState(next);
      render();
    },
    dispose(): void {
      el.innerHTML = '';
    },
  };
}

// ---- small helpers ----

function cloneState(s: InventoryState): InventoryState {
  return {
    inventory: s.inventory.map((x) => ({ ...x })),
    order: [...s.order],
    stripHeight: s.stripHeight,
    stripLength: s.stripLength,
  };
}

function labelFor(text: string): HTMLElement {
  const l = document.createElement('label');
  l.textContent = text;
  l.style.color = '#666';
  l.style.fontSize = '0.72rem';
  return l;
}

function buildNumberInput(
  value: number,
  onCommit: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.value = String(value);
  input.style.width = '100%';
  input.style.fontSize = '0.78rem';
  input.style.padding = '2px 4px';
  input.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, monospace';
  const commit = () => {
    const v = Number(input.value);
    onCommit(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.blur();
    }
  });
  return input;
}

function styleButton(btn: HTMLButtonElement): void {
  btn.style.border = '1px solid #c9c6be';
  btn.style.background = '#fff';
  btn.style.fontSize = '0.75rem';
  btn.style.padding = '3px 8px';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.color = '#222';
  btn.addEventListener('mouseenter', () => {
    if (!btn.disabled) btn.style.background = '#f2efe8';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#fff';
  });
}
