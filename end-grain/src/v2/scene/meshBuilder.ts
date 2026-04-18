/**
 * End-grain v2 mesh builder — converts a live Panel into a Three.js
 * Group of meshes, one Mesh per segment. Reuses v1's SPECIES_DEFS
 * materials (6-material box arrays with per-species end-grain and
 * side-grain canvas textures), so v2 tiles look visually consistent
 * with the v1 app.
 *
 * Lifecycle: the caller owns the returned Group and must call
 * `disposePanelGroup(group)` when it's no longer in the scene, to
 * free per-mesh BufferGeometries. Materials are shared (cloned per
 * mesh) and the shared instances are cleaned up with v1's lifetime.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Material,
} from 'three';
import { SPECIES_DEFS } from '../../scene/materials';
import type { Panel, Segment } from '../domain/Panel';

/**
 * Build a Three.js Group containing one Mesh per panel segment.
 * Each Mesh uses a 6-material array indexed by box face; manifold
 * mesh triangles are tagged with face groups via faceID.
 *
 * Stripping the faceID routing from v1's mesh.ts for simplicity:
 * here every triangle uses material index 0 (side-grain). End-grain
 * faces will look like side-grain until we wire up per-face groups
 * — which requires inspecting manifold's triangle-to-face mapping.
 * Follow-up if the look matters; for the first 3D viewport a single
 * material per segment is recognisable.
 */
export function buildPanelGroup(panel: Panel): Group {
  const group = new Group();
  panel.segments.forEach((seg, i) => {
    const mesh = segmentToMesh(seg);
    mesh.userData.segIdx = i;
    mesh.userData.species = seg.species;
    mesh.userData.contributingStripIds = [...seg.contributingStripIds];
    group.add(mesh);
  });
  return group;
}

function segmentToMesh(seg: Segment): Mesh {
  const mfMesh = seg.manifold.getMesh();
  const numVerts = mfMesh.numVert;
  const numProp = mfMesh.numProp;

  const positions = new Float32Array(numVerts * 3);
  for (let i = 0; i < numVerts; i++) {
    positions[i * 3] = mfMesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mfMesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mfMesh.vertProperties[i * numProp + 2];
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(new Uint32Array(mfMesh.triVerts), 1));
  geo.computeVertexNormals();

  const mats = SPECIES_DEFS[seg.species];
  const baseMat = (mats?.[0] ?? mats?.[2]) as Material | undefined;
  if (!baseMat) throw new Error(`no material for species ${seg.species}`);
  // Clone so hover / highlight mutations don't leak across meshes.
  const m = (baseMat as any).clone();
  m.flatShading = true;

  const mesh = new Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Dispose per-mesh geometry in a group. Shared materials stay alive —
 * they're cloned per mesh and referenced by others. Three.js handles
 * the renderer's internal resource release once references drop.
 */
export function disposePanelGroup(group: Group): void {
  group.traverse((obj) => {
    const g = (obj as Mesh).geometry;
    if (g && typeof g.dispose === 'function') g.dispose();
  });
  while (group.children.length) group.remove(group.children[0]);
}
