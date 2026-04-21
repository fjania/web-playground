/**
 * Edit helpers — canonical operations for mutating the PlaceEdit list
 * attached to an Arrange feature.
 *
 * The Arrange revamp (branch `feat/arrange-revamp`) moves authoring
 * from a form-per-edit model to direct manipulation on a selected set
 * of slices. That selection-first model needs a small set of pure
 * helpers that encode the revamp's rules:
 *
 *   1. **At most one rotate edit per slice**, at most one shift edit
 *      per slice. Flip / rotate / shift actions replace the existing
 *      edit rather than appending a new one. Keeps the snapshot
 *      canonical and eliminates "which of these two 180° edits on
 *      slice 3 actually applied?" ambiguity.
 *
 *   2. **Identity edits drop.** A rotate of 0° or a shift of 0 mm is
 *      the same as no edit, so we don't keep them in the list.
 *
 *   3. **Flip is a toggle** on the existing rotation: `F` XORs 180°
 *      onto current, so 0 ↔ 180, 90 ↔ 270. Twice flipping returns
 *      to the start.
 *
 *   4. **R cycles** 0 → 90 → 180 → 270 → 0.
 *
 * These helpers take the current `edits` array, a set of slice
 * indexes to act on, and a context with the Arrange id + an id
 * allocator, and return a new edits array. They preserve the id of
 * any existing edit they mutate so Svelte's keyed reconciliation and
 * any future undo history stay stable.
 */

import type { PlaceEdit } from './types';

/** Canonical rotation values the UI authors in. */
export type RotateDegrees = 0 | 90 | 180 | 270;

/** Snap any degree to the nearest quarter-turn in [0, 360). */
export function canonicalDegrees(deg: number): RotateDegrees {
  const mod = ((Math.round(deg) % 360) + 360) % 360;
  // Snap to nearest of 0/90/180/270.
  const options: RotateDegrees[] = [0, 90, 180, 270];
  let best: RotateDegrees = 0;
  let bestDist = Infinity;
  for (const d of options) {
    const dist = Math.min(Math.abs(d - mod), 360 - Math.abs(d - mod));
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Effective rotation applied to `sliceIdx` given the current edit
 * list. Reads last-wins so denormalized lists still produce a
 * sensible answer, but callers should prefer normalized lists.
 */
export function rotationForSlice(edits: PlaceEdit[], sliceIdx: number): RotateDegrees {
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.target.sliceIdx === sliceIdx && e.op.kind === 'rotate') {
      return canonicalDegrees(e.op.degrees);
    }
  }
  return 0;
}

/** Effective shift applied to `sliceIdx` (mm). */
export function shiftForSlice(edits: PlaceEdit[], sliceIdx: number): number {
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.target.sliceIdx === sliceIdx && e.op.kind === 'shift') {
      return e.op.delta;
    }
  }
  return 0;
}

export interface EditContext {
  /** The Arrange feature's id — stamped into every new PlaceEdit's target. */
  arrangeId: string;
  /** Produces a fresh edit id. Typically `() => allocateId(counter, 'edit')`. */
  allocateId: () => string;
}

function buildRotate(
  ctx: EditContext,
  sliceIdx: number,
  degrees: RotateDegrees,
  existingId?: string,
): PlaceEdit {
  return {
    kind: 'placeEdit',
    id: existingId ?? ctx.allocateId(),
    target: { arrangeId: ctx.arrangeId, sliceIdx },
    op: { kind: 'rotate', degrees },
    status: 'ok',
  };
}

function buildShift(
  ctx: EditContext,
  sliceIdx: number,
  delta: number,
  existingId?: string,
): PlaceEdit {
  return {
    kind: 'placeEdit',
    id: existingId ?? ctx.allocateId(),
    target: { arrangeId: ctx.arrangeId, sliceIdx },
    op: { kind: 'shift', delta },
    status: 'ok',
  };
}

function buildReorder(
  ctx: EditContext,
  fromPos: number,
  newIdx: number,
): PlaceEdit {
  return {
    kind: 'placeEdit',
    id: ctx.allocateId(),
    // `target.sliceIdx` here is a POSITION in the current (post-prior-
    // edits) sequence, per the pipeline's reorderSequence semantics.
    target: { arrangeId: ctx.arrangeId, sliceIdx: fromPos },
    op: { kind: 'reorder', newIdx },
    status: 'ok',
  };
}

interface StripResult {
  filtered: PlaceEdit[];
  existingId?: string;
}

/**
 * Remove every edit on `sliceIdx` whose op.kind matches, returning the
 * filtered list plus the id of the first removed edit so callers can
 * preserve identity when replacing it.
 */
function stripKind(edits: PlaceEdit[], sliceIdx: number, kind: 'rotate' | 'shift'): StripResult {
  let existingId: string | undefined;
  const filtered: PlaceEdit[] = [];
  for (const e of edits) {
    if (e.target.sliceIdx === sliceIdx && e.op.kind === kind) {
      if (!existingId) existingId = e.id;
      continue;
    }
    filtered.push(e);
  }
  return { filtered, existingId };
}

/**
 * Toggle the flip (180°) state of each slice in `sliceIdxs`. XORs
 * 180° onto the current rotation. If the result is 0°, the rotate
 * edit is dropped; otherwise it's replaced in place (id preserved).
 */
export function toggleFlip(
  edits: PlaceEdit[],
  sliceIdxs: Iterable<number>,
  ctx: EditContext,
): PlaceEdit[] {
  let next = edits;
  for (const sliceIdx of sliceIdxs) {
    const current = rotationForSlice(next, sliceIdx);
    const newDeg = canonicalDegrees(current + 180);
    const { filtered, existingId } = stripKind(next, sliceIdx, 'rotate');
    next = newDeg === 0 ? filtered : [...filtered, buildRotate(ctx, sliceIdx, newDeg, existingId)];
  }
  return next;
}

/**
 * Rotate each slice in `sliceIdxs` by +90°. Cycles 0 → 90 → 180 →
 * 270 → 0. When the cycle returns to 0° the rotate edit is dropped.
 */
export function rotate90(
  edits: PlaceEdit[],
  sliceIdxs: Iterable<number>,
  ctx: EditContext,
): PlaceEdit[] {
  let next = edits;
  for (const sliceIdx of sliceIdxs) {
    const current = rotationForSlice(next, sliceIdx);
    const newDeg = canonicalDegrees(current + 90);
    const { filtered, existingId } = stripKind(next, sliceIdx, 'rotate');
    next = newDeg === 0 ? filtered : [...filtered, buildRotate(ctx, sliceIdx, newDeg, existingId)];
  }
  return next;
}

/**
 * Set the shift delta on each slice in `sliceIdxs`. A delta of 0
 * drops the edit. Existing edit id preserved when replacing.
 */
export function setShift(
  edits: PlaceEdit[],
  sliceIdxs: Iterable<number>,
  delta: number,
  ctx: EditContext,
): PlaceEdit[] {
  let next = edits;
  const normalized = Math.round(delta);
  for (const sliceIdx of sliceIdxs) {
    const { filtered, existingId } = stripKind(next, sliceIdx, 'shift');
    next =
      normalized === 0
        ? filtered
        : [...filtered, buildShift(ctx, sliceIdx, normalized, existingId)];
  }
  return next;
}

/**
 * Append a reorder edit: move the slice currently at visible
 * position `fromPos` to position `toPos`. A no-op (`fromPos ===
 * toPos`) returns the input list unchanged. Appended at the tail
 * so it composes with any prior reorders via the pipeline's
 * sequential `reorderSequence` replay.
 */
export function reorderSlice(
  edits: PlaceEdit[],
  fromPos: number,
  toPos: number,
  ctx: EditContext,
): PlaceEdit[] {
  if (fromPos === toPos) return edits;
  return [...edits, buildReorder(ctx, fromPos, toPos)];
}

/**
 * Remove all rotate + shift edits on the given slices.
 */
export function clearEditsOnSlices(
  edits: PlaceEdit[],
  sliceIdxs: Iterable<number>,
): PlaceEdit[] {
  const set = new Set<number>();
  for (const i of sliceIdxs) set.add(i);
  return edits.filter((e) => !set.has(e.target.sliceIdx));
}

/**
 * Canonicalize an edit list:
 *   - At most one rotate + one shift per slice (last-write-wins).
 *   - Identity rotate (0°) / shift (0 mm) dropped.
 *   - `reorder` edits (legacy kind) pass through untouched.
 *
 * Use when ingesting edits from persisted designs or preset
 * expansions that may not have been authored through the new
 * selection-based helpers.
 */
export function normalizeEdits(edits: PlaceEdit[]): PlaceEdit[] {
  const rotates = new Map<number, PlaceEdit>();
  const shifts = new Map<number, PlaceEdit>();
  const others: PlaceEdit[] = [];
  for (const e of edits) {
    if (e.op.kind === 'rotate') rotates.set(e.target.sliceIdx, e);
    else if (e.op.kind === 'shift') shifts.set(e.target.sliceIdx, e);
    else others.push(e);
  }
  const out: PlaceEdit[] = [...others];
  for (const e of rotates.values()) {
    if (e.op.kind !== 'rotate') continue;
    const d = canonicalDegrees(e.op.degrees);
    if (d === 0) continue;
    out.push({ ...e, op: { kind: 'rotate', degrees: d } });
  }
  for (const e of shifts.values()) {
    if (e.op.kind !== 'shift') continue;
    if (e.op.delta === 0) continue;
    out.push({ ...e });
  }
  return out;
}
