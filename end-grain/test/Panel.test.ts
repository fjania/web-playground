import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { Panel } from '../src/domain/Panel';
import '../test/setup';

function makeTestPanel(): Panel {
  return Panel.fromStripList(
    [
      { species: 'maple', width: 50 },
      { species: 'walnut', width: 50 },
      { species: 'maple', width: 50 },
    ],
    50,
    400,
  );
}

describe('Panel.fromStripList', () => {
  it('creates one segment per strip', () => {
    const panel = makeTestPanel();
    expect(panel.size).toBe(3);
    panel.dispose();
  });

  it('centers the assembled panel about origin along X', () => {
    const panel = makeTestPanel();
    const bb = panel.boundingBox();
    const center = new Vector3();
    bb.getCenter(center);
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
    panel.dispose();
  });

  it('honors variable widths', () => {
    const panel = Panel.fromStripList(
      [
        { species: 'maple', width: 30 },
        { species: 'walnut', width: 70 },
      ],
      50,
      400,
    );
    const bb = panel.boundingBox();
    expect(bb.max.x - bb.min.x).toBeCloseTo(100, 3);
    panel.dispose();
  });
});

describe('Panel.cutRepeated', () => {
  it('produces `count` slices plus 2 offcut placeholders', () => {
    const panel = makeTestPanel();
    const { slices, offcuts } = panel.cutRepeated([1, 0, 0], 25, 4, 0);
    expect(slices.length).toBe(4);
    expect(offcuts.length).toBe(2);
    slices.forEach((s) => s.dispose());
    offcuts.forEach((o) => o.dispose());
    panel.dispose();
  });

  it('returns empty slices when count < 1', () => {
    const panel = makeTestPanel();
    const { slices, offcuts } = panel.cutRepeated([1, 0, 0], 25, 0);
    expect(slices).toEqual([]);
    expect(offcuts).toEqual([]);
    panel.dispose();
  });

  it('offcuts are non-empty when slices leave margins', () => {
    // Panel is 150mm wide along X. 4 slices × 25mm = 100mm centered → 25mm
    // of material falls outside the slice band on each side.
    const panel = makeTestPanel();
    const { slices, offcuts } = panel.cutRepeated([1, 0, 0], 25, 4, 0);
    expect(slices.length).toBe(4);
    expect(offcuts[0].size).toBeGreaterThan(0);
    expect(offcuts[1].size).toBeGreaterThan(0);
    slices.forEach((s) => s.dispose());
    offcuts.forEach((o) => o.dispose());
    panel.dispose();
  });
});

describe('Panel.transform / clone / concat', () => {
  it('clone produces independent manifold handles', () => {
    const panel = makeTestPanel();
    const cloned = panel.clone();
    expect(cloned.size).toBe(panel.size);
    // Disposing original does not crash cloned access.
    panel.dispose();
    const bb = cloned.boundingBox();
    expect(bb.max.x - bb.min.x).toBeCloseTo(150, 3);
    cloned.dispose();
  });

  it('transform bakes the matrix into new manifolds', () => {
    const panel = makeTestPanel();
    const moved = panel.transform(new Matrix4().makeTranslation(100, 0, 0));
    const center = new Vector3();
    moved.boundingBox().getCenter(center);
    expect(center.x).toBeCloseTo(100, 3);
    moved.dispose();
    panel.dispose();
  });

  it('concat combines segments without duplicating handles', () => {
    const a = makeTestPanel();
    const b = makeTestPanel();
    const combined = a.concat(b);
    expect(combined.size).toBe(a.size + b.size);
    // Note: combined shares segments with a and b — disposing any one
    // aliases into the others. Here we just dispose combined.
    combined.dispose();
  });
});
