import {
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Intersection,
} from 'three';
import type { FaceSelection } from '../domain/types';

/**
 * Find the full face (all coplanar triangles) that contains the clicked
 * triangle. `stripGroup` is the Group containing all segment meshes of the
 * strip. Returns null if nothing coplanar is found (degenerate).
 */
export function findFaceAtHit(hit: Intersection, stripGroup: Group): FaceSelection | null {
  const mesh = hit.object as Mesh;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index!;
  const faceIdx = hit.faceIndex!;

  const a = new Vector3().fromBufferAttribute(pos, idx.getX(faceIdx * 3));
  const b = new Vector3().fromBufferAttribute(pos, idx.getX(faceIdx * 3 + 1));
  const c = new Vector3().fromBufferAttribute(pos, idx.getX(faceIdx * 3 + 2));

  const normal = new Vector3()
    .subVectors(b, a)
    .cross(new Vector3().subVectors(c, a))
    .normalize();
  const planeD = normal.dot(a);

  const normalTol = 0.001;
  const distTol = 0.5;
  const verts: Vector3[] = [];

  stripGroup.traverse((m: any) => {
    if (!m.isMesh) return;
    const g = m.geometry as typeof geo;
    const p = g.attributes.position;
    const i = g.index!;
    const va = new Vector3();
    const vb = new Vector3();
    const vc = new Vector3();
    const ab = new Vector3();
    const ac = new Vector3();
    const n = new Vector3();
    for (let t = 0; t < i.count; t += 3) {
      va.fromBufferAttribute(p, i.getX(t));
      vb.fromBufferAttribute(p, i.getX(t + 1));
      vc.fromBufferAttribute(p, i.getX(t + 2));
      ab.subVectors(vb, va);
      ac.subVectors(vc, va);
      n.crossVectors(ab, ac).normalize();
      if (Math.abs(1 - n.dot(normal)) > normalTol) continue;
      const dT = n.dot(va);
      if (Math.abs(dT - planeD) > distTol) continue;
      verts.push(va.clone(), vb.clone(), vc.clone());
    }
  });

  if (verts.length === 0) return null;

  const centroid = new Vector3();
  verts.forEach((v) => centroid.add(v));
  centroid.divideScalar(verts.length);

  const ref = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(ref, normal).normalize();
  const v = new Vector3().crossVectors(normal, u).normalize();

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const tmp = new Vector3();
  verts.forEach((vert) => {
    tmp.subVectors(vert, centroid);
    const uu = tmp.dot(u);
    const vv = tmp.dot(v);
    if (uu < minU) minU = uu;
    if (uu > maxU) maxU = uu;
    if (vv < minV) minV = vv;
    if (vv > maxV) maxV = vv;
  });

  return {
    normal,
    centroid,
    u,
    v,
    minU,
    maxU,
    minV,
    maxV,
    width: maxU - minU,
    height: maxV - minV,
    planeD,
    rotate: false,
  };
}

/** Build a flat polygon mesh highlighting a selected face. */
export function buildFaceHighlight(face: FaceSelection, color: number): Mesh {
  const geo = new PlaneGeometry(face.width, face.height);
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.45,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);

  const center = face.centroid
    .clone()
    .addScaledVector(face.u, (face.minU + face.maxU) / 2)
    .addScaledVector(face.v, (face.minV + face.maxV) / 2)
    .addScaledVector(face.normal, 2);
  const matrix = new Matrix4().makeBasis(face.u, face.v, face.normal);
  matrix.setPosition(center);
  mesh.matrix.copy(matrix);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Are two selections on the same face (same plane, same normal)? */
export function sameFace(selA: FaceSelection | null, faceB: FaceSelection | null): boolean {
  if (!selA || !faceB) return false;
  if (Math.abs(1 - selA.normal.dot(faceB.normal)) > 0.001) return false;
  if (Math.abs(selA.planeD - faceB.planeD) > 0.5) return false;
  return true;
}

/** Highlight colors: green = selected, orange = selected-with-rotation. */
export const HL_COLOR_SEL = 0x22cc44;
export const HL_COLOR_ROT = 0xff9922;
