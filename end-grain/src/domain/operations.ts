import { Box3, Matrix4, Vector3 } from 'three';
import type { Panel } from './Panel';
import type { FaceSelection, FlipAxis, JoinCompat, JoinStage, NormalRelation } from './types';

/**
 * Blade-plane normal from table-saw controls.
 *
 * rip: rotation of the blade about Y (rip=0 → blade faces -Z).
 * bevel: tilt of the blade off vertical, rotating around world X.
 *   At bevel=90° the blade is perpendicular to the table (no tilt).
 */
export function planeNormal(rip: number, bevel: number): Vector3 {
  const rRad = (rip * Math.PI) / 180;
  const tiltRad = ((90 - bevel) * Math.PI) / 180;
  const nx = Math.sin(rRad);
  const ny0 = 0;
  const nz0 = -Math.cos(rRad);
  const cosT = Math.cos(tiltRad);
  const sinT = Math.sin(tiltRad);
  const ny = ny0 * cosT - nz0 * sinT;
  const nz = ny0 * sinT + nz0 * cosT;
  return new Vector3(nx, ny, nz);
}

/**
 * Project a panel's bounding-box corners onto a unit normal and return the
 * (signed) extent along that normal. Used to derive how many slices of a
 * given pitch fit across the panel.
 */
export function panelExtentAlongNormal(panel: Panel, normal: Vector3): number {
  const bb = panel.boundingBox();
  let lo = Infinity;
  let hi = -Infinity;
  for (let ix = 0; ix < 2; ix++)
    for (let iy = 0; iy < 2; iy++)
      for (let iz = 0; iz < 2; iz++) {
        const x = ix ? bb.max.x : bb.min.x;
        const y = iy ? bb.max.y : bb.min.y;
        const z = iz ? bb.max.z : bb.min.z;
        const d = x * normal.x + y * normal.y + z * normal.z;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
  return hi - lo;
}

export function classifyNormals(nA: Vector3, nB: Vector3): NormalRelation {
  const dot = nA.dot(nB);
  if (dot < -0.999) return 'antiparallel';
  if (dot > 0.999) return 'parallel';
  return 'angled';
}

/** Which world axes are perpendicular to a normal (within tolerance)? */
export function perpAxes(normal: Vector3): Array<'x' | 'y' | 'z'> {
  const tol = 0.05; // ~3°
  return (['x', 'y', 'z'] as const).filter((ax) => Math.abs(normal[ax]) < tol);
}

/** Check if two selected faces can be joined. */
export function checkJoinCompat(
  selA: FaceSelection | null,
  selB: FaceSelection | null,
  flipAxis: FlipAxis,
): JoinCompat {
  if (!selA || !selB) {
    return { ok: false, error: '', needsFlipAxis: false, validFlipAxes: [] };
  }

  const rel = classifyNormals(selA.normal, selB.normal);

  if (rel === 'parallel') {
    const valid = perpAxes(selA.normal);
    if (valid.length === 0) {
      return {
        ok: false,
        error:
          'parallel normals not aligned with any world axis — use the rotation flag on one face to make them antiparallel',
        needsFlipAxis: false,
        validFlipAxes: [],
      };
    }
    if (!flipAxis || !valid.includes(flipAxis)) {
      return { ok: false, error: '', needsFlipAxis: true, validFlipAxes: valid };
    }
    return { ok: true, error: '', needsFlipAxis: true, validFlipAxes: valid };
  }

  return { ok: true, error: '', needsFlipAxis: false, validFlipAxes: [] };
}

function rotationMatrixAboutPoint(axis: Vector3, angle: number, pivot: Vector3): Matrix4 {
  const m1 = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const rot = new Matrix4().makeRotationAxis(axis.clone().normalize(), angle);
  const m2 = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  return m2.multiply(rot).multiply(m1);
}

export function stageMatrixAtProgress(stage: JoinStage, progress: number): Matrix4 {
  if (stage.type === 'rotation') {
    return rotationMatrixAboutPoint(stage.axis, stage.angle * progress, stage.pivot);
  }
  const d = stage.delta.clone().multiplyScalar(progress);
  return new Matrix4().makeTranslation(d.x, d.y, d.z);
}

function expandBoxByTransformedPanel(box: Box3, panel: Panel, matrix: Matrix4): void {
  const v = new Vector3();
  for (const seg of panel.segments) {
    const bb = seg.manifold.boundingBox();
    for (let i = 0; i < 8; i++) {
      v.set(
        i & 1 ? bb.max[0] : bb.min[0],
        i & 2 ? bb.max[1] : bb.min[1],
        i & 4 ? bb.max[2] : bb.min[2],
      );
      v.applyMatrix4(matrix);
      box.expandByPoint(v);
    }
  }
}

/**
 * Build the ordered list of join stages to align face selA (on panelA) with
 * face selB (on panelB). The final centering stage is computed by simulating
 * all prior stages on each panel's bounding box so the joined panel ends up
 * at the origin.
 */
export function buildJoinStages(
  panelA: Panel,
  panelB: Panel,
  selA: FaceSelection,
  selB: FaceSelection,
  flipAxis: FlipAxis,
): JoinStage[] {
  const stages: JoinStage[] = [];

  if (selA.rotate) {
    stages.push({
      group: 'A',
      type: 'rotation',
      axis: selA.normal.clone(),
      angle: Math.PI,
      pivot: selA.centroid.clone(),
      label: 'pre-rotating A 180° about face normal',
    });
  }
  if (selB.rotate) {
    stages.push({
      group: 'B',
      type: 'rotation',
      axis: selB.normal.clone(),
      angle: Math.PI,
      pivot: selB.centroid.clone(),
      label: 'pre-rotating B 180° about face normal',
    });
  }

  const targetNormal = selA.normal.clone().negate();
  const currentNormal = selB.normal.clone();
  const dot = currentNormal.dot(targetNormal);
  if (dot < 0.9999) {
    let axis: Vector3;
    let angle: number;
    if (dot < -0.9999) {
      if (!flipAxis) throw new Error('parallel normals require a flip axis');
      axis = new Vector3(
        flipAxis === 'x' ? 1 : 0,
        flipAxis === 'y' ? 1 : 0,
        flipAxis === 'z' ? 1 : 0,
      );
      angle = Math.PI;
    } else {
      axis = new Vector3().crossVectors(currentNormal, targetNormal).normalize();
      angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    }
    stages.push({
      group: 'B',
      type: 'rotation',
      axis,
      angle,
      pivot: selB.centroid.clone(),
      label: 'rotating B to align normals',
    });
  }

  const delta = new Vector3().subVectors(selA.centroid, selB.centroid);
  if (delta.length() > 1e-6) {
    stages.push({
      group: 'B',
      type: 'translation',
      delta,
      label: 'translating B to align centroids',
    });
  }

  const matA = new Matrix4();
  const matB = new Matrix4();
  for (const s of stages) {
    const m = stageMatrixAtProgress(s, 1);
    if (s.group === 'A') matA.premultiply(m);
    else if (s.group === 'B') matB.premultiply(m);
  }
  const finalBB = new Box3();
  expandBoxByTransformedPanel(finalBB, panelA, matA);
  expandBoxByTransformedPanel(finalBB, panelB, matB);
  const center = new Vector3();
  finalBB.getCenter(center);
  if (center.length() > 1e-6) {
    stages.push({
      group: 'BOTH',
      type: 'translation',
      delta: center.clone().negate(),
      label: 'centering joined panel at origin',
    });
  }

  return stages;
}
