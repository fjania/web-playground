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

/** Clear a group of its children, disposing descendant geometry. */
function clearGroup(group: { children: any[]; remove: (c: any) => void }): void {
  while (group.children.length) {
    const c = group.children[0];
    group.remove(c);
    (c as any).traverse?.((o: any) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

/**
 * Render a Panel into a THREE.Group. Idempotent — clears and rebuilds meshes.
 *
 * Each segment is wrapped in its own sub-Group tagged with
 * `userData.segIdx` + `userData.species`, so callers can reposition or
 * highlight individual strips without rebuilding manifold geometry. The
 * manifold handle already encodes the segment's absolute world position;
 * the sub-Group starts at local (0,0,0) and any offset applied to it
 * stacks on top.
 */
import { Group } from 'three';

export function renderPanel(panel: Panel, group: any): void {
  clearGroup(group);
  panel.segments.forEach((seg, i) => {
    const mat = speciesMaterials[seg.species];
    const sub = new Group();
    sub.userData.segIdx = i;
    sub.userData.species = seg.species;
    sub.add(manifoldToThree(seg.manifold, mat));
    group.add(sub);
  });
}

/** Render a Panel with offcut (dimmed, semi-transparent) materials. */
export function renderPanelDim(panel: Panel, group: any): void {
  clearGroup(group);
  panel.segments.forEach((seg, i) => {
    const mat = offcutMats[seg.species] ?? offcutMats.maple;
    const sub = new Group();
    sub.userData.segIdx = i;
    sub.userData.species = seg.species;
    sub.add(manifoldToThree(seg.manifold, mat));
    group.add(sub);
  });
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
