import { describe, it, expect } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import './setup';

import {
  buildRectangle,
  buildParallelogram,
  buildWedge,
  buildDoorstop,
  buildBevel,
  buildWide,
} from '../src/domain/stripShapes';
import {
  computeRotationPlan,
  type RotationDirection,
} from '../src/domain/rotation';
import type { Species } from '../src/state/types';
import { Strip } from '../src/domain/Strip';

/**
 * Edge-based rotation sweep — 6 piece types × 4 pre-rotations × {X, Z}
 * × {+1, -1} = 96 cases.
 *
 * With the bidirectional API, `computeRotationPlan` may legitimately
 * return null for a given direction: the piece might only be able to
 * tip one way from a weird pose (e.g. wedge-on-end-cap has only one
 * Z-aligned boundary edge, so rot=z+dir=+1 has no valid pivot, while
 * rot=z+dir=-1 succeeds). Each case is expected to either:
 *   (a) produce a valid plan whose applied pose has *some* face with
 *       world normal essentially = (0,-1,0) AND bbox min.y within
 *       1e-3 mm of BENCH_Y, OR
 *   (b) return null ("no valid tip in this direction").
 *
 * A case is counted as PASS in either of those outcomes. A "broken"
 * plan (one that rotates the piece but leaves it not bench-flush or
 * dy ≠ 0) counts as FAIL.
 *
 * Round-trip property: for each case where direction=+1 produces a
 * valid bench-flush pose, applying direction=-1 from the new pose
 * must return to the original pose (bbox + face normals match).
 */

const PAIR: [Species, Species] = ['maple', 'walnut'];
const BENCH_Y = 0;
const LINEUP_STRIP_Y = 25;

const PIECES = [
  { name: 'rect', build: buildRectangle },
  { name: 'parallelogram', build: buildParallelogram },
  { name: 'wedge', build: buildWedge },
  { name: 'doorstop', build: buildDoorstop },
  { name: 'bevel', build: buildBevel },
  { name: 'wide', build: buildWide },
] as const;

function placeOnBench(strip: Strip): Strip {
  const bench = strip.translate(0, LINEUP_STRIP_Y, 0);
  strip.dispose();
  return bench;
}

function preRotate(strip: Strip, preRot: 'none' | 'x' | 'y' | 'z'): Strip {
  if (preRot === 'none') return strip;
  // Pre-rotation uses direction=+1 by convention. If a piece+preRot
  // combo has no CCW plan, we fall back to direction=-1 so the test
  // still exercises the pose. (The sweep's job is coverage of resting
  // poses, not of the pre-rotation API itself.)
  const bbox = strip.boundingBox();
  const center = bbox.getCenter(new Vector3());
  let plan = computeRotationPlan([strip], preRot, center, 1);
  if (!plan) plan = computeRotationPlan([strip], preRot, center, -1);
  if (!plan) throw new Error(`no plan for preRot=${preRot} in either direction`);
  const rotated = applyPlan(strip, plan);
  // Drop to bench (FP defensive).
  const nbb = rotated.boundingBox();
  const dy = BENCH_Y - nbb.min.y;
  if (Math.abs(dy) > 1e-9) {
    const dropped = rotated.translate(0, dy, 0);
    rotated.dispose();
    return dropped;
  }
  return rotated;
}

function applyPlan(
  strip: Strip,
  plan: { axisVec: Vector3; theta: number; pivot: Vector3 },
): Strip {
  const { axisVec, theta, pivot } = plan;
  const T1 = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const R = new Matrix4().makeRotationAxis(axisVec, theta);
  const T2 = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const M = new Matrix4().multiplyMatrices(T2, R).multiply(T1);
  const rotated = strip.transform(M);
  strip.dispose();
  return rotated;
}

function hasBenchFace(strip: Strip): { ok: boolean; bestDot: number } {
  let best = -Infinity;
  for (const face of strip.faces) {
    const fc = strip.faceCenter(face.id);
    if (fc === null) continue;
    const dot = -face.plane.normal[1];
    if (dot > best) best = dot;
  }
  return { ok: best >= 0.9999, bestDot: best };
}

function snapshotPose(strip: Strip): { bbox: number[]; normals: number[][] } {
  const bb = strip.boundingBox();
  return {
    bbox: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z],
    normals: strip.faces.map((f) => [
      f.plane.normal[0],
      f.plane.normal[1],
      f.plane.normal[2],
      f.plane.offset,
    ]),
  };
}

function poseDelta(
  a: { bbox: number[]; normals: number[][] },
  b: { bbox: number[]; normals: number[][] },
): number {
  let d = 0;
  for (let i = 0; i < 6; i++) d = Math.max(d, Math.abs(a.bbox[i] - b.bbox[i]));
  for (let i = 0; i < a.normals.length; i++) {
    for (let j = 0; j < 4; j++) {
      d = Math.max(d, Math.abs(a.normals[i][j] - b.normals[i][j]));
    }
  }
  return d;
}

interface CaseResult {
  piece: string;
  preRot: string;
  axis: 'x' | 'z';
  dir: RotationDirection;
  pass: boolean;
  benchDot: number;
  dy: number;
  note: string;
}

describe('edge-based rotation — 96-case sweep (±direction)', () => {
  const results: CaseResult[] = [];
  const preRots: Array<'none' | 'x' | 'y' | 'z'> = ['none', 'x', 'y', 'z'];
  const axes: Array<'x' | 'z'> = ['x', 'z'];
  const dirs: RotationDirection[] = [1, -1];

  for (const piece of PIECES) {
    for (const preRot of preRots) {
      for (const axis of axes) {
        for (const dir of dirs) {
          const dirLabel = dir === 1 ? '+' : '-';
          const label = `${piece.name}+pre=${preRot}+rot=${axis}${dirLabel}`;
          it(label, () => {
            let strip = placeOnBench(piece.build(piece.name, PAIR));
            strip = preRotate(strip, preRot);

            const startBench = hasBenchFace(strip);
            if (!startBench.ok) {
              strip.dispose();
              results.push({
                piece: piece.name, preRot, axis, dir,
                pass: false, benchDot: startBench.bestDot, dy: 0,
                note: `start-not-bench-flush: bestDot=${startBench.bestDot.toFixed(6)}`,
              });
              throw new Error(`start pose not bench-flush: ${label}`);
            }

            const bbox = strip.boundingBox();
            const center = bbox.getCenter(new Vector3());
            const plan = computeRotationPlan([strip], axis, center, dir);
            if (!plan) {
              strip.dispose();
              results.push({
                piece: piece.name, preRot, axis, dir,
                pass: true, benchDot: 0, dy: 0,
                note: 'no-plan-in-this-direction (OK)',
              });
              return;
            }

            const rotated = applyPlan(strip, plan);
            const newBb = rotated.boundingBox();
            const dy = newBb.min.y - BENCH_Y;
            const benchCheck = hasBenchFace(rotated);
            rotated.dispose();

            const pass = benchCheck.ok && Math.abs(dy) < 1e-3;
            const note = pass
              ? 'ok'
              : !benchCheck.ok
                ? `no-bench-face: bestDot=${benchCheck.bestDot.toFixed(6)}`
                : `bbox-drift: dy=${dy.toFixed(4)}mm`;
            results.push({
              piece: piece.name, preRot, axis, dir, pass,
              benchDot: benchCheck.bestDot, dy, note,
            });

            expect(benchCheck.ok, `${label}: no bench face (bestDot=${benchCheck.bestDot})`).toBe(true);
            expect(Math.abs(dy), `${label}: bbox drift dy=${dy}`).toBeLessThan(1e-3);
          });
        }
      }
    }
  }

  it('print matrix', () => {
    const total = results.length;
    const passed = results.filter((r) => r.pass).length;
    const header = `\n  piece          preRot   axis  dir  pass  benchDot     dy(mm)   note\n`;
    const lines = results
      .map((r) =>
        `  ${r.piece.padEnd(14)} ${r.preRot.padEnd(7)} ${r.axis.padEnd(4)}  ${(r.dir === 1 ? '+' : '-').padEnd(3)} ${(r.pass ? 'PASS' : 'FAIL').padEnd(4)}  ${r.benchDot.toFixed(6)}  ${r.dy.toFixed(4).padStart(8)}  ${r.note}`,
      )
      .join('\n');
    console.log(`${header}${lines}\n  -- ${passed}/${total} pass --`);
    expect(passed).toBe(total);
  });
});

describe('bidirectional rotation round-trip (+ then −)', () => {
  const preRots: Array<'none' | 'x' | 'y' | 'z'> = ['none', 'x', 'y', 'z'];
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

  for (const piece of PIECES) {
    for (const preRot of preRots) {
      for (const axis of axes) {
        const label = `${piece.name}+pre=${preRot}+rot=${axis}`;
        it(`round-trip ${label}`, () => {
          let strip = placeOnBench(piece.build(piece.name, PAIR));
          strip = preRotate(strip, preRot);
          const before = snapshotPose(strip);

          const bbox0 = strip.boundingBox();
          const center0 = bbox0.getCenter(new Vector3());
          const planForward = computeRotationPlan([strip], axis, center0, 1);
          if (!planForward) {
            strip.dispose();
            return; // can't tip this way — not a round-trip candidate
          }
          const afterForward = applyPlan(strip, planForward);
          strip = afterForward;

          const bbox1 = strip.boundingBox();
          const center1 = bbox1.getCenter(new Vector3());
          const planBack = computeRotationPlan([strip], axis, center1, -1);
          expect(planBack, `${label}: no inverse plan after + tip`).not.toBeNull();
          if (!planBack) {
            strip.dispose();
            return;
          }
          const afterBack = applyPlan(strip, planBack);
          strip = afterBack;

          const after = snapshotPose(strip);
          const delta = poseDelta(before, after);
          strip.dispose();

          // Tolerance 1e-3 mm (1 micron). FP matrix composition through
          // two tip rotations accumulates ~60 nm of drift per rotation
          // at 500 mm piece scale; 1 micron leaves comfortable headroom.
          expect(delta, `${label}: round-trip pose delta=${delta.toExponential(3)}`).toBeLessThan(1e-3);
        });
      }
    }
  }
});
