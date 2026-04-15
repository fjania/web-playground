import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  checkJoinCompat,
  classifyNormals,
  perpAxes,
  planeNormal,
} from '../src/domain/operations';
import type { FaceSelection } from '../src/domain/types';

describe('planeNormal', () => {
  it('rip=0 bevel=90 → -Z', () => {
    const n = planeNormal(0, 90);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(-1, 6);
  });

  it('rip=90 bevel=90 → +X', () => {
    const n = planeNormal(90, 90);
    expect(n.x).toBeCloseTo(1, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it('rip=-90 bevel=90 → -X', () => {
    const n = planeNormal(-90, 90);
    expect(n.x).toBeCloseTo(-1, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it('rip=0 bevel=45 tilts normal into +Y', () => {
    const n = planeNormal(0, 45);
    // Starting (0,0,-1), rotated around X by 45° → (0, sin45, -cos45).
    expect(n.y).toBeCloseTo(Math.SQRT1_2, 4);
    expect(n.z).toBeCloseTo(-Math.SQRT1_2, 4);
  });

  it('returned vector is unit length for all inputs', () => {
    for (const rip of [-45, 0, 30, 60, 90]) {
      for (const bevel of [45, 60, 90]) {
        const n = planeNormal(rip, bevel);
        expect(n.length()).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('classifyNormals', () => {
  it('identifies parallel normals', () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(1, 0, 0);
    expect(classifyNormals(a, b)).toBe('parallel');
  });

  it('identifies antiparallel normals', () => {
    const a = new Vector3(0, 1, 0);
    const b = new Vector3(0, -1, 0);
    expect(classifyNormals(a, b)).toBe('antiparallel');
  });

  it('identifies angled normals', () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 1, 0);
    expect(classifyNormals(a, b)).toBe('angled');
  });
});

describe('perpAxes', () => {
  it('returns y,z for X-aligned normal', () => {
    expect(perpAxes(new Vector3(1, 0, 0))).toEqual(['y', 'z']);
  });

  it('returns x,z for Y-aligned normal', () => {
    expect(perpAxes(new Vector3(0, 1, 0))).toEqual(['x', 'z']);
  });

  it('returns [] for a normal not aligned to any axis', () => {
    expect(perpAxes(new Vector3(1, 1, 1).normalize())).toEqual([]);
  });
});

function makeFace(normal: Vector3, planeD: number): FaceSelection {
  return {
    normal,
    centroid: normal.clone().multiplyScalar(planeD),
    u: new Vector3(),
    v: new Vector3(),
    minU: 0,
    maxU: 0,
    minV: 0,
    maxV: 0,
    width: 0,
    height: 0,
    planeD,
    rotate: false,
  };
}

describe('checkJoinCompat', () => {
  it('is not ok when either selection is missing', () => {
    expect(checkJoinCompat(null, null, null).ok).toBe(false);
  });

  it('antiparallel faces need no flip axis', () => {
    const a = makeFace(new Vector3(0, 1, 0), 10);
    const b = makeFace(new Vector3(0, -1, 0), -10);
    const r = checkJoinCompat(a, b, null);
    expect(r.ok).toBe(true);
    expect(r.needsFlipAxis).toBe(false);
  });

  it('parallel faces require a valid flip axis', () => {
    const a = makeFace(new Vector3(0, 1, 0), 10);
    const b = makeFace(new Vector3(0, 1, 0), 20);
    const noFlip = checkJoinCompat(a, b, null);
    expect(noFlip.ok).toBe(false);
    expect(noFlip.needsFlipAxis).toBe(true);
    expect(noFlip.validFlipAxes).toEqual(['x', 'z']);

    const withFlip = checkJoinCompat(a, b, 'x');
    expect(withFlip.ok).toBe(true);
  });

  it('angled faces are compatible without flip', () => {
    const a = makeFace(new Vector3(1, 0, 0), 10);
    const b = makeFace(new Vector3(0, 1, 0), 10);
    expect(checkJoinCompat(a, b, null).ok).toBe(true);
  });
});
