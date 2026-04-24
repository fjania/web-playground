/**
 * Regression — three consecutive X rotations on a doorstop. Covers the
 * bug where the "leading midpoint" heuristic picked a Z-aligned edge
 * on the third step (the same edge a Z rotation would pick), so X and
 * Z rotations converged to the same rotation.
 *
 * Guards the fix: `computeRotationPlan` filters boundary edges to
 * those aligned within 60° of the requested world axis, so Rotate-X
 * is guaranteed to pivot about an X-aligned edge and Rotate-Z about a
 * Z-aligned one.
 */
import { describe, it, expect } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import './setup';

import { buildDoorstop } from '../src/domain/stripShapes';
import { computeRotationPlan } from '../src/domain/rotation';
import { Strip } from '../src/domain/Strip';
import type { Species } from '../src/state/types';

const PAIR: [Species, Species] = ['maple', 'walnut'];
const BENCH_Y = 0;

function placeOnBench(strip: Strip): Strip {
  const bench = strip.translate(0, 25, 0);
  strip.dispose();
  return bench;
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
  const nbb = rotated.boundingBox();
  const dy = BENCH_Y - nbb.min.y;
  if (Math.abs(dy) > 1e-9) {
    const dropped = rotated.translate(0, dy, 0);
    rotated.dispose();
    return dropped;
  }
  return rotated;
}

describe('doorstop three-X regression', () => {
  it('each X rotation picks an X-aligned pivot edge, differing from the Z-rotate pivot', () => {
    let strip = placeOnBench(buildDoorstop('doorstop', PAIR));

    for (let step = 1; step <= 3; step++) {
      const center = strip.boundingBox().getCenter(new Vector3());
      const planX = computeRotationPlan([strip], 'x', center);
      const planZ = computeRotationPlan([strip], 'z', center);

      // Either planX has no candidate (valid — piece can't tip +Z) OR
      // its pivot edge is X-aligned.
      if (planX && planX.pivotEdge) {
        const dirX = new Vector3()
          .subVectors(planX.pivotEdge.b, planX.pivotEdge.a)
          .normalize();
        const alignX = Math.abs(dirX.x);
        expect(
          alignX,
          `step ${step}: X-rotate picked an edge with |dir·X|=${alignX.toFixed(3)} (<0.5)`,
        ).toBeGreaterThan(0.5);

        // X-rotate and Z-rotate must never pick the SAME edge midpoint.
        if (planZ && planZ.pivotEdge) {
          const midX = planX.pivotEdge.a.clone().add(planX.pivotEdge.b).multiplyScalar(0.5);
          const midZ = planZ.pivotEdge.a.clone().add(planZ.pivotEdge.b).multiplyScalar(0.5);
          const d = midX.distanceTo(midZ);
          expect(
            d,
            `step ${step}: X and Z rotations chose the same pivot edge (midpoint distance = ${d.toFixed(3)})`,
          ).toBeGreaterThan(1);
        }

        strip = applyPlan(strip, planX);
      } else {
        // No plan — valid: piece can't tip +Z at this pose. Stop the
        // loop since further steps don't make sense.
        break;
      }
    }

    strip.dispose();
  });
});
