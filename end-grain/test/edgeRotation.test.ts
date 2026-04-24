import { describe, it, expect } from 'vitest';
import { Box3, Matrix4, Vector3 } from 'three';
import './setup';

import {
  buildRectangle,
  buildParallelogram,
  buildWedge,
  buildDoorstop,
  buildBevel,
  buildWide,
} from '../src/domain/stripShapes';
import { computeRotationPlan } from '../src/domain/rotation';
import type { Species } from '../src/state/types';
import { Strip } from '../src/domain/Strip';

/**
 * Edge-based rotation sweep — 6 piece types × 4 pre-rotations × {X, Z}
 * = 48 cases. For each case:
 *   (a) The computed plan produces a pose where *some* face has a
 *       world normal essentially = (0,-1,0).
 *   (b) The group's post-rotation bbox min.y is within 1e-3 mm of
 *       BENCH_Y, before any drop-to-bench safety net runs.
 *
 * Assertion (b) is the geometric validation: if the tip-edge is the
 * real contact edge, the piece pivots in contact with the bench and
 * no drift occurs. Legacy world-axis rotation for tapered shapes
 * would fail this — the piece swings off the bench and (b)'s dy
 * would be nonzero.
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

/**
 * Place a freshly-built strip onto the bench (its -Y face at y=0), then
 * apply an axis-aligned pre-rotation (a sequence of 90° turns around X,
 * Y, or Z) followed by a drop-to-bench so the starting pose is always
 * feasible for a rotation test.
 */
function placeOnBench(strip: Strip): Strip {
  const bench = strip.translate(0, LINEUP_STRIP_Y, 0);
  strip.dispose();
  return bench;
}

function preRotate(strip: Strip, preRot: 'none' | 'x' | 'y' | 'z'): Strip {
  if (preRot === 'none') return strip;
  // Pre-rotate by the edge-based algorithm itself — that way the
  // starting pose is still a valid bench-flush pose even for tapered
  // shapes.
  const bbox = strip.boundingBox();
  const center = bbox.getCenter(new Vector3());
  const plan = computeRotationPlan([strip], preRot, center);
  if (!plan) throw new Error(`no plan for preRot=${preRot}`);
  const { axisVec, theta, pivot } = plan;
  const T1 = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const R = new Matrix4().makeRotationAxis(axisVec, theta);
  const T2 = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const M = new Matrix4().multiplyMatrices(T2, R).multiply(T1);
  const rotated = strip.transform(M);
  strip.dispose();
  // Drop to bench.
  const nbb = rotated.boundingBox();
  const dy = BENCH_Y - nbb.min.y;
  if (Math.abs(dy) > 1e-9) {
    const dropped = rotated.translate(0, dy, 0);
    rotated.dispose();
    return dropped;
  }
  return rotated;
}

function applyPlan(strip: Strip, plan: { axisVec: Vector3; theta: number; pivot: Vector3 }): Strip {
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

interface CaseResult {
  piece: string;
  preRot: string;
  axis: 'x' | 'z';
  pass: boolean;
  benchDot: number;
  dy: number;
  note: string;
}

describe('edge-based rotation — 48-case sweep', () => {
  const results: CaseResult[] = [];
  const preRots: Array<'none' | 'x' | 'y' | 'z'> = ['none', 'x', 'y', 'z'];
  const axes: Array<'x' | 'z'> = ['x', 'z'];

  for (const piece of PIECES) {
    for (const preRot of preRots) {
      for (const axis of axes) {
        const label = `${piece.name}+pre=${preRot}+rot=${axis}`;
        it(label, () => {
          let strip = placeOnBench(piece.build(piece.name, PAIR));
          try {
            strip = preRotate(strip, preRot);
          } catch (err) {
            results.push({
              piece: piece.name, preRot, axis, pass: false, benchDot: 0, dy: 0,
              note: `preRot-failed: ${(err as Error).message}`,
            });
            throw err;
          }

          // Sanity: start pose has a bench face.
          const startBench = hasBenchFace(strip);
          if (!startBench.ok) {
            strip.dispose();
            results.push({
              piece: piece.name, preRot, axis, pass: false, benchDot: startBench.bestDot, dy: 0,
              note: `start-not-bench-flush: bestDot=${startBench.bestDot.toFixed(6)}`,
            });
            throw new Error(`start pose not bench-flush: ${label}`);
          }

          const bbox = strip.boundingBox();
          const center = bbox.getCenter(new Vector3());
          const plan = computeRotationPlan([strip], axis, center);
          if (!plan) {
            strip.dispose();
            results.push({
              piece: piece.name, preRot, axis, pass: false, benchDot: 0, dy: 0,
              note: 'no-plan',
            });
            throw new Error(`no plan for ${label}`);
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
            piece: piece.name, preRot, axis, pass,
            benchDot: benchCheck.bestDot, dy, note,
          });

          expect(benchCheck.ok, `${label}: no bench face (bestDot=${benchCheck.bestDot})`).toBe(true);
          expect(Math.abs(dy), `${label}: bbox drift dy=${dy}`).toBeLessThan(1e-3);
        });
      }
    }
  }

  it('print matrix', () => {
    const total = results.length;
    const passed = results.filter((r) => r.pass).length;
    const header = `\n  piece          preRot   axis  pass  benchDot     dy(mm)   note\n`;
    const lines = results
      .map((r) =>
        `  ${r.piece.padEnd(14)} ${r.preRot.padEnd(7)} ${r.axis.padEnd(4)}  ${(r.pass ? 'PASS' : 'FAIL').padEnd(4)}  ${r.benchDot.toFixed(6)}  ${r.dy.toFixed(4).padStart(8)}  ${r.note}`,
      )
      .join('\n');
    console.log(`${header}${lines}\n  -- ${passed}/${total} pass --`);
    expect(passed).toBe(total);
  });
});
