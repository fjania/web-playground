/**
 * Arrange edit list — reusable DOM component for authoring the
 * PlaceEdits and SpacerInserts attached to an Arrange feature.
 *
 * Not direct manipulation (that's M2 / #27-#29). This is a
 * form-based edit list — a flat list of current edits, each a
 * deletable row with controls for its parameters, plus buttons at
 * the bottom to add new edits.
 *
 * Shape:
 *   - Plain DOM, mount(el, state, options) → handle API.
 *   - State = { edits: PlaceEdit[], spacers: SpacerInsert[] }, plus
 *     an `allocateId` callback for new-edit ID minting (same pattern
 *     as strip-inventory.ts).
 *   - onChange fires with the full next { edits, spacers } on any
 *     add / remove / edit.
 *
 * Used by the workbench canvas in M1. Will go back into the Arrange
 * harness once the canvas settles.
 */

import type { PlaceEdit, SpacerInsert, Species } from '../state/types';
import { SPECIES_COLOURS } from '../render/summary';

const SPECIES_LIST: Species[] = ['maple', 'walnut', 'cherry', 'padauk', 'purpleheart'];

export interface ArrangeEditListState {
  arrangeId: string;
  edits: PlaceEdit[];
  spacers: SpacerInsert[];
  /** Number of slices currently produced by the upstream Cut, for bounds on slice index inputs. */
  sliceCount: number;
}

export interface ArrangeEditListOptions {
  /** Allocate a unique id for newly-added edits/spacers. */
  allocateId: (prefix: 'edit' | 'spacer') => string;
  onChange: (next: { edits: PlaceEdit[]; spacers: SpacerInsert[] }) => void;
}

export interface ArrangeEditListHandle {
  update: (next: ArrangeEditListState) => void;
  dispose: () => void;
}

export function mountArrangeEditList(
  el: HTMLElement,
  initial: ArrangeEditListState,
  options: ArrangeEditListOptions,
): ArrangeEditListHandle {
  let state: ArrangeEditListState = cloneState(initial);

  function render(): void {
    el.innerHTML = '';
    el.appendChild(build());
  }

  function build(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'arrange-edit-list';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '0.35rem';
    wrap.style.fontSize = '0.72rem';

    // --- header ------------------------------------------------------
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'baseline';
    header.style.gap = '0.4rem';
    header.style.color = '#888';
    header.style.fontSize = '0.66rem';

    const title = document.createElement('span');
    title.textContent = `${state.edits.length + state.spacers.length} edits`;
    title.style.color = '#222';
    title.style.fontWeight = '600';
    header.appendChild(title);

    const ctx = document.createElement('span');
    ctx.textContent = `· ${state.sliceCount} slices`;
    ctx.style.fontFamily = 'ui-monospace, monospace';
    header.appendChild(ctx);

    wrap.appendChild(header);

    // --- list --------------------------------------------------------
    // No internal max-height / overflow — the stage card grows to
    // fit all rows. Long lists make the whole stage tall, matching
    // "tiles grow with their content" rule.
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '0.2rem';
    list.style.paddingRight = '2px';

    // Interleave edits + spacers by slice idx for readability.
    const items: Array<
      { kind: 'edit'; idx: number; e: PlaceEdit } | { kind: 'spacer'; idx: number; s: SpacerInsert }
    > = [];
    state.edits.forEach((e) => items.push({ kind: 'edit', idx: e.target.sliceIdx, e }));
    state.spacers.forEach((s) => items.push({ kind: 'spacer', idx: s.afterSliceIdx, s }));
    items.sort((a, b) => a.idx - b.idx);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '0.4rem 0.15rem';
      empty.style.color = '#888';
      empty.style.fontSize = '0.68rem';
      empty.textContent = 'No edits yet. Add one below.';
      list.appendChild(empty);
    } else {
      for (const item of items) {
        list.appendChild(item.kind === 'edit' ? buildEditRow(item.e) : buildSpacerRow(item.s));
      }
    }
    wrap.appendChild(list);

    // --- add buttons -------------------------------------------------
    const addRow = document.createElement('div');
    addRow.style.display = 'flex';
    addRow.style.gap = '0.3rem';
    addRow.style.flexWrap = 'wrap';
    addRow.style.paddingTop = '0.25rem';

    addRow.appendChild(
      makeAddButton('+ flip', () => {
        state.edits = [
          ...state.edits,
          {
            kind: 'placeEdit',
            id: options.allocateId('edit'),
            target: { arrangeId: state.arrangeId, sliceIdx: 0 },
            op: { kind: 'rotate', degrees: 180 },
            status: 'ok',
          },
        ];
        emitAndRender();
      }),
    );
    addRow.appendChild(
      makeAddButton('+ rotate', () => {
        state.edits = [
          ...state.edits,
          {
            kind: 'placeEdit',
            id: options.allocateId('edit'),
            target: { arrangeId: state.arrangeId, sliceIdx: 0 },
            op: { kind: 'rotate', degrees: 90 },
            status: 'ok',
          },
        ];
        emitAndRender();
      }),
    );
    addRow.appendChild(
      makeAddButton('+ shift', () => {
        state.edits = [
          ...state.edits,
          {
            kind: 'placeEdit',
            id: options.allocateId('edit'),
            target: { arrangeId: state.arrangeId, sliceIdx: 0 },
            op: { kind: 'shift', delta: 10 },
            status: 'ok',
          },
        ];
        emitAndRender();
      }),
    );
    addRow.appendChild(
      makeAddButton('+ spacer', () => {
        state.spacers = [
          ...state.spacers,
          {
            kind: 'spacerInsert',
            id: options.allocateId('spacer'),
            arrangeId: state.arrangeId,
            afterSliceIdx: 0,
            species: 'walnut',
            width: 5,
            status: 'ok',
          },
        ];
        emitAndRender();
      }),
    );

    wrap.appendChild(addRow);

    return wrap;
  }

  function buildEditRow(edit: PlaceEdit): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '24px 54px 38px 1fr 20px';
    row.style.gap = '0.3rem';
    row.style.alignItems = 'center';
    row.style.padding = '1px 2px';

    // glyph / kind badge
    const glyph = document.createElement('span');
    glyph.style.fontWeight = '700';
    glyph.style.textAlign = 'center';
    glyph.style.color = '#555';
    glyph.textContent = glyphFor(edit);
    row.appendChild(glyph);

    // slice idx input
    const sliceInput = numberInput(edit.target.sliceIdx, 0, Math.max(0, state.sliceCount - 1), 1, (v) => {
      state.edits = state.edits.map((e) =>
        e.id === edit.id ? { ...e, target: { ...e.target, sliceIdx: v } } : e,
      );
      emit();
    });
    sliceInput.title = 'slice index';
    row.appendChild(sliceInput);

    // label (slice idx)
    const label = document.createElement('span');
    label.style.fontSize = '0.62rem';
    label.style.color = '#888';
    label.style.fontFamily = 'ui-monospace, monospace';
    label.textContent = 'slice';
    row.appendChild(label);

    // op-specific value editor
    row.appendChild(buildOpValueEditor(edit));

    // remove
    row.appendChild(
      makeRmButton(() => {
        state.edits = state.edits.filter((e) => e.id !== edit.id);
        emitAndRender();
      }),
    );

    return row;
  }

  function buildOpValueEditor(edit: PlaceEdit): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '0.3rem';
    wrap.style.fontSize = '0.66rem';

    if (edit.op.kind === 'rotate') {
      const deg = edit.op.degrees;
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.style.display = 'inline-flex';
      seg.style.border = '1px solid #d6d3cd';
      seg.style.borderRadius = '3px';
      seg.style.overflow = 'hidden';
      for (const d of [90, 180, 270]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = `${d}°`;
        btn.style.border = 'none';
        btn.style.background = deg === d ? '#fff3dc' : '#fff';
        btn.style.color = deg === d ? '#5b4a2e' : '#666';
        btn.style.padding = '1px 6px';
        btn.style.fontSize = '0.64rem';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'inherit';
        btn.addEventListener('click', () => {
          state.edits = state.edits.map((e) =>
            e.id === edit.id && e.op.kind === 'rotate'
              ? { ...e, op: { ...e.op, degrees: d } }
              : e,
          );
          emitAndRender();
        });
        seg.appendChild(btn);
      }
      // Separator lines between buttons.
      ensureSegStyle();
      wrap.appendChild(seg);
    } else if (edit.op.kind === 'shift') {
      const input = numberInput(edit.op.delta, -200, 200, 1, (v) => {
        state.edits = state.edits.map((e) =>
          e.id === edit.id && e.op.kind === 'shift' ? { ...e, op: { ...e.op, delta: v } } : e,
        );
        emit();
      });
      input.title = 'shift delta (mm)';
      input.style.width = '60px';
      wrap.appendChild(input);
      const unit = document.createElement('span');
      unit.textContent = 'mm';
      unit.style.color = '#888';
      wrap.appendChild(unit);
    } else if (edit.op.kind === 'reorder') {
      const input = numberInput(edit.op.newIdx, 0, Math.max(0, state.sliceCount - 1), 1, (v) => {
        state.edits = state.edits.map((e) =>
          e.id === edit.id && e.op.kind === 'reorder' ? { ...e, op: { ...e.op, newIdx: v } } : e,
        );
        emit();
      });
      input.title = 'new index';
      input.style.width = '60px';
      wrap.appendChild(input);
      const unit = document.createElement('span');
      unit.textContent = '→ new idx';
      unit.style.color = '#888';
      wrap.appendChild(unit);
    }
    return wrap;
  }

  function buildSpacerRow(spacer: SpacerInsert): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '24px 54px 38px 1fr 20px';
    row.style.gap = '0.3rem';
    row.style.alignItems = 'center';
    row.style.padding = '1px 2px';

    // Glyph: small rectangle in species colour suggests a spacer.
    const glyph = document.createElement('span');
    glyph.style.display = 'inline-block';
    glyph.style.width = '14px';
    glyph.style.height = '14px';
    glyph.style.margin = '0 auto';
    glyph.style.borderRadius = '1px';
    glyph.style.border = '1px solid #00000033';
    glyph.style.background = SPECIES_COLOURS[spacer.species];
    row.appendChild(glyph);

    const afterInput = numberInput(spacer.afterSliceIdx, 0, Math.max(0, state.sliceCount - 1), 1, (v) => {
      state.spacers = state.spacers.map((s) =>
        s.id === spacer.id ? { ...s, afterSliceIdx: v } : s,
      );
      emit();
    });
    afterInput.title = 'after slice index';
    row.appendChild(afterInput);

    const label = document.createElement('span');
    label.style.fontSize = '0.62rem';
    label.style.color = '#888';
    label.style.fontFamily = 'ui-monospace, monospace';
    label.textContent = 'after';
    row.appendChild(label);

    // Species select + width
    const values = document.createElement('div');
    values.style.display = 'flex';
    values.style.alignItems = 'center';
    values.style.gap = '0.3rem';
    values.style.fontSize = '0.66rem';

    const sel = document.createElement('select');
    sel.style.fontSize = '0.64rem';
    sel.style.padding = '1px 3px';
    sel.style.border = '1px solid #d6d3cd';
    sel.style.borderRadius = '2px';
    sel.style.background = '#fff';
    for (const sp of SPECIES_LIST) {
      const opt = document.createElement('option');
      opt.value = sp;
      opt.textContent = sp;
      if (sp === spacer.species) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      const sp = sel.value as Species;
      state.spacers = state.spacers.map((s) => (s.id === spacer.id ? { ...s, species: sp } : s));
      emitAndRender();
    });
    values.appendChild(sel);

    const widthInput = numberInput(spacer.width, 1, 100, 1, (v) => {
      state.spacers = state.spacers.map((s) => (s.id === spacer.id ? { ...s, width: v } : s));
      emit();
    });
    widthInput.title = 'spacer width (mm)';
    widthInput.style.width = '46px';
    values.appendChild(widthInput);

    const unit = document.createElement('span');
    unit.textContent = 'mm';
    unit.style.color = '#888';
    values.appendChild(unit);

    row.appendChild(values);

    row.appendChild(
      makeRmButton(() => {
        state.spacers = state.spacers.filter((s) => s.id !== spacer.id);
        emitAndRender();
      }),
    );

    return row;
  }

  function emitAndRender(): void {
    emit();
    render();
  }

  function emit(): void {
    options.onChange({
      edits: state.edits.map(cloneEdit),
      spacers: state.spacers.map((s) => ({ ...s })),
    });
  }

  render();

  return {
    update(next: ArrangeEditListState): void {
      state = cloneState(next);
      render();
    },
    dispose(): void {
      el.innerHTML = '';
    },
  };
}

// ---- helpers ----

function glyphFor(edit: PlaceEdit): string {
  switch (edit.op.kind) {
    case 'rotate':
      return edit.op.degrees === 180 ? '↻' : '↻';
    case 'shift':
      return '⇢';
    case 'reorder':
      return '#';
  }
}

function numberInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onCommit: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.width = '46px';
  input.style.padding = '1px 3px';
  input.style.border = '1px solid #d6d3cd';
  input.style.borderRadius = '2px';
  input.style.fontFamily = 'ui-monospace, monospace';
  input.style.fontSize = '0.64rem';
  input.style.background = '#fff';
  input.style.minWidth = '0';
  const commit = () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    onCommit(Math.max(min, Math.min(max, Math.floor(v))));
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); input.blur(); }
  });
  return input;
}

function makeAddButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.border = '1px dashed #c9c6be';
  btn.style.background = '#fff';
  btn.style.color = '#666';
  btn.style.padding = '2px 8px';
  btn.style.fontSize = '0.66rem';
  btn.style.borderRadius = '3px';
  btn.style.cursor = 'pointer';
  btn.style.fontFamily = 'inherit';
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#8a6a44'; btn.style.color = '#5b4a2e'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#c9c6be'; btn.style.color = '#666'; });
  btn.addEventListener('click', onClick);
  return btn;
}

function makeRmButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '×';
  btn.title = 'Remove';
  btn.style.width = '18px';
  btn.style.height = '18px';
  btn.style.padding = '0';
  btn.style.border = '1px solid #d6d3cd';
  btn.style.background = '#fff';
  btn.style.color = '#888';
  btn.style.fontSize = '0.85rem';
  btn.style.lineHeight = '1';
  btn.style.cursor = 'pointer';
  btn.style.borderRadius = '2px';
  btn.addEventListener('click', onClick);
  return btn;
}

let segStyleInjected = false;
function ensureSegStyle(): void {
  if (segStyleInjected) return;
  const s = document.createElement('style');
  s.textContent = `
    .arrange-edit-list .seg button + button {
      border-left: 1px solid #d6d3cd;
    }
  `;
  document.head.appendChild(s);
  segStyleInjected = true;
}

function cloneEdit(e: PlaceEdit): PlaceEdit {
  return {
    kind: 'placeEdit',
    id: e.id,
    target: { ...e.target },
    op: { ...e.op } as PlaceEdit['op'],
    status: e.status,
    ...(e.statusReason ? { statusReason: e.statusReason } : {}),
  };
}

function cloneState(s: ArrangeEditListState): ArrangeEditListState {
  return {
    arrangeId: s.arrangeId,
    edits: s.edits.map(cloneEdit),
    spacers: s.spacers.map((x) => ({ ...x })),
    sliceCount: s.sliceCount,
  };
}
