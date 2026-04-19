import { describe, it, expect } from 'vitest';
import './setup';

import { Panel } from '../src/domain/Panel';
import type { StripDef } from '../src/state/types';

const STRIPS: StripDef[] = [
  { stripId: 'strip-0', species: 'maple', width: 50 },
  { stripId: 'strip-1', species: 'walnut', width: 50 },
];

describe('Panel.fromStrips', () => {
  it('produces one segment per strip with matching provenance', () => {
    const p = Panel.fromStrips(STRIPS, 50, 400);
    expect(p.size).toBe(2);
    expect(p.segments[0].species).toBe('maple');
    expect(p.segments[1].species).toBe('walnut');
    expect(p.segments[0].contributingStripIds).toEqual(['strip-0']);
    expect(p.segments[1].contributingStripIds).toEqual(['strip-1']);
    p.dispose();
  });

  it('panel bbox spans the full strip block', () => {
    const p = Panel.fromStrips(STRIPS, 50, 400);
    const bb = p.boundingBox();
    expect(bb.min.x).toBeCloseTo(-50, 6);
    expect(bb.max.x).toBeCloseTo(50, 6);
    expect(bb.min.y).toBeCloseTo(-25, 6);
    expect(bb.max.y).toBeCloseTo(25, 6);
    expect(bb.min.z).toBeCloseTo(-200, 6);
    expect(bb.max.z).toBeCloseTo(200, 6);
    p.dispose();
  });
});

describe('Panel.toSnapshot', () => {
  it('produces a JSON-serialisable snapshot with per-volume provenance', () => {
    const p = Panel.fromStrips(STRIPS, 50, 400);
    const snap = p.toSnapshot();

    // Snapshot is plain data — roundtrip via JSON with no loss.
    const roundtripped = JSON.parse(JSON.stringify(snap));
    expect(roundtripped).toEqual(snap);

    expect(snap.volumes).toHaveLength(2);
    expect(snap.volumes[0].species).toBe('maple');
    expect(snap.volumes[0].contributingStripIds).toEqual(['strip-0']);
    expect(snap.volumes[1].species).toBe('walnut');
    expect(snap.volumes[1].contributingStripIds).toEqual(['strip-1']);

    // Whole-panel bbox in the snapshot matches boundingBox().
    expect(snap.bbox.min[0]).toBeCloseTo(-50, 6);
    expect(snap.bbox.max[0]).toBeCloseTo(50, 6);
    p.dispose();
  });
});

describe('Panel.cut', () => {
  it('slicing preserves provenance on both sides', () => {
    const p = Panel.fromStrips(STRIPS, 50, 400);
    // Cut through the panel at z=0 — half the length of each strip
    // ends up on each side. Both halves retain the full set of
    // contributing strip ids.
    const { above, below } = p.cut([0, 0, 1], 0);
    expect(above.size).toBe(2);
    expect(below.size).toBe(2);
    expect(above.segments[0].contributingStripIds).toEqual(['strip-0']);
    expect(above.segments[1].contributingStripIds).toEqual(['strip-1']);
    expect(below.segments[0].contributingStripIds).toEqual(['strip-0']);
    expect(below.segments[1].contributingStripIds).toEqual(['strip-1']);
    p.dispose();
    above.dispose();
    below.dispose();
  });
});

describe('Panel.cutRepeated', () => {
  it('cuts the panel into N slices of uniform pitch', () => {
    const p = Panel.fromStrips(STRIPS, 50, 400);
    // count=8 at pitch=50 covers the full 400mm length: 8 inner
    // slices plus 2 (empty-ish) end offcuts.
    const { slices, offcuts } = p.cutRepeated([0, 0, 1], 50, 8);
    expect(slices).toHaveLength(8);
    expect(offcuts).toHaveLength(2);

    for (const s of slices) {
      const ext = s.measureAlong([0, 0, 1]).extent;
      expect(ext).toBeCloseTo(50, 5);
      // Each slice still has both maple and walnut segments.
      expect(s.size).toBe(2);
    }

    p.dispose();
    for (const s of slices) s.dispose();
    for (const o of offcuts) o.dispose();
  });
});

describe('Panel.measureAlong', () => {
  it('reports the correct extent along each axis for a straight panel', () => {
    const p = Panel.fromStrips(STRIPS, 50, 400);
    expect(p.measureAlong([1, 0, 0]).extent).toBeCloseTo(100, 5);
    expect(p.measureAlong([0, 1, 0]).extent).toBeCloseTo(50, 5);
    expect(p.measureAlong([0, 0, 1]).extent).toBeCloseTo(400, 5);
    p.dispose();
  });
});
