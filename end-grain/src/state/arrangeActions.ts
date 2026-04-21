/**
 * Shared Arrange-stage action helpers.
 *
 * Both the workbench (`Workbench.svelte`) and the focused Arrange
 * harness (`ArrangeApp.svelte` via `ArrangeControls.svelte`) need
 * the same selection + keyboard + toolbar behaviour. Keeping the
 * logic here means neither host can silently drift from the other.
 *
 * All helpers take an `ArrangeActionContext` — a small bag of
 * accessors / mutators the host owns (timeline, selection state,
 * id allocation). That keeps the helpers pure of host state and
 * testable in isolation.
 */

import {
  clearEditsOnSlices as editsClearOnSlices,
  reorderSlice as editsReorderSlice,
  rotate90 as editsRotate90,
  setShift as editsSetShift,
  shiftForSlice as editsShiftForSlice,
  toggleFlip as editsToggleFlip,
  type EditContext,
} from './edits';
import type { PlaceEdit } from './types';

export interface ArrangeActionContext {
  /** Current number of upstream slices (domain for selection ops). */
  sliceCount: number;
  /** Current selection set + last-click anchor (for range selection). */
  selection: { set: Set<number>; anchor: number | null };
  /** Current PlaceEdits targeting this Arrange. */
  edits: PlaceEdit[];
  /** Host writes the next selection state. */
  setSelection: (set: Set<number>, anchor: number | null) => void;
  /** Host writes the next PlaceEdits list (replaces edits for this Arrange). */
  setEdits: (next: PlaceEdit[]) => void;
  /** Host mints a new PlaceEdit id. */
  allocateEditId: () => string;
  /** The arrange being edited — used to scope EditContext. */
  arrangeId: string;
}

function editCtx(a: ArrangeActionContext): EditContext {
  return { arrangeId: a.arrangeId, allocateId: a.allocateEditId };
}

// ---- Selection-set helpers ----

export function selectAll(a: ArrangeActionContext): void {
  const s = new Set<number>();
  for (let i = 0; i < a.sliceCount; i++) s.add(i);
  a.setSelection(s, a.sliceCount > 0 ? a.sliceCount - 1 : null);
}

export function selectNone(a: ArrangeActionContext): void {
  // Leave anchor in place so shift+click still makes sense.
  a.setSelection(new Set(), a.selection.anchor);
}

export function invertSelection(a: ArrangeActionContext): void {
  const s = new Set<number>();
  for (let i = 0; i < a.sliceCount; i++) if (!a.selection.set.has(i)) s.add(i);
  a.setSelection(s, a.selection.anchor);
}

export function selectEvery(a: ArrangeActionContext, offset: 0 | 1): void {
  const s = new Set<number>();
  for (let i = offset; i < a.sliceCount; i += 2) s.add(i);
  a.setSelection(s, s.size > 0 ? Math.max(...s) : null);
}

// ---- Edit-mutation helpers (act on current selection) ----

export function flipSelection(a: ArrangeActionContext): void {
  if (a.selection.set.size === 0) return;
  a.setEdits(editsToggleFlip(a.edits, a.selection.set, editCtx(a)));
}

export function rotate90Selection(a: ArrangeActionContext): void {
  if (a.selection.set.size === 0) return;
  a.setEdits(editsRotate90(a.edits, a.selection.set, editCtx(a)));
}

export function clearSelectionEdits(a: ArrangeActionContext): void {
  if (a.selection.set.size === 0) return;
  a.setEdits(editsClearOnSlices(a.edits, a.selection.set));
}

export function reorderSlice(
  a: ArrangeActionContext,
  fromPos: number,
  toPos: number,
): void {
  a.setEdits(editsReorderSlice(a.edits, fromPos, toPos, editCtx(a)));
}

export function applyShiftDelta(a: ArrangeActionContext, delta: number): void {
  if (a.selection.set.size === 0) return;
  let next = a.edits;
  for (const idx of a.selection.set) {
    const current = editsShiftForSlice(next, idx);
    next = editsSetShift(next, [idx], current + delta, editCtx(a));
  }
  a.setEdits(next);
}

export function setShiftForSlice(
  a: ArrangeActionContext,
  sliceIdx: number,
  delta: number,
): void {
  a.setEdits(editsSetShift(a.edits, [sliceIdx], delta, editCtx(a)));
}

// ---- Keyboard handler ----

/**
 * Dispatch a keyboard event to the matching action. Returns true if
 * the event was handled (caller should preventDefault() and stop
 * propagation if it cares); false if unhandled (caller may let the
 * browser do its default thing).
 *
 * Text-input events are a no-op so typing into shift chips / renames
 * isn't stolen.
 */
export function handleArrangeKey(
  a: ArrangeActionContext,
  e: KeyboardEvent,
): boolean {
  const tgt = e.target as HTMLElement | null;
  if (
    tgt &&
    (tgt.tagName === 'INPUT' ||
      tgt.tagName === 'TEXTAREA' ||
      tgt.isContentEditable)
  ) {
    return false;
  }
  if (a.sliceCount === 0) return false;

  const key = e.key;
  const cmdLike = e.metaKey || e.ctrlKey;

  switch (key) {
    case 'f':
    case 'F':
      flipSelection(a);
      return true;
    case 'r':
    case 'R':
      rotate90Selection(a);
      return true;
    case 'Escape':
      selectNone(a);
      return true;
    case 'a':
    case 'A':
      if (cmdLike) return false; // leave cmd/ctrl+A to the browser
      selectAll(a);
      return true;
    case 'i':
    case 'I':
      invertSelection(a);
      return true;
    case 'e':
    case 'E':
      selectEvery(a, 0);
      return true;
    case 'o':
    case 'O':
      selectEvery(a, 1);
      return true;
    case 'Delete':
    case 'Backspace':
      clearSelectionEdits(a);
      return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (a.selection.set.size === 0) return false;
      const step = e.shiftKey ? 5 : 1;
      const dir = key === 'ArrowLeft' ? -1 : 1;
      applyShiftDelta(a, dir * step);
      return true;
    }
    case '0': {
      if (a.selection.set.size === 0) return false;
      const next = editsSetShift(
        a.edits,
        Array.from(a.selection.set),
        0,
        editCtx(a),
      );
      a.setEdits(next);
      return true;
    }
  }
  return false;
}
