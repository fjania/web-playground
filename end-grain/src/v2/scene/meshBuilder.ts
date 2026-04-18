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
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Shape,
  type Material,
} from 'three';
import { SPECIES_DEFS } from '../../scene/materials';
import type { Panel, Segment } from '../domain/Panel';
import type { PanelSnapshot } from '../state/types';

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
 * Build a Three.js Group from a serialisable PanelSnapshot (plain
 * data; no live manifold handles required). Each volume's topFace
 * polygon is extruded along Y from bbox.min[1] to bbox.max[1],
 * producing a prism that matches the volume's real 3D shape —
 * including parallelograms (angled cuts) and rotated rectangles.
 *
 * Why: snapshot-rendering lets us render ANY pipeline result in 3D
 * without requiring the live Panel to be preserved. Enables the
 * Cut-focused I/X/O view (slices rendered as distinct pieces from
 * CutResult.slices snapshots) and future per-slice / per-arrange
 * inspection views that don't need the live geometry.
 *
 * Visual fidelity note: snapshot meshes use the first side-grain
 * material from SPECIES_DEFS with flat shading. They don't carry
 * v1's 6-material end-grain routing — acceptable for debug/inspection
 * views (where you care about shape and species, not grain). The
 * live-Panel builder above stays the canonical path for
 * production-quality renders.
 */
export function buildGroupFromSnapshot(snap: PanelSnapshot): Group {
  const group = new Group();
  snap.volumes.forEach((vol, i) => {
    if (vol.topFace.length < 3) return;

    // Build the shape in the XY plane of the extruder (its native
    // frame). We want world coordinates to match the snapshot: a
    // vertex at topFace (x, z) should end up at world (x, *, z) with
    // no sign flip. The subsequent rotateX(-π/2) sends shape.y to
    // world −z, so we pre-negate z here. That mirrors the polygon
    // across shape.x, which reverses winding; reversing traversal
    // order brings it back to the original winding so face normals
    // still point outward correctly.
    const src = vol.topFace.slice().reverse();
    const shape = new Shape();
    shape.moveTo(src[0].x, -src[0].z);
    for (let k = 1; k < src.length; k++) {
      shape.lineTo(src[k].x, -src[k].z);
    }
    shape.closePath();

    const depth = vol.bbox.max[1] - vol.bbox.min[1];
    const geo = new ExtrudeGeometry(shape, {
      depth: Math.max(depth, 0.001),
      bevelEnabled: false,
    });
    // ExtrudeGeometry extrudes along +Z in its local space. Rotate
    // −90° about X to bring that extrusion axis to world +Y. Combined
    // with the shape.y = −topFace.z pre-flip above, the final world Z
    // equals topFace.z (the same convention the 2D summary uses), so
    // 3D and 2D views stay orientation-consistent.
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, vol.bbox.min[1], 0);
    geo.computeVertexNormals();

    const mats = SPECIES_DEFS[vol.species];
    const baseMat = (mats?.[0] ?? mats?.[2]) as Material | undefined;
    if (!baseMat) throw new Error(`no material for species ${vol.species}`);
    const m = (baseMat as any).clone();
    m.flatShading = true;

    const mesh = new Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.volIdx = i;
    mesh.userData.species = vol.species;
    mesh.userData.contributingStripIds = [...vol.contributingStripIds];
    mesh.userData.contributingSliceIds = [...vol.contributingSliceIds];
    group.add(mesh);

    // Edge overlay — same convention as the live-Panel builder.
    const edgesGeo = new EdgesGeometry(geo, 1);
    const edgesMat = new LineBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
    });
    const edges = new LineSegments(edgesGeo, edgesMat);
    edges.userData.role = 'segment-edges';
    edges.userData.volIdx = i;
    group.add(edges);
  });
  return group;
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
