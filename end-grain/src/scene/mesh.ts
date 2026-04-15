import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
  type Material,
} from 'three';
import type { Panel } from '../domain/Panel';
import { offcutMats, speciesMaterials } from './materials';

/** Convert a Manifold handle into a Three.js Mesh. The material is cloned
 *  so per-mesh emissive edits (hover highlighting) don't leak. */
export function manifoldToThree(mf: any, material: Material): Mesh {
  const mesh = mf.getMesh();
  const numVerts = mesh.numVert;
  const numProp = mesh.numProp;

  const positions = new Float32Array(numVerts * 3);
  for (let i = 0; i < numVerts; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();

  const mat = (material as any).clone();
  mat.flatShading = true;
  const obj = new Mesh(geo, mat);
  obj.castShadow = true;
  return obj;
}

/** Clear a group of its children, disposing child geometry. */
function clearGroup(group: { children: any[]; remove: (c: any) => void }): void {
  while (group.children.length) {
    const c = group.children[0];
    group.remove(c);
    if (c.geometry) c.geometry.dispose();
  }
}

/**
 * Render a Panel into a THREE.Group. Idempotent — clears and rebuilds meshes.
 * The group's position/rotation are untouched; this is purely a geometry write.
 */
export function renderPanel(panel: Panel, group: any): void {
  clearGroup(group);
  for (const seg of panel.segments) {
    const mat = speciesMaterials[seg.species];
    group.add(manifoldToThree(seg.manifold, mat));
  }
}

/** Render a Panel with offcut (dimmed, semi-transparent) materials. */
export function renderPanelDim(panel: Panel, group: any): void {
  clearGroup(group);
  for (const seg of panel.segments) {
    const mat = offcutMats[seg.species] ?? offcutMats.maple;
    group.add(manifoldToThree(seg.manifold, mat));
  }
}

/**
 * Resize a plane-viz mesh to safely cover the given panel at any blade
 * angle. Uses the panel's bounding-box diagonal so the plane is big enough
 * no matter how it's oriented.
 */
export function sizePlaneViz(plane: Mesh, panel: Panel): void {
  const sz = new Vector3();
  panel.boundingBox().getSize(sz);
  const diag = sz.length() + 200;
  plane.geometry.dispose();
  plane.geometry = new PlaneGeometry(diag, diag);
}
