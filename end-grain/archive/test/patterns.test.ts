import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { PATTERN_RULES, PATTERN_RULES_AT, applyArrangement } from '../src/domain/patterns';
import { Panel } from '../src/domain/Panel';
import '../test/setup';

describe('PATTERN_RULES', () => {
  const n = 4;
  const opts = { shift: 30 };

  it('identity returns identity matrix for every index', () => {
    for (let i = 0; i < n; i++) {
      const m = PATTERN_RULES.identity(i, n, opts);
      expect(m.equals(new Matrix4())).toBe(true);
    }
  });

  it('flipAlternate: even → identity, odd → rotY(π)', () => {
    expect(PATTERN_RULES.flipAlternate(0, n, opts).equals(new Matrix4())).toBe(true);
    const m = PATTERN_RULES.flipAlternate(1, n, opts);
    // Apply to +X — should go to -X via Y rotation.
    const v = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(-1, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  it('rotateAlternate: odd rotates about Z', () => {
    const m = PATTERN_RULES.rotateAlternate(1, n, opts);
    const v = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(-1, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it('shiftAlternate: odd translated by opts.shift along X', () => {
    const m = PATTERN_RULES.shiftAlternate(1, n, opts);
    const v = new Vector3(0, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(30, 5);
  });

  it('shiftAlternate defaults shift to 25', () => {
    const m = PATTERN_RULES.shiftAlternate(1, n, {});
    const v = new Vector3(0, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(25, 5);
  });

  it('mirrorAlternate: odd rotates about X', () => {
    const m = PATTERN_RULES.mirrorAlternate(1, n, opts);
    const v = new Vector3(0, 1, 0).applyMatrix4(m);
    expect(v.y).toBeCloseTo(-1, 5);
  });
});

describe('PATTERN_RULES_AT', () => {
  it('t=0 is identity for all rules', () => {
    const rules: Array<keyof typeof PATTERN_RULES_AT> = [
      'identity',
      'flipAlternate',
      'rotateAlternate',
      'shiftAlternate',
      'mirrorAlternate',
    ];
    for (const r of rules) {
      for (let i = 0; i < 4; i++) {
        const m = PATTERN_RULES_AT[r](i, 4, { shift: 30 }, 0);
        expect(m.equals(new Matrix4())).toBe(true);
      }
    }
  });

  it('t=1 matches PATTERN_RULES', () => {
    const opts = { shift: 30 };
    for (let i = 0; i < 4; i++) {
      const a = PATTERN_RULES.flipAlternate(i, 4, opts);
      const b = PATTERN_RULES_AT.flipAlternate(i, 4, opts, 1);
      expect(a.equals(b)).toBe(true);
    }
  });
});

describe('applyArrangement', () => {
  it('returns null for empty slice list', () => {
    expect(
      applyArrangement([], 'identity', new Vector3(1, 0, 0), 50, {}),
    ).toBeNull();
  });

  it('identity reassembles slices into a centered panel', () => {
    const source = Panel.fromStripList(
      [
        { species: 'maple', width: 50 },
        { species: 'walnut', width: 50 },
      ],
      50,
      200,
    );
    const { slices } = source.cutRepeated([0, 0, 1], 50, 4, 0);
    const out = applyArrangement(slices, 'identity', new Vector3(0, 0, 1), 50, {});
    expect(out).not.toBeNull();
    const center = new Vector3();
    out!.boundingBox().getCenter(center);
    expect(center.length()).toBeLessThan(1);
    out!.dispose();
    slices.forEach((s) => s.dispose());
    source.dispose();
  });
});
