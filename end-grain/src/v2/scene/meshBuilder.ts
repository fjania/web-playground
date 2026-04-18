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
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
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

    // Overlay edge lines at the segment's sharp corners. This makes
    // slice boundaries visible in the output viewport — adjacent
    // same-species segments would otherwise render as continuous
    // material, hiding the cut structure. Also delineates the
    // species boundary (X=0 face between maple and walnut strips)
    // and the panel's outer edges.
    //
    // Threshold 1° catches any non-coplanar face pair. Each segment
    // draws its own edges; at a shared cut face both adjacent
    // segments contribute to the same line, which is fine visually.
    const edgesGeo = new EdgesGeometry(mesh.geometry, 1);
    const edgesMat = new LineBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
    });
    const edges = new LineSegments(edgesGeo, edgesMat);
    edges.userData.role = 'segment-edges';
    edges.userData.segIdx = i;
    group.add(edges);
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
    const withGeo = obj as Mesh | LineSegments;
    if (withGeo.geometry && typeof withGeo.geometry.dispose === 'function') {
      withGeo.geometry.dispose();
    }
    // Edge materials are per-segment (not shared like SPECIES_DEFS);
    // dispose them too.
    if (obj instanceof LineSegments) {
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose?.();
      } else if (mat && 'dispose' in mat) {
        (mat as { dispose: () => void }).dispose();
      }
    }
  });
  while (group.children.length) group.remove(group.children[0]);
}
