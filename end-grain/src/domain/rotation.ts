/**
 * Edge-based tipping algorithm — rotates a strip (or rigidly-joined
 * group of strips) so the "next" face lands flat on the bench,
 * pivoting about the actual contact edge rather than a world-aligned
 * axis.
 *
 * Why edge-based: a tapered shape (doorstop, parallelogram) has a
 * tilted contact edge. Rotating about a world-aligned axis through
 * any point of that edge swings the piece off the bench; the "drop
 * bbox to bench" step used to mask this but the pose was wrong. The
 * edge-based algorithm handles axis-aligned shapes (rect, wide,
 * wedge, bevel) and tapered shapes uniformly — their leading edges
 * just happen to be world-axis-parallel so the general algorithm
 * degenerates to the old behavior.
 *
 * Extracted from main-experiment.ts so the unit-test sweep can
 * import it without pulling in DOM-dependent scene modules.
 */

import { Vector3 } from 'three';
import { extractFaceBoundary, Strip, type StripFace } from './Strip';

export interface RotationPlan {
  /** Unit rotation axis in world space. For the tip case this is the
   *  direction of `pivotEdge`; for Y it's world +Y; for 180° flips
   *  it's the requested world axis (X or Z). */
  axisVec: Vector3;
  /** Rotation angle in radians, always positive. */
  theta: number;
  /** A point on the rotation axis — translation anchor for the conjugation. */
  pivot: Vector3;
  /** For X/Z tips: the pivot edge (bright contact edge in world space).
   *  Null for Y spins and for 180° flips (no single contact edge). */
  pivotEdge: { a: Vector3; b: Vector3 } | null;
  /** Diagnostic: id of the face on the leading strip that was chosen
   *  as F_next. Null for Y spins and for 180° flips. */
  nextFaceId: number | null;
}

/**
 * Find the current bench face of a strip — the face whose world-space
 * normal is closest to (0,-1,0). Returns null if no face passes the
 * bench-face threshold (shouldn't happen for strips sitting on the
 * bench; defensive).
 */
export function findBenchFace(strip: Strip): StripFace | null {
  const BENCH_DOT_MIN = 0.999;
  let best: { face: StripFace; dot: number } | null = null;
  for (const face of strip.faces) {
    const fc = strip.faceCenter(face.id);
    if (fc === null) continue;
    const ndown = -face.plane.normal[1];
    if (best === null || ndown > best.dot) {
      best = { face, dot: ndown };
    }
  }
  if (best === null || best.dot < BENCH_DOT_MIN) return null;
  return best.face;
}

/**
 * Find the face across the given edge — a face on any of the strips
 * whose plane contains both endpoints of the edge (within
 * `EDGE_ON_PLANE_TOL`). Excludes `excludeFaceId`.
 */
const EDGE_ON_PLANE_TOL = 0.05; // mm, generous — FP drift at 500 mm scale is ~1e-10
export function findAdjacentFace(
  strips: Strip[],
  excludeFaceId: number,
  edgeA: Vector3,
  edgeB: Vector3,
): StripFace | null {
  const pointOnPlane = (p: Vector3, face: StripFace): number => {
    const [nx, ny, nz] = face.plane.normal;
    const d = face.plane.offset;
    return Math.abs(nx * p.x + ny * p.y + nz * p.z - d);
  };
  let best: StripFace | null = null;
  let bestSlack = Infinity;
  for (const strip of strips) {
    for (const face of strip.faces) {
      if (face.id === excludeFaceId) continue;
      const fc = strip.faceCenter(face.id);
      if (fc === null) continue;
      const slackA = pointOnPlane(edgeA, face);
      const slackB = pointOnPlane(edgeB, face);
      const slack = Math.max(slackA, slackB);
      if (slack > EDGE_ON_PLANE_TOL) continue;
      if (slack < bestSlack) {
        best = face;
        bestSlack = slack;
      }
    }
  }
  return best;
}

/**
 * Compute a `RotationPlan` for rotating the given strip group around
 * the world `axis`. Returns null if no plan exists.
 *
 * X/Z algorithm:
 *   1. Find the current bench face F_current (first strip that has
 *      one; multi-strip groups joined edge-to-edge all share the
 *      same bench plane by construction).
 *   2. Extract F_current's polygon boundary.
 *   3. Of those boundary edges, keep only ones whose unit direction is
 *      aligned with the requested world axis (|dir · worldAxis| > 0.5
 *      — i.e. within 60°). This distinguishes X-rotations from
 *      Z-rotations even when the bench face has slanted edges that
 *      happen to be the leading edge in the tip direction. If no edge
 *      passes the alignment filter, the piece can't tip in that
 *      direction in any meaningful sense — return null and let the
 *      caller log "no candidate edge aligned with X|Z — skipped".
 *   4. Among the passing edges, pick the leading one in the tip
 *      direction:
 *        axis='x' (tips toward +Z) → edge whose midpoint has the
 *          largest z-coordinate.
 *        axis='z' (tips toward -X) → edge whose midpoint has the
 *          smallest x-coordinate.
 *   5. axisVec = unit edge direction, oriented so its component along
 *      the requested world axis is positive (CCW intent).
 *   6. Find F_next adjacent to F_current across this edge; compute θ
 *      so F_next's normal lands on (0,-1,0) about axisVec.
 *   7. Fallback 180° flip if no F_next found: rotate about the
 *      requested world axis through the bbox center.
 *
 * Y algorithm: classic 90° spin around world +Y through the bbox center.
 */
export function computeRotationPlan(
  groupStrips: Strip[],
  axis: 'x' | 'y' | 'z',
  bboxCenter: Vector3,
): RotationPlan | null {
  if (axis === 'y') {
    return {
      axisVec: new Vector3(0, 1, 0),
      theta: Math.PI / 2,
      pivot: bboxCenter.clone(),
      pivotEdge: null,
      nextFaceId: null,
    };
  }

  let fCurrent: { strip: Strip; face: StripFace } | null = null;
  for (const strip of groupStrips) {
    const face = findBenchFace(strip);
    if (face) {
      fCurrent = { strip, face };
      break;
    }
  }
  if (!fCurrent) return null;

  const boundary = extractFaceBoundary(fCurrent.strip, fCurrent.face.id);
  if (boundary.length === 0) return null;

  // Filter boundary edges to those aligned with the requested world
  // axis within 60° (|unitDir · worldAxis| > 0.5). The "pivot edge for
  // Rotate-X is the edge most aligned with world X" rule is what keeps
  // X-rotations and Z-rotations distinct even on slanted bench faces.
  const worldAxis =
    axis === 'x' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const ALIGN_MIN = 0.5;
  const aligned: Array<{ a: Vector3; b: Vector3 }> = [];
  for (const seg of boundary) {
    const dir = new Vector3().subVectors(seg.b, seg.a);
    if (dir.lengthSq() < 1e-12) continue;
    dir.normalize();
    if (Math.abs(dir.dot(worldAxis)) > ALIGN_MIN) aligned.push(seg);
  }
  if (aligned.length === 0) return null;

  // Among the aligned edges, pick the one leading in the tip direction
  // (+Z for Rotate-X, -X for Rotate-Z).
  const pickBy = (
    score: (mid: Vector3) => number,
    sign: 1 | -1,
  ): { a: Vector3; b: Vector3 } | null => {
    let best: { seg: { a: Vector3; b: Vector3 }; value: number } | null = null;
    for (const seg of aligned) {
      const mid = seg.a.clone().add(seg.b).multiplyScalar(0.5);
      const v = sign * score(mid);
      if (best === null || v > best.value) best = { seg, value: v };
    }
    return best?.seg ?? null;
  };
  const pivotEdge =
    axis === 'x' ? pickBy((m) => m.z, 1) : pickBy((m) => m.x, -1);
  if (!pivotEdge) return null;

  const axisVec = new Vector3().subVectors(pivotEdge.b, pivotEdge.a);
  if (axisVec.lengthSq() < 1e-12) return null;
  axisVec.normalize();
  if (axis === 'x' && axisVec.x < 0) axisVec.negate();
  else if (axis === 'z' && axisVec.z < 0) axisVec.negate();

  const fNext = findAdjacentFace(
    groupStrips,
    fCurrent.face.id,
    pivotEdge.a,
    pivotEdge.b,
  );
  if (!fNext) {
    return {
      axisVec: axis === 'x' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1),
      theta: Math.PI,
      pivot: bboxCenter.clone(),
      pivotEdge: null,
      nextFaceId: null,
    };
  }

  const n = new Vector3(
    fNext.plane.normal[0],
    fNext.plane.normal[1],
    fNext.plane.normal[2],
  );
  const down = new Vector3(0, -1, 0);
  const nProj = n.clone().sub(axisVec.clone().multiplyScalar(n.dot(axisVec)));
  const dProj = down
    .clone()
    .sub(axisVec.clone().multiplyScalar(down.dot(axisVec)));
  if (nProj.lengthSq() < 1e-12 || dProj.lengthSq() < 1e-12) return null;
  nProj.normalize();
  dProj.normalize();
  const cross = new Vector3().crossVectors(nProj, dProj);
  let theta = Math.atan2(cross.dot(axisVec), nProj.dot(dProj));
  // Keep θ positive — if negative we picked the wrong axis orientation
  // (CCW vs CW is a sign convention; flip the axis to keep the magnitude
  // positive without changing the physical rotation).
  if (theta < 0) {
    axisVec.negate();
    theta = -theta;
  }

  const pivot = pivotEdge.a.clone().add(pivotEdge.b).multiplyScalar(0.5);
  return {
    axisVec,
    theta,
    pivot,
    pivotEdge,
    nextFaceId: fNext.id,
  };
}
