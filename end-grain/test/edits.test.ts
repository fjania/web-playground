import { describe, it, expect } from 'vitest';
import './setup';

import {
  canonicalDegrees,
  clearEditsOnSlices,
  normalizeEdits,
  rotate90,
  rotationForSlice,
  setShift,
  shiftForSlice,
  toggleFlip,
  type EditContext,
} from '../src/state/edits';
import type { PlaceEdit } from '../src/state/types';

// ----------------------------------------------------------------------
// Test helpers
// ----------------------------------------------------------------------

function makeCtx(arrangeId = 'arrange-0'): { ctx: EditContext; nextId: () => string } {
  let n = 0;
  const alloc = () => `edit-${n++}`;
  return {
    ctx: { arrangeId, allocateId: alloc },
    nextId: alloc,
  };
}

function makeRotate(sliceIdx: number, degrees: number, id = `edit-${sliceIdx}`): PlaceEdit {
  return {
    kind: 'placeEdit',
    id,
    target: { arrangeId: 'arrange-0', sliceIdx },
    op: { kind: 'rotate', degrees },
    status: 'ok',
  };
}

function makeShift(sliceIdx: number, delta: number, id = `edit-${sliceIdx}`): PlaceEdit {
  return {
    kind: 'placeEdit',
    id,
    target: { arrangeId: 'arrange-0', sliceIdx },
    op: { kind: 'shift', delta },
    status: 'ok',
  };
}

function rotatesFor(edits: PlaceEdit[], sliceIdx: number): PlaceEdit[] {
  return edits.filter(
    (e) => e.target.sliceIdx === sliceIdx && e.op.kind === 'rotate',
  );
}

function shiftsFor(edits: PlaceEdit[], sliceIdx: number): PlaceEdit[] {
  return edits.filter(
    (e) => e.target.sliceIdx === sliceIdx && e.op.kind === 'shift',
  );
}

// ----------------------------------------------------------------------

describe('canonicalDegrees', () => {
  it('snaps integers to {0, 90, 180, 270}', () => {
    expect(canonicalDegrees(0)).toBe(0);
    expect(canonicalDegrees(90)).toBe(90);
    expect(canonicalDegrees(180)).toBe(180);
    expect(canonicalDegrees(270)).toBe(270);
  });

  it('wraps past 360', () => {
    expect(canonicalDegrees(360)).toBe(0);
    expect(canonicalDegrees(450)).toBe(90);
    expect(canonicalDegrees(720)).toBe(0);
  });

  it('wraps negatives', () => {
    expect(canonicalDegrees(-90)).toBe(270);
    expect(canonicalDegrees(-180)).toBe(180);
    expect(canonicalDegrees(-270)).toBe(90);
  });

  it('snaps near-canonical values to closest', () => {
    expect(canonicalDegrees(89)).toBe(90);
    expect(canonicalDegrees(91)).toBe(90);
    expect(canonicalDegrees(46)).toBe(90); // closer to 90 than 0
    expect(canonicalDegrees(44)).toBe(0);
    // Equidistant between 0 and 90 — implementation picks 0 (first
    // option with strictly < comparison). Not load-bearing; pinned so
    // a change here is intentional.
    expect(canonicalDegrees(45)).toBe(0);
  });
});

describe('rotationForSlice / shiftForSlice', () => {
  it('returns 0 when no edit exists', () => {
    expect(rotationForSlice([], 0)).toBe(0);
    expect(shiftForSlice([], 0)).toBe(0);
  });

  it('reads the latest rotate edit when multiple exist (denormalized)', () => {
    const edits = [makeRotate(1, 90, 'a'), makeRotate(1, 270, 'b')];
    expect(rotationForSlice(edits, 1)).toBe(270);
  });
});

describe('toggleFlip', () => {
  it('flipping an unedited slice adds a 180° rotate', () => {
    const { ctx } = makeCtx();
    const next = toggleFlip([], [3], ctx);
    expect(next).toHaveLength(1);
    expect(next[0].op).toEqual({ kind: 'rotate', degrees: 180 });
    expect(next[0].target.sliceIdx).toBe(3);
  });

  it('flipping twice returns to no edit', () => {
    const { ctx } = makeCtx();
    const once = toggleFlip([], [3], ctx);
    const twice = toggleFlip(once, [3], ctx);
    expect(twice).toEqual([]);
  });

  it('flip on a 90° slice produces 270°', () => {
    const { ctx } = makeCtx();
    const seed = [makeRotate(1, 90, 'e-1')];
    const next = toggleFlip(seed, [1], ctx);
    expect(rotationForSlice(next, 1)).toBe(270);
    // id preserved from the existing edit, not a fresh allocation.
    expect(rotatesFor(next, 1)[0].id).toBe('e-1');
  });

  it('flipping multiple slices at once', () => {
    const { ctx } = makeCtx();
    const next = toggleFlip([], [1, 3, 5], ctx);
    expect(next).toHaveLength(3);
    expect(rotationForSlice(next, 1)).toBe(180);
    expect(rotationForSlice(next, 3)).toBe(180);
    expect(rotationForSlice(next, 5)).toBe(180);
  });

  it('never duplicates rotate edits on the same slice', () => {
    const { ctx } = makeCtx();
    let edits: PlaceEdit[] = [];
    for (let i = 0; i < 4; i++) edits = toggleFlip(edits, [2], ctx);
    // 4 flips = back to 0, no rotate on slice 2
    expect(rotatesFor(edits, 2)).toHaveLength(0);
  });

  it('leaves shift edits alone', () => {
    const { ctx } = makeCtx();
    const seed = [makeShift(1, 15, 's-1')];
    const next = toggleFlip(seed, [1], ctx);
    expect(shiftsFor(next, 1)).toHaveLength(1);
    expect(rotatesFor(next, 1)).toHaveLength(1);
  });
});

describe('rotate90', () => {
  it('cycles 0 → 90 → 180 → 270 → 0', () => {
    const { ctx } = makeCtx();
    let edits: PlaceEdit[] = [];
    edits = rotate90(edits, [0], ctx);
    expect(rotationForSlice(edits, 0)).toBe(90);
    edits = rotate90(edits, [0], ctx);
    expect(rotationForSlice(edits, 0)).toBe(180);
    edits = rotate90(edits, [0], ctx);
    expect(rotationForSlice(edits, 0)).toBe(270);
    edits = rotate90(edits, [0], ctx);
    expect(rotationForSlice(edits, 0)).toBe(0);
    expect(rotatesFor(edits, 0)).toHaveLength(0);
  });

  it('combined with flip produces the expected XOR', () => {
    const { ctx } = makeCtx();
    let edits: PlaceEdit[] = [];
    // Rotate to 90, then flip → 270
    edits = rotate90(edits, [1], ctx);
    edits = toggleFlip(edits, [1], ctx);
    expect(rotationForSlice(edits, 1)).toBe(270);
  });
});

describe('setShift', () => {
  it('creates a shift edit on an unedited slice', () => {
    const { ctx } = makeCtx();
    const next = setShift([], [2], 15, ctx);
    expect(next).toHaveLength(1);
    expect(next[0].op).toEqual({ kind: 'shift', delta: 15 });
  });

  it('replaces (not appends) when a shift already exists', () => {
    const { ctx } = makeCtx();
    const seed = [makeShift(2, 5, 's-1')];
    const next = setShift(seed, [2], 20, ctx);
    expect(shiftsFor(next, 2)).toHaveLength(1);
    expect(shiftsFor(next, 2)[0].op).toEqual({ kind: 'shift', delta: 20 });
    // id preserved
    expect(shiftsFor(next, 2)[0].id).toBe('s-1');
  });

  it('drops the edit when delta is 0', () => {
    const { ctx } = makeCtx();
    const seed = [makeShift(2, 5)];
    const next = setShift(seed, [2], 0, ctx);
    expect(shiftsFor(next, 2)).toHaveLength(0);
  });

  it('rounds fractional deltas to the nearest integer mm', () => {
    const { ctx } = makeCtx();
    const next = setShift([], [0], 12.6, ctx);
    expect((next[0].op as { kind: 'shift'; delta: number }).delta).toBe(13);
  });

  it('applies to multiple slices uniformly', () => {
    const { ctx } = makeCtx();
    const next = setShift([], [1, 3, 5], 10, ctx);
    expect(shiftForSlice(next, 1)).toBe(10);
    expect(shiftForSlice(next, 3)).toBe(10);
    expect(shiftForSlice(next, 5)).toBe(10);
  });

  it('does not touch rotate edits on the same slice', () => {
    const { ctx } = makeCtx();
    const seed = [makeRotate(1, 180, 'r-1')];
    const next = setShift(seed, [1], 5, ctx);
    expect(rotatesFor(next, 1)[0].id).toBe('r-1');
    expect(shiftsFor(next, 1)[0].op).toMatchObject({ kind: 'shift', delta: 5 });
  });
});

describe('clearEditsOnSlices', () => {
  it('removes both rotate and shift on targeted slices', () => {
    const seed = [
      makeRotate(1, 180, 'r-1'),
      makeShift(1, 5, 's-1'),
      makeRotate(2, 90, 'r-2'),
    ];
    const next = clearEditsOnSlices(seed, [1]);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('r-2');
  });

  it('leaves untargeted slices untouched', () => {
    const seed = [makeRotate(1, 180, 'r-1'), makeShift(2, 5, 's-2')];
    const next = clearEditsOnSlices(seed, [3]);
    expect(next).toEqual(seed);
  });
});

describe('normalizeEdits', () => {
  it('collapses duplicate rotate edits on the same slice (last wins)', () => {
    const seed = [makeRotate(1, 90, 'a'), makeRotate(1, 270, 'b')];
    const next = normalizeEdits(seed);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('b');
    expect((next[0].op as { kind: 'rotate'; degrees: number }).degrees).toBe(270);
  });

  it('drops identity rotate (0°)', () => {
    const seed = [makeRotate(1, 0)];
    expect(normalizeEdits(seed)).toEqual([]);
  });

  it('drops identity shift (0 mm)', () => {
    const seed = [makeShift(1, 0)];
    expect(normalizeEdits(seed)).toEqual([]);
  });

  it('snaps non-canonical degrees to nearest quarter-turn', () => {
    const seed = [makeRotate(1, 89)];
    const next = normalizeEdits(seed);
    expect((next[0].op as { kind: 'rotate'; degrees: number }).degrees).toBe(90);
  });

  it('preserves rotate + shift on the same slice (one of each kind)', () => {
    const seed = [makeRotate(1, 180, 'r'), makeShift(1, 5, 's')];
    const next = normalizeEdits(seed);
    expect(next).toHaveLength(2);
    expect(rotatesFor(next, 1)).toHaveLength(1);
    expect(shiftsFor(next, 1)).toHaveLength(1);
  });

});
