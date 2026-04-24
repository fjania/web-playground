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
   *  direction of `pivotEdge`, oriented so its component along the
   *  requested world axis is positive; for Y it's world +Y; for 180°
   *  flips it's the requested world axis (X or Z). With axisVec pinned
   *  to the positive world-axis side, the sign of `theta` directly
   *  encodes rotation direction (positive = right-hand-rule CCW). */
  axisVec: Vector3;
  /** Rotation angle in radians — signed. Magnitude is the dihedral
   *  from F_current to F_next (or π/2 for Y, π for 180° fallback);
   *  sign is the requested direction (+1 / -1). */
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

/** Rotation direction: +1 = right-hand-rule CCW about the requested
 *  world axis; -1 = the opposite (CW). The two directions share the
 *  same pivot-edge + θ-magnitude math — they differ only in which side
 *  of F_current becomes the leading edge (+1 picks the tip-toward edge,
 *  -1 picks the opposite side) and in the sign of the returned θ. */
export type RotationDirection = 1 | -1;

/**
 * Compute a `RotationPlan` for rotating the given strip group around
 * the world `axis` in the given `direction` (+1 = CCW, -1 = CW).
 * Returns null if no plan exists.
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
 *        axis='x', direction=+1 (tips toward +Z) → max midpoint.z.
 *        axis='x', direction=-1 (tips toward -Z) → min midpoint.z.
 *        axis='z', direction=+1 (tips toward -X) → min midpoint.x.
 *        axis='z', direction=-1 (tips toward +X) → max midpoint.x.
 *   5. axisVec = unit edge direction, oriented so its component along
 *      the requested world axis is positive. This keeps the axis
 *      consistent between + and -, so the sign of the returned θ
 *      unambiguously maps to right-hand-rule CCW/CW.
 *   6. Find F_next adjacent to F_current across this edge; compute the
 *      unsigned dihedral θ₀ that brings F_next's normal onto (0,-1,0).
 *      Return `direction · θ₀` so the pose lands on the bench either
 *      way.
 *   7. Fallback 180° flip if no F_next found: rotate about the
 *      requested world axis through the bbox center. (180° is its own
 *      inverse, so direction doesn't affect the landing pose — we
 *      still return direction·π for consistency with preview arcs.)
 *
 * Y algorithm: 90° spin around world +Y through the bbox center,
 * signed by direction.
 *
 * Round-trip property: for any axis where a plan exists both ways,
 * `computeRotationPlan(strips, axis, +1)` followed by applying the
 * plan, then `computeRotationPlan(newStrips, axis, -1)` and applying
 * THAT plan, returns the strips to their original pose — because the
 * two plans pivot about the same tilted edge (the rotation's own
 * contact edge), with θ negated.
 */
export function computeRotationPlan(
  groupStrips: Strip[],
  axis: 'x' | 'y' | 'z',
  bboxCenter: Vector3,
  direction: RotationDirection = 1,
): RotationPlan | null {
  if (axis === 'y') {
    return {
      axisVec: new Vector3(0, 1, 0),
      theta: direction * (Math.PI / 2),
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

  // For each aligned edge, figure out whether rotating about it (CCW
  // about +worldAxis) brings the adjacent face onto the bench with
  // positive theta (rawTheta>0) or negative theta (rawTheta<0). The
  // sign of rawTheta is the geometry's verdict on which physical
  // direction this edge tips: positive = CCW about +worldAxis, negative
  // = CW. We keep only edges whose direction matches `direction`, then
  // pick the leading one (max/min x/z of midpoint) among the matching
  // subset.
  //
  // This "filter-by-rawTheta-sign, then leading" order matters for
  // non-rectangular bench faces (parallelogram, skewed tapers) where
  // multiple aligned edges exist but only one tips in each direction.
  // For a rectangular bench face, exactly one edge on each side has
  // a valid tip; the leading-edge picker resolves ties on position.
  const worldAxisNeg = worldAxis.clone().negate();
  interface Candidate {
    edge: { a: Vector3; b: Vector3 };
    axisVec: Vector3;
    rawTheta: number;
    fNext: StripFace;
  }
  const candidates: Candidate[] = [];
  for (const edge of aligned) {
    const axisVecRaw = new Vector3().subVectors(edge.b, edge.a);
    if (axisVecRaw.lengthSq() < 1e-12) continue;
    axisVecRaw.normalize();
    // Orient axisVec so it agrees with +worldAxis (pinned positive).
    // With axisVec fixed, the sign of rawTheta unambiguously encodes
    // the rotation's CCW/CW direction about +worldAxis.
    if (axis === 'x' && axisVecRaw.x < 0) axisVecRaw.negate();
    else if (axis === 'z' && axisVecRaw.z < 0) axisVecRaw.negate();
    // Skip edges not aligned closely enough — shouldn't happen after
    // the 60° filter, but defensive.
    if (axisVecRaw.dot(worldAxis) < ALIGN_MIN && axisVecRaw.dot(worldAxisNeg) < ALIGN_MIN) continue;

    const fNext = findAdjacentFace(
      groupStrips,
      fCurrent.face.id,
      edge.a,
      edge.b,
    );
    if (!fNext) continue;

    const n = new Vector3(
      fNext.plane.normal[0],
      fNext.plane.normal[1],
      fNext.plane.normal[2],
    );
    const down = new Vector3(0, -1, 0);
    const nProj = n.clone().sub(axisVecRaw.clone().multiplyScalar(n.dot(axisVecRaw)));
    const dProj = down
      .clone()
      .sub(axisVecRaw.clone().multiplyScalar(down.dot(axisVecRaw)));
    if (nProj.lengthSq() < 1e-12 || dProj.lengthSq() < 1e-12) continue;
    nProj.normalize();
    dProj.normalize();
    const cross = new Vector3().crossVectors(nProj, dProj);
    const rawTheta = Math.atan2(cross.dot(axisVecRaw), nProj.dot(dProj));
    // Skip degenerate 0° tips.
    if (Math.abs(rawTheta) < 1e-6) continue;

    candidates.push({ edge, axisVec: axisVecRaw, rawTheta, fNext });
  }

  // Filter candidates to those whose rawTheta sign matches `direction`.
  // If none match, no valid tip exists in this direction — return null.
  const matching = candidates.filter((c) => Math.sign(c.rawTheta) === direction);
  if (matching.length === 0) {
    // Fallback 180° flip: applies only when the requested direction has
    // no valid tip AND no adjacent face existed at all (solid slab with
    // no neighboring face to tip onto). Only reachable from the first
    // "no fNext" branch below.
    //
    // If candidates existed but none matched direction, the requested
    // direction just isn't feasible — return null. The opposite button
    // may still work.
    if (candidates.length === 0 && aligned.length > 0) {
      return {
        axisVec: axis === 'x' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1),
        theta: direction * Math.PI,
        pivot: bboxCenter.clone(),
        pivotEdge: null,
        nextFaceId: null,
      };
    }
    return null;
  }

  // Among matching candidates, pick the "biggest" tip first — the edge
  // with the largest |rawTheta|. This prefers edges parallel to the
  // requested world axis (canonical 90° tips) over diagonal edges
  // (partial tips) when a bench face has both kinds — critical for
  // non-rectangular bench faces (e.g. parallelogram post-tip, where
  // the rectangular cut face lands and exposes both its long edges
  // parallel to the axis AND its short edges at 45°).
  //
  // Ties on |rawTheta| are broken by leading-edge position, so for
  // rectangular bench faces (all edges equal 90°) the result matches
  // the simple "max/min midpoint coord" heuristic:
  //   x,+1: max midpoint.z (tips toward +Z)
  //   x,-1: min midpoint.z (tips toward -Z)
  //   z,+1: min midpoint.x (tips toward -X)
  //   z,-1: max midpoint.x (tips toward +X)
  const leadSign: 1 | -1 =
    axis === 'x'
      ? ((direction === 1 ? 1 : -1) as 1 | -1)
      : ((direction === 1 ? -1 : 1) as 1 | -1);
  const scoreFn: (m: Vector3) => number =
    axis === 'x' ? (m) => m.z : (m) => m.x;
  const THETA_TIE_TOL = 1e-3; // radians — ~0.06°
  let best: Candidate | null = null;
  let bestTheta = -Infinity;
  let bestLead = -Infinity;
  for (const c of matching) {
    const mag = Math.abs(c.rawTheta);
    const mid = c.edge.a.clone().add(c.edge.b).multiplyScalar(0.5);
    const leadValue = leadSign * scoreFn(mid);
    if (
      mag > bestTheta + THETA_TIE_TOL ||
      (Math.abs(mag - bestTheta) <= THETA_TIE_TOL && leadValue > bestLead)
    ) {
      best = c;
      bestTheta = mag;
      bestLead = leadValue;
    }
  }
  if (!best) return null;

  const theta = direction * Math.abs(best.rawTheta);
  const pivot = best.edge.a.clone().add(best.edge.b).multiplyScalar(0.5);
  return {
    axisVec: best.axisVec,
    theta,
    pivot,
    pivotEdge: best.edge,
    nextFaceId: best.fNext.id,
  };
}
