import { Vector3, type BufferGeometry, type Intersection, type Mesh } from 'three';
import { matSpecies } from './materials';

function signedTriVol(a: Vector3, b: Vector3, c: Vector3): number {
  return a.dot(new Vector3().crossVectors(b, c)) / 6;
}

export function meshVolume(geo: BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!idx) return 0;
  let vol = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += signedTriVol(a, b, c);
  }
  return Math.abs(vol);
}

export function meshSurfaceArea(geo: BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!idx) return 0;
  let area = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    area += ab.cross(ac).length() / 2;
  }
  return area;
}

export function meshMaterialCount(mesh: Mesh): number {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const geo = mesh.geometry;
  const usedIndices = new Set<number | undefined>();
  if (geo.groups && geo.groups.length > 0) {
    geo.groups.forEach((g) => usedIndices.add(g.materialIndex));
    return usedIndices.size;
  }
  return mats.length;
}

/** Resolve a raycast hit back to its species name via the material map. */
export function hitSpecies(hit: Intersection): string {
  const mesh = hit.object as Mesh;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const geo = mesh.geometry;
  if (geo.groups && geo.groups.length > 0 && hit.faceIndex != null) {
    const faceStart = hit.faceIndex * 3;
    for (const g of geo.groups) {
      if (faceStart >= g.start && faceStart < g.start + g.count) {
        const mat = mats[g.materialIndex ?? 0];
        return matSpecies.get(mat) || '?';
      }
    }
  }
  return matSpecies.get(mats[0]) || '?';
}

export function fmtVol(mm3: number): string {
  if (mm3 > 1e6) return (mm3 / 1e6).toFixed(1) + ' cm³';
  return mm3.toFixed(0) + ' mm³';
}

export function fmtArea(mm2: number): string {
  if (mm2 > 1e4) return (mm2 / 1e4).toFixed(1) + ' cm²';
  return mm2.toFixed(0) + ' mm²';
}

export function fmtAxis(v: Vector3): string {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax > 0.99) return (v.x > 0 ? '+' : '-') + 'X';
  if (ay > 0.99) return (v.y > 0 ? '+' : '-') + 'Y';
  if (az > 0.99) return (v.z > 0 ? '+' : '-') + 'Z';
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}
