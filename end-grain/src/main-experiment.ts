/**
 * Side-quest harness — four strips (rectangle, parallelogram, wedge,
 * doorstop) scattered into a single 3D scene at random orientation
 * and position. Each strip starts as a 500 × 50 × 50 mm bar of ten
 * alternating-species 50 mm blocks, then gets shaped via `Strip.cut`
 * — the same plane-clip primitive the app's table-saw rip bottoms
 * out on.
 *
 * This harness is the place we're defining the Strip model, so its
 * code is the model. `Strip.ts` owns face identity as first-class
 * state; selection and mating read `strip.faces` rather than
 * inferring faces from rendered triangles.
 */

import {
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  type Material,
} from 'three';

import { initManifold } from './domain/manifold';
import {
  Strip,
  computePartTriangleFaceIds,
  UNASSIGNED_FACE_ID,
  type Part,
  type Plane,
} from './domain/Strip';
import { SPECIES_DEFS } from './scene/materials';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import type { Species } from './state/types';

const BLOCK_COUNT = 10;
const BLOCK_SIZE = { width: 50, height: 50, depth: 50 };

/** Workbench plane — strips rest with their bench face at y=0. */
const BENCH_Y = 0;
/**
 * Lineup placement for new / reshuffled strips. Strips keep their
 * default orientation (long axis along +X), center at x=0, y=25 so the
 * -Y face sits on the bench, and successive slots stepping along +Z.
 */
const LINEUP_Z_START = -350;
const LINEUP_Z_STEP = 140;
const LINEUP_STRIP_Y = 25;

// ---------------------------------------------------------------------------
// Piece builders — starting from a rectangular solid, cutting down
// ---------------------------------------------------------------------------

interface PieceDef {
  name: string;
  pair: [Species, Species];
  build: (pieceId: string, pair: [Species, Species]) => Strip;
}

function buildRectangle(pieceId: string, pair: [Species, Species]): Strip {
  return Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
}

/**
 * Two 45° rips in the XZ plane chop opposite short-end corners so the
 * top-down outline becomes a parallelogram. Each rip keeps `below`
 * (the parallelogram bulk) and discards `above` (a triangular offcut).
 */
function buildParallelogram(
  pieceId: string,
  pair: [Species, Species],
): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT2 = 1 / Math.SQRT2;
  const offset = 225 * INV_SQRT2;
  const leftCut = base.cut({ normal: [-INV_SQRT2, 0, INV_SQRT2], offset });
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut({
    normal: [INV_SQRT2, 0, -INV_SQRT2],
    offset,
  });
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Two YZ-plane rips collapse the 50×50 cross-section into a triangle
 * — apex at (y=+25, z=0), base along y=-25 from z=-25 to z=+25.
 */
function buildWedge(pieceId: string, pair: [Species, Species]): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT5 = 1 / Math.sqrt(5);
  const offset = 5 * Math.sqrt(5);
  const leftCut = base.cut({
    normal: [0, INV_SQRT5, -2 * INV_SQRT5],
    offset,
  });
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut({
    normal: [0, INV_SQRT5, 2 * INV_SQRT5],
    offset,
  });
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Two XZ-plane rips taper both long edges inward to a point at
 * x=+250, producing a tall isosceles triangle when viewed top-down.
 */
function buildDoorstop(pieceId: string, pair: [Species, Species]): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT401 = 1 / Math.sqrt(401);
  const offset = 250 * INV_SQRT401;
  const topCut = base.cut({
    normal: [INV_SQRT401, 0, 20 * INV_SQRT401],
    offset,
  });
  base.dispose();
  topCut.above.dispose();
  const bottomCut = topCut.below.cut({
    normal: [INV_SQRT401, 0, -20 * INV_SQRT401],
    offset,
  });
  topCut.below.dispose();
  bottomCut.above.dispose();
  return bottomCut.below;
}

/**
 * A single 45° rip along the full length chops off the +Y / +Z corner
 * of the 50×50 cross-section. Result is a pentagonal prism: the
 * square cross-section with one corner clipped on the y + z = 25 diag.
 */
function buildBevel(pieceId: string, pair: [Species, Species]): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT2 = 1 / Math.SQRT2;
  const cut = base.cut({
    normal: [0, INV_SQRT2, INV_SQRT2],
    offset: 25 * INV_SQRT2,
  });
  base.dispose();
  cut.above.dispose();
  return cut.below;
}

/**
 * Same rectangular bar as `buildRectangle` but with a 100 mm cross-
 * section depth (Z) instead of 50 mm — a wider "board" of the same
 * length.
 */
function buildWide(pieceId: string, pair: [Species, Species]): Strip {
  return Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, {
    width: BLOCK_SIZE.width,
    height: BLOCK_SIZE.height,
    depth: 100,
  });
}

/**
 * The four original pieces. `reshuffle` lays this set out in the first
 * four lineup slots — the new bevel/wide types are add-only.
 */
const STARTING_PIECES: PieceDef[] = [
  { name: 'rect', pair: ['maple', 'walnut'], build: buildRectangle },
  { name: 'parallelogram', pair: ['cherry', 'walnut'], build: buildParallelogram },
  { name: 'wedge', pair: ['padauk', 'maple'], build: buildWedge },
  { name: 'doorstop', pair: ['purpleheart', 'cherry'], build: buildDoorstop },
];

/** Full piece-type catalogue — every type the add-buttons can spawn. */
const PIECES: PieceDef[] = [
  ...STARTING_PIECES,
  { name: 'bevel', pair: ['walnut', 'maple'], build: buildBevel },
  { name: 'wide', pair: ['purpleheart', 'walnut'], build: buildWide },
];

// ---------------------------------------------------------------------------
// Lineup placement — deterministic, bench-resting, default orientation
// ---------------------------------------------------------------------------

/**
 * Place a freshly-built strip in lineup slot `slotIndex`. The strip
 * keeps its `fromAlternatingBlocks` orientation (long axis along +X)
 * and is translated so:
 *   - `x = 0` (centered along the long axis),
 *   - `y = LINEUP_STRIP_Y` (the -Y face rests on the bench at y=0),
 *   - `z = LINEUP_Z_START + slotIndex · LINEUP_Z_STEP`.
 * The strip input is not mutated — caller must dispose it.
 */
function placeInLineup(strip: Strip, slotIndex: number): Strip {
  const z = LINEUP_Z_START + slotIndex * LINEUP_Z_STEP;
  return strip.translate(0, LINEUP_STRIP_Y, z);
}

// ---------------------------------------------------------------------------
// Scene construction
// ---------------------------------------------------------------------------

/**
 * Build a Three.js group for a strip — one mesh per part, each tagged
 * with `stripId`, `partId`, and a per-triangle `faceIds` Uint32Array
 * computed once from the strip's face list.
 */
function buildStripGroup(strip: Strip): Group {
  const group = new Group();
  group.userData.stripId = strip.id;
  strip.parts.forEach((part, i) => {
    const mesh = partToMesh(part);
    mesh.userData.stripId = strip.id;
    mesh.userData.partId = part.id;
    mesh.userData.partIdx = i;
    mesh.userData.species = part.species;
    mesh.userData.faceIds = computePartTriangleFaceIds(part, strip.faces);
    group.add(mesh);

    const edgesGeo = new EdgesGeometry(mesh.geometry, 1);
    const edgesMat = new LineBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
    });
    const edges = new LineSegments(edgesGeo, edgesMat);
    edges.userData.role = 'part-edges';
    edges.userData.partId = part.id;
    group.add(edges);
  });
  return group;
}

function partToMesh(part: Part): Mesh {
  const mfMesh = part.manifold.getMesh();
  const numVerts = mfMesh.numVert as number;
  const numProp = mfMesh.numProp as number;
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

  const mats = SPECIES_DEFS[part.species];
  const baseMat = (mats?.[0] ?? mats?.[2]) as Material | undefined;
  if (!baseMat) throw new Error(`no material for species ${part.species}`);
  const m = (baseMat as any).clone();
  m.flatShading = true;

  const mesh = new Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Lay out the starting pieces along the lineup, slot 0 through
 * `STARTING_PIECES.length - 1`. No randomness — reshuffle now just
 * rebuilds the same lineup (equivalent to "clear then re-add").
 */
function scatterStrips(): Strip[] {
  const placed: Strip[] = [];
  STARTING_PIECES.forEach((piece, i) => {
    const built = piece.build(piece.name, piece.pair);
    const positioned = placeInLineup(built, i);
    built.dispose();
    placed.push(positioned);
  });
  return placed;
}

/**
 * Workbench plane — a large, thin quad at y=BENCH_Y that visualizes
 * the bench-flush constraint. Rendered as a dimly-lit grey panel with
 * a thin top outline, depth-tested so strips sitting on it show the
 * expected edge-kiss.
 */
function buildBenchMesh(): Group {
  const group = new Group();
  group.userData.role = 'bench';
  const HALF_X = 800;
  const HALF_Z = 800;
  const geo = new BufferGeometry();
  const positions = new Float32Array([
    -HALF_X, BENCH_Y, -HALF_Z,
    HALF_X, BENCH_Y, -HALF_Z,
    HALF_X, BENCH_Y, HALF_Z,
    -HALF_X, BENCH_Y, HALF_Z,
  ]);
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  geo.computeVertexNormals();
  const mat = new MeshBasicMaterial({
    color: 0x2a2a28,
    transparent: true,
    opacity: 0.85,
    side: 2, // DoubleSide — bench is visible from both above and below.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = -10; // draw behind strips
  mesh.userData.role = 'bench-panel';
  group.add(mesh);

  const edgesGeo = new BufferGeometry();
  edgesGeo.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        -HALF_X, BENCH_Y, -HALF_Z, HALF_X, BENCH_Y, -HALF_Z,
        HALF_X, BENCH_Y, -HALF_Z, HALF_X, BENCH_Y, HALF_Z,
        HALF_X, BENCH_Y, HALF_Z, -HALF_X, BENCH_Y, HALF_Z,
        -HALF_X, BENCH_Y, HALF_Z, -HALF_X, BENCH_Y, -HALF_Z,
      ]),
      3,
    ),
  );
  const edgesMat = new LineBasicMaterial({
    color: 0x4a4a48,
    transparent: true,
    opacity: 0.6,
  });
  const edges = new LineSegments(edgesGeo, edgesMat);
  edges.userData.role = 'bench-edges';
  group.add(edges);

  return group;
}

/** Build a Three.js root Group from the given strips, no placement. */
function buildRoot(strips: Iterable<Strip>): Group {
  const root = new Group();
  root.add(buildBenchMesh());
  for (const strip of strips) {
    root.add(buildStripGroup(strip));
  }
  return root;
}

const ISO_VIEW = {
  direction: [-0.55, -0.5, -0.67] as [number, number, number],
  up: [0, 1, 0] as [number, number, number],
};

// ---------------------------------------------------------------------------
// Face selection
// ---------------------------------------------------------------------------

/**
 * Selection identifies a strip face by `(stripId, faceId)`. The id is
 * first-class state on the strip (set at construction or by a cut),
 * so click lookup is a plain integer match — no geometric tolerance
 * at the selection layer.
 */
interface Selection {
  stripId: string;
  faceId: number;
}

/**
 * Selection slot colors, ordered by click index.
 *   [0] yellow  — first click (anchor mate face)
 *   [1] cyan    — second click (solo mate face)
 *   [2] orange  — third click (solo bench face, bench-flush algo only)
 */
const SELECTION_COLORS = [0xffc400, 0x26c6da, 0xff9050];
const CLICK_MAX_DRAG_PX = 5;

/**
 * Toggle-based selection: clicking a face that's already selected
 * deselects it; otherwise appends up to `maxSelections` items,
 * dropping the oldest if we're at cap. Unlike the old per-strip-
 * uniqueness rule, this allows two faces on the same strip — bench-
 * flush needs the solo's mate AND bench face simultaneously selected.
 */
function updateSelections(
  selections: Selection[],
  stripId: string,
  faceId: number,
  maxSelections: number,
): void {
  const existingIdx = selections.findIndex(
    (s) => s.stripId === stripId && s.faceId === faceId,
  );
  if (existingIdx >= 0) {
    selections.splice(existingIdx, 1);
    return;
  }
  if (selections.length >= maxSelections) selections.shift();
  selections.push({ stripId, faceId });
}

function rebuildHighlights(
  highlightsGroup: Group,
  root: Group,
  selections: Selection[],
): void {
  while (highlightsGroup.children.length > 0) {
    const child = highlightsGroup.children[0];
    highlightsGroup.remove(child);
    if (child instanceof Mesh) {
      child.geometry.dispose();
      (child.material as MeshBasicMaterial).dispose();
    }
  }
  selections.forEach((sel, idx) => {
    const color = SELECTION_COLORS[idx % SELECTION_COLORS.length];
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      if (obj.userData.role === 'face-highlight') return;
      if (obj.userData.stripId !== sel.stripId) return;
      const faceIds = obj.userData.faceIds as Uint32Array | undefined;
      if (!faceIds) return;
      const origIndex = obj.geometry.getIndex();
      if (!origIndex) return;
      const indices: number[] = [];
      for (let t = 0; t < faceIds.length; t++) {
        if (faceIds[t] !== sel.faceId) continue;
        indices.push(
          origIndex.getX(t * 3),
          origIndex.getX(t * 3 + 1),
          origIndex.getX(t * 3 + 2),
        );
      }
      if (indices.length === 0) return;
      const posAttr = obj.geometry.getAttribute('position') as BufferAttribute;
      const hgeom = new BufferGeometry();
      hgeom.setAttribute('position', posAttr.clone());
      hgeom.setIndex(indices);
      const mat = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const highlight = new Mesh(hgeom, mat);
      highlight.userData.role = 'face-highlight';
      highlight.renderOrder = 10;
      highlightsGroup.add(highlight);
    });
  });
}

function wireSelection(
  handle: ViewportHandle,
  root: Group,
  highlightsGroup: Group,
  onChange: (selections: Selection[]) => void,
  getMaxSelections: () => number,
): () => void {
  const selections: Selection[] = [];
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  let downX = 0;
  let downY = 0;

  const onPointerDown = (e: PointerEvent): void => {
    downX = e.clientX;
    downY = e.clientY;
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MAX_DRAG_PX) {
      return;
    }
    const rect = handle.canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, handle.camera);

    const targets: Mesh[] = [];
    root.traverse((obj) => {
      if (
        obj instanceof Mesh &&
        obj.userData.faceIds &&
        obj.userData.role !== 'face-highlight'
      ) {
        targets.push(obj);
      }
    });

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;
    const hit = hits[0];
    const mesh = hit.object as Mesh;
    const faceIds = mesh.userData.faceIds as Uint32Array;
    const faceId = faceIds[hit.faceIndex ?? 0];
    if (faceId === UNASSIGNED_FACE_ID) return;
    const stripId = mesh.userData.stripId as string | undefined;
    if (!stripId) return;

    updateSelections(selections, stripId, faceId, getMaxSelections());
    rebuildHighlights(highlightsGroup, root, selections);
    onChange(selections);
  };

  handle.canvas.addEventListener('pointerdown', onPointerDown);
  handle.canvas.addEventListener('pointerup', onPointerUp);

  return () => {
    handle.canvas.removeEventListener('pointerdown', onPointerDown);
    handle.canvas.removeEventListener('pointerup', onPointerUp);
    selections.length = 0;
    rebuildHighlights(highlightsGroup, root, selections);
  };
}

// ---------------------------------------------------------------------------
// Join — the table-saw-style mate algorithm
// ---------------------------------------------------------------------------

/**
 * Group membership for rigidly-joined strips. Every strip starts in
 * its own group; joining two strips merges their groups. The group
 * value is the set of stripIds that move together as one rigid body.
 */
type JoinGroups = Map<string, Set<string>>;

function makeInitialGroups(stripIds: Iterable<string>): JoinGroups {
  const groups: JoinGroups = new Map();
  for (const id of stripIds) groups.set(id, new Set([id]));
  return groups;
}

function groupIdOf(groups: JoinGroups, stripId: string): string | null {
  for (const [gid, members] of groups.entries()) {
    if (members.has(stripId)) return gid;
  }
  return null;
}

function mergeGroups(
  groups: JoinGroups,
  keepGid: string,
  absorbGid: string,
): void {
  if (keepGid === absorbGid) return;
  const keep = groups.get(keepGid);
  const absorb = groups.get(absorbGid);
  if (!keep || !absorb) return;
  for (const id of absorb) keep.add(id);
  groups.delete(absorbGid);
}

/**
 * Compute the transform that brings `move` face flush against `keep`
 * face, and return both the transform and the moving stripIds.
 *
 * Geometry:
 *   1. Rotation that sends the moving face's outward normal onto the
 *      negative of the keeping face's outward normal (so the two
 *      faces sit back-to-back on the same plane).
 *   2. Rotation is applied about the moving face's centroid, then the
 *      whole moving group translates so that centroid lands on the
 *      keeping face's centroid.
 *
 * Selection of who moves:
 *   - If one side is solo (group size 1) and the other side is a
 *     group of ≥ 2, the solo moves — the mated assembly stays put.
 *   - Otherwise (both solo or both groups), the strip selected SECOND
 *     is the moving side. Matches the typical user mental model: "I'm
 *     bringing this one onto that one."
 */
interface JoinPlan {
  matrix: Matrix4;
  movingGroupId: string;
  movingStripIds: string[];
  /** Which selection is the mover (useful for logs/verification). */
  moverSel: Selection;
  keepSel: Selection;
}

/**
 * Join-algorithm registry. New algorithms are added as new functions
 * (never replacing the old ones), then exposed here so they appear in
 * the UI dropdown and we can A/B them on the same scene.
 *
 * `requiredSelections` is the number of face-clicks the algorithm
 * consumes. 2 for flush mates (anchor face + solo face); 3 for the
 * bench-flush family (anchor mate + solo mate + solo bench).
 */
interface JoinAlgo {
  id: string;
  label: string;
  requiredSelections: number;
  plan: (
    selections: Selection[],
    stripsById: Map<string, Strip>,
    groups: JoinGroups,
  ) => JoinPlan | null;
}

function planJoinCentroidFlush(
  selections: Selection[],
  stripsById: Map<string, Strip>,
  groups: JoinGroups,
): JoinPlan | null {
  if (selections.length !== 2) return null;
  const [selA, selB] = selections;
  if (selA.stripId === selB.stripId) return null;
  const stripA = stripsById.get(selA.stripId);
  const stripB = stripsById.get(selB.stripId);
  if (!stripA || !stripB) return null;
  const gidA = groupIdOf(groups, selA.stripId);
  const gidB = groupIdOf(groups, selB.stripId);
  if (!gidA || !gidB) return null;
  if (gidA === gidB) return null;

  const sizeA = groups.get(gidA)!.size;
  const sizeB = groups.get(gidB)!.size;

  // Decide who moves. "Second-selected moves" is the default; the
  // solo-into-group case overrides it.
  let movingGid: string;
  let moveStrip: Strip;
  let moveFaceId: number;
  let moverSel: Selection;
  let keepStrip: Strip;
  let keepFaceId: number;
  let keepSel: Selection;
  if (sizeA === 1 && sizeB > 1) {
    movingGid = gidA;
    moveStrip = stripA;
    moveFaceId = selA.faceId;
    moverSel = selA;
    keepStrip = stripB;
    keepFaceId = selB.faceId;
    keepSel = selB;
  } else if (sizeB === 1 && sizeA > 1) {
    movingGid = gidB;
    moveStrip = stripB;
    moveFaceId = selB.faceId;
    moverSel = selB;
    keepStrip = stripA;
    keepFaceId = selA.faceId;
    keepSel = selA;
  } else {
    movingGid = gidB;
    moveStrip = stripB;
    moveFaceId = selB.faceId;
    moverSel = selB;
    keepStrip = stripA;
    keepFaceId = selA.faceId;
    keepSel = selA;
  }

  const moveCenter = moveStrip.faceCenter(moveFaceId);
  const keepCenter = keepStrip.faceCenter(keepFaceId);
  if (!moveCenter || !keepCenter) return null;

  const moveFace = moveStrip.faces.find((f) => f.id === moveFaceId);
  const keepFace = keepStrip.faces.find((f) => f.id === keepFaceId);
  if (!moveFace || !keepFace) return null;

  const moveNormal = new Vector3(
    moveFace.plane.normal[0],
    moveFace.plane.normal[1],
    moveFace.plane.normal[2],
  );
  const targetNormal = new Vector3(
    -keepFace.plane.normal[0],
    -keepFace.plane.normal[1],
    -keepFace.plane.normal[2],
  );

  const q = new Quaternion().setFromUnitVectors(moveNormal, targetNormal);
  const T1 = new Matrix4().makeTranslation(
    -moveCenter.x,
    -moveCenter.y,
    -moveCenter.z,
  );
  const R = new Matrix4().makeRotationFromQuaternion(q);
  const T2 = new Matrix4().makeTranslation(
    keepCenter.x,
    keepCenter.y,
    keepCenter.z,
  );
  const matrix = new Matrix4().multiplyMatrices(T2, R).multiply(T1);

  return {
    matrix,
    movingGroupId: movingGid,
    movingStripIds: [...groups.get(movingGid)!],
    moverSel,
    keepSel,
  };
}

/**
 * Principal-axis join — extends centroid-flush with in-plane alignment.
 *
 * Same anchor (face centroids) and same anti-parallel normal constraint
 * as `planJoinCentroidFlush`, but in addition picks the rotation *about*
 * the shared face normal that aligns the two faces' dominant extent
 * directions. For elongated shapes (rectangles, parallelograms) this
 * lands long-edge-to-long-edge and maximizes contact area. For near-
 * regular shapes (squares, hexagons) principal axes are degenerate but
 * overlap is rotation-invariant by symmetry, so any choice is fine.
 *
 * Construction:
 *   q1 = shortest-arc rotation taking moveNormal → -keepNormal.
 *   After q1, the moving face's principal axis lies in the keep plane's
 *   tangent subspace. Compute signed angle θ about keepNormal that
 *   takes rotated-movePrincipal onto keepPrincipal; principal axes are
 *   directionless so we pick whichever sign gives |θ| ≤ π/2.
 *   q2 = rotation by θ about keepNormal.
 *   T = T(keepCenter) · q2·q1 · T(-moveCenter).
 */
function planJoinPrincipalAxis(
  selections: Selection[],
  stripsById: Map<string, Strip>,
  groups: JoinGroups,
): JoinPlan | null {
  if (selections.length !== 2) return null;
  const [selA, selB] = selections;
  if (selA.stripId === selB.stripId) return null;
  const stripA = stripsById.get(selA.stripId);
  const stripB = stripsById.get(selB.stripId);
  if (!stripA || !stripB) return null;
  const gidA = groupIdOf(groups, selA.stripId);
  const gidB = groupIdOf(groups, selB.stripId);
  if (!gidA || !gidB) return null;
  if (gidA === gidB) return null;

  const sizeA = groups.get(gidA)!.size;
  const sizeB = groups.get(gidB)!.size;

  let movingGid: string;
  let moveStrip: Strip;
  let moveFaceId: number;
  let moverSel: Selection;
  let keepStrip: Strip;
  let keepFaceId: number;
  let keepSel: Selection;
  if (sizeA === 1 && sizeB > 1) {
    movingGid = gidA;
    moveStrip = stripA;
    moveFaceId = selA.faceId;
    moverSel = selA;
    keepStrip = stripB;
    keepFaceId = selB.faceId;
    keepSel = selB;
  } else if (sizeB === 1 && sizeA > 1) {
    movingGid = gidB;
    moveStrip = stripB;
    moveFaceId = selB.faceId;
    moverSel = selB;
    keepStrip = stripA;
    keepFaceId = selA.faceId;
    keepSel = selA;
  } else {
    movingGid = gidB;
    moveStrip = stripB;
    moveFaceId = selB.faceId;
    moverSel = selB;
    keepStrip = stripA;
    keepFaceId = selA.faceId;
    keepSel = selA;
  }

  const moveCenter = moveStrip.faceCenter(moveFaceId);
  const keepCenter = keepStrip.faceCenter(keepFaceId);
  if (!moveCenter || !keepCenter) return null;

  const moveFace = moveStrip.faces.find((f) => f.id === moveFaceId);
  const keepFace = keepStrip.faces.find((f) => f.id === keepFaceId);
  if (!moveFace || !keepFace) return null;

  const moveNormal = new Vector3(
    moveFace.plane.normal[0],
    moveFace.plane.normal[1],
    moveFace.plane.normal[2],
  ).normalize();
  const keepNormal = new Vector3(
    keepFace.plane.normal[0],
    keepFace.plane.normal[1],
    keepFace.plane.normal[2],
  ).normalize();
  const targetNormal = keepNormal.clone().negate();

  const q1 = new Quaternion().setFromUnitVectors(moveNormal, targetNormal);

  const q2 = new Quaternion();
  const movePrincipal = moveStrip.facePrincipalAxis(moveFaceId);
  const keepPrincipal = keepStrip.facePrincipalAxis(keepFaceId);
  if (movePrincipal && keepPrincipal) {
    const movePrincipalAfter = movePrincipal.clone().applyQuaternion(q1);
    let c = movePrincipalAfter.dot(keepPrincipal);
    const cross = new Vector3().crossVectors(movePrincipalAfter, keepPrincipal);
    let s = cross.dot(keepNormal);
    if (c < 0) {
      c = -c;
      s = -s;
    }
    const theta = Math.atan2(s, c);
    q2.setFromAxisAngle(keepNormal, theta);
  }

  const qTotal = q2.multiply(q1);

  const T1 = new Matrix4().makeTranslation(
    -moveCenter.x,
    -moveCenter.y,
    -moveCenter.z,
  );
  const R = new Matrix4().makeRotationFromQuaternion(qTotal);
  const T2 = new Matrix4().makeTranslation(
    keepCenter.x,
    keepCenter.y,
    keepCenter.z,
  );
  const matrix = new Matrix4().multiplyMatrices(T2, R).multiply(T1);

  return {
    matrix,
    movingGroupId: movingGid,
    movingStripIds: [...groups.get(movingGid)!],
    moverSel,
    keepSel,
  };
}

/**
 * The registry. Order matters — first entry is the default choice in
 * the dropdown on first load.
 */
/**
 * Bench-flush join — three selections, workbench as the anchor.
 *
 * Selections, in click order:
 *   [0] anchor mating face   — on a strip already in the scene.
 *   [1] solo mating face     — on the strip being brought in.
 *   [2] solo bench face      — on the SAME strip as [1], perpendicular
 *                              to [1]; this face will rest flat on the
 *                              bench at y = BENCH_Y after the join.
 *
 * Fully determined rotation: two of the three local→world axis pairs
 * are pinned (mate and bench); the third (the in-plane cross product)
 * falls out of the orthonormal basis swap.
 *
 * Translation: the solo strip is moved so
 *   (a) its mating face is coplanar with the anchor's mating face,
 *   (b) its bench face sits at y = BENCH_Y,
 *   (c) the mating centroids line up in the remaining horizontal
 *       direction (the axis perpendicular to both the mating normal
 *       and bench normal — the direction the piece slides along the
 *       bench to butt into the anchor).
 *
 * If the strips have mismatched bench-to-mate-centroid heights,
 * constraint (a) + (b) together can't both hold exactly; the log
 * reports the residual offset.
 */
function planJoinBenchFlush(
  selections: Selection[],
  stripsById: Map<string, Strip>,
  groups: JoinGroups,
): JoinPlan | null {
  if (selections.length !== 3) return null;
  const [anchorMateSel, soloMateSel, soloBenchSel] = selections;

  // Validation: anchor and solo must be different strips; solo's mate
  // and bench selections must be on the same strip and not the same face.
  if (anchorMateSel.stripId === soloMateSel.stripId) return null;
  if (soloMateSel.stripId !== soloBenchSel.stripId) return null;
  if (soloMateSel.faceId === soloBenchSel.faceId) return null;

  const anchorStrip = stripsById.get(anchorMateSel.stripId);
  const soloStrip = stripsById.get(soloMateSel.stripId);
  if (!anchorStrip || !soloStrip) return null;

  const gidA = groupIdOf(groups, anchorMateSel.stripId);
  const gidS = groupIdOf(groups, soloMateSel.stripId);
  if (!gidA || !gidS || gidA === gidS) return null;

  const anchorMateFace = anchorStrip.faces.find(
    (f) => f.id === anchorMateSel.faceId,
  );
  const soloMateFace = soloStrip.faces.find(
    (f) => f.id === soloMateSel.faceId,
  );
  const soloBenchFace = soloStrip.faces.find(
    (f) => f.id === soloBenchSel.faceId,
  );
  if (!anchorMateFace || !soloMateFace || !soloBenchFace) return null;

  const anchorMateCenter = anchorStrip.faceCenter(anchorMateSel.faceId);
  const soloMateCenter = soloStrip.faceCenter(soloMateSel.faceId);
  const soloBenchCenter = soloStrip.faceCenter(soloBenchSel.faceId);
  if (!anchorMateCenter || !soloMateCenter || !soloBenchCenter) return null;

  const anchorMateNormal = new Vector3(
    anchorMateFace.plane.normal[0],
    anchorMateFace.plane.normal[1],
    anchorMateFace.plane.normal[2],
  ).normalize();
  const soloMateNormal = new Vector3(
    soloMateFace.plane.normal[0],
    soloMateFace.plane.normal[1],
    soloMateFace.plane.normal[2],
  ).normalize();
  const soloBenchNormal = new Vector3(
    soloBenchFace.plane.normal[0],
    soloBenchFace.plane.normal[1],
    soloBenchFace.plane.normal[2],
  ).normalize();

  // Solo's mate and bench faces must be perpendicular — otherwise the
  // rotation is unsolvable (we'd need two identical-axis mappings).
  if (Math.abs(soloMateNormal.dot(soloBenchNormal)) > 1e-3) return null;

  // Target world orientations:
  //   solo mate  → anti-parallel to anchor mate   (flush mating)
  //   solo bench → (0, -1, 0)                     (resting on bench)
  const targetMate = anchorMateNormal.clone().negate();
  const targetBench = new Vector3(0, -1, 0);

  // Build source and target orthonormal frames, pick R so the frames
  // coincide: R · src = tgt  ⇒  R = tgt · srcᵀ (orthogonal inverse).
  const aSrc = soloMateNormal.clone();
  const bSrc = soloBenchNormal.clone();
  const cSrc = new Vector3().crossVectors(aSrc, bSrc).normalize();

  const aTgt = targetMate.clone();
  const bTgt = targetBench.clone();
  const cTgt = new Vector3().crossVectors(aTgt, bTgt).normalize();

  const srcMat = new Matrix4().makeBasis(aSrc, bSrc, cSrc);
  const srcInv = new Matrix4().copy(srcMat).transpose();
  const tgtMat = new Matrix4().makeBasis(aTgt, bTgt, cTgt);
  const R = new Matrix4().multiplyMatrices(tgtMat, srcInv);

  // Rotated world positions of the solo's key face centroids (still
  // needs translation to land correctly).
  const rotatedMate = soloMateCenter.clone().applyMatrix4(R);
  const rotatedBench = soloBenchCenter.clone().applyMatrix4(R);

  // Translation components, broken out by direction:
  //   (a) Along anchor mate normal: slide so solo mate plane = anchor mate plane.
  //   (b) Along world Y: drop so bench centroid sits at BENCH_Y.
  //   (c) Along the remaining horizontal axis: center solo mate centroid
  //       on anchor mate centroid (the "slide along the bench" direction).
  const benchUp = new Vector3(0, 1, 0);
  const slideAxis = new Vector3()
    .crossVectors(anchorMateNormal, benchUp)
    .normalize();

  const delta = anchorMateCenter.clone().sub(rotatedMate);
  const tAlongMate = delta.dot(anchorMateNormal);
  const tAlongSlide = delta.dot(slideAxis);
  const tAlongY = BENCH_Y - rotatedBench.y;

  const T = new Vector3(0, 0, 0)
    .add(anchorMateNormal.clone().multiplyScalar(tAlongMate))
    .add(slideAxis.clone().multiplyScalar(tAlongSlide))
    .add(benchUp.clone().multiplyScalar(tAlongY));

  const matrix = new Matrix4()
    .makeTranslation(T.x, T.y, T.z)
    .multiply(R);

  return {
    matrix,
    movingGroupId: gidS,
    movingStripIds: [...groups.get(gidS)!],
    moverSel: soloMateSel,
    keepSel: anchorMateSel,
  };
}

const JOIN_ALGOS: JoinAlgo[] = [
  {
    id: 'centroid-flush',
    label: 'Centroid flush',
    requiredSelections: 2,
    plan: planJoinCentroidFlush,
  },
  {
    id: 'principal-axis',
    label: 'Principal axis',
    requiredSelections: 2,
    plan: planJoinPrincipalAxis,
  },
  {
    id: 'bench-flush',
    label: 'Bench flush (3-click)',
    requiredSelections: 3,
    plan: planJoinBenchFlush,
  },
];

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>('[data-slot="status"]');
  const tileEl = document.querySelector<HTMLElement>('[data-tile="scene"]');
  const reshuffleBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="reshuffle"]',
  );
  const joinBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="join"]',
  );
  const detachBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="detach"]',
  );
  const algoSelectEl = document.querySelector<HTMLSelectElement>(
    '[data-slot="join-algo"]',
  );
  const logEl = document.querySelector<HTMLElement>('[data-slot="log"]');
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };
  const bootTime = performance.now();
  const LOG_MAX_ENTRIES = 200;
  const appendLog = (msg: string): void => {
    if (!logEl) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const ts = document.createElement('span');
    ts.className = 'log-timestamp';
    const secs = (performance.now() - bootTime) / 1000;
    ts.textContent = `${secs.toFixed(1).padStart(5, ' ')}s`;
    const text = document.createElement('span');
    text.className = 'log-msg';
    text.textContent = msg;
    entry.title = msg; // full text on hover if truncated
    entry.appendChild(ts);
    entry.appendChild(text);
    logEl.appendChild(entry);
    while (logEl.children.length > LOG_MAX_ENTRIES) {
      logEl.removeChild(logEl.firstChild!);
    }
    logEl.scrollTop = logEl.scrollHeight;
  };
  if (!tileEl) throw new Error('missing scene tile');

  // Populate algorithm dropdown.
  if (algoSelectEl) {
    algoSelectEl.innerHTML = '';
    for (const algo of JOIN_ALGOS) {
      const opt = document.createElement('option');
      opt.value = algo.id;
      opt.textContent = algo.label;
      algoSelectEl.appendChild(opt);
    }
  }
  const currentAlgo = (): JoinAlgo => {
    const id = algoSelectEl?.value;
    return JOIN_ALGOS.find((a) => a.id === id) ?? JOIN_ALGOS[0];
  };

  try {
    setStatus('loading Manifold WASM…');
    appendLog('loading Manifold WASM…');
    await initManifold();
    appendLog('Manifold ready');

    let handle: ViewportHandle | null = null;
    let teardownSelection: (() => void) | null = null;
    let currentRoot: Group | null = null;
    let currentHighlights: Group | null = null;
    let currentSelections: Selection[] = [];
    const stripsById = new Map<string, Strip>();
    let joinGroups: JoinGroups = new Map();

    /** Interaction mode — 'select' clicks faces for join; 'drag' grabs
     * pieces and snaps on release. Toggled by the header button. */
    let currentMode: 'select' | 'drag' = 'select';

    const modeToggleBtn = document.querySelector<HTMLButtonElement>(
      '[data-slot="mode-toggle"]',
    );

    const updateJoinButton = (selections: Selection[]): void => {
      if (!joinBtn) return;
      const algo = currentAlgo();
      const N = algo.requiredSelections;
      let canJoin = selections.length === N;
      if (canJoin && N === 2) {
        canJoin = selections[0].stripId !== selections[1].stripId;
      } else if (canJoin && N === 3) {
        // Bench-flush: [0] anchor, [1] & [2] on the same solo strip
        // (different faces), and that solo strip ≠ the anchor.
        canJoin =
          selections[0].stripId !== selections[1].stripId &&
          selections[1].stripId === selections[2].stripId &&
          selections[1].faceId !== selections[2].faceId;
      }
      joinBtn.disabled = !canJoin;
    };

    const updateDetachButton = (selections: Selection[]): void => {
      if (!detachBtn) return;
      // Enabled when exactly one face is selected on a strip that is
      // currently joined to at least one other strip.
      let canDetach = false;
      if (selections.length === 1) {
        const gid = groupIdOf(joinGroups, selections[0].stripId);
        const group = gid ? joinGroups.get(gid) : null;
        canDetach = !!group && group.size > 1;
      }
      detachBtn.disabled = !canDetach;
    };

    const renderStatus = (selections: Selection[]): void => {
      currentSelections = selections;
      updateJoinButton(selections);
      updateDetachButton(selections);
      const placed = stripsById.size;
      const groupCount = joinGroups.size;
      const groupNote =
        groupCount < placed
          ? ` · ${placed - groupCount + 1} strips joined`
          : '';
      const need = currentAlgo().requiredSelections;
      const selDesc =
        selections.length === 0
          ? `click any face to select (${need} to join)`
          : `selected ${selections.length}/${need} · ${selections
              .map((s) => `${s.stripId}#${s.faceId}`)
              .join(' + ')}`;
      const pieceNote = `${placed} piece${placed === 1 ? '' : 's'}`;
      const guidance =
        placed === 0
          ? 'add a strip from the upper-left to begin'
          : `drag to orbit · scroll to zoom · ${selDesc}`;
      setStatus(
        `${pieceNote}${groupNote} · ${guidance} · reshuffle for the starting-four lineup`,
      );
    };

    /**
     * Drag-and-snap interaction handler.
     *
     * Pointer-down: raycasts against the scene and, if it hits a strip
     * mesh, begins a drag on the hit strip's entire join-group. The
     * initial grab point is the ray-bench-plane intersection at y=BENCH_Y
     * so subsequent motion reads as sliding-on-the-bench regardless of
     * where along the strip's height the user clicked. TrackballControls
     * is suspended so the camera doesn't orbit under the same pointer.
     *
     * Pointer-move: translates each dragged Three.js Group in XZ only —
     * visual-only, no domain mutation. Strip.translate() is expensive
     * (reallocates Manifold handles), so keeping the drag cheap means
     * not touching stripsById mid-drag.
     *
     * Pointer-up / cancel: commits the drop by applying the XZ delta to
     * every dragged strip (Strip.translate → dispose old → replace).
     * After commit, runs snap detection over the NOW-UPDATED face
     * centroids: for every (dragged-face, stationary-face) pair with
     * anti-parallel world normals (dot ≤ ANTI_PARALLEL_DOT) within XZ
     * SNAP_DIST, take the closest. Applies snap as a second translate,
     * merges the two join-groups, and logs. If no snap, logs the drop
     * delta. Final render('update') rebuilds from stripsById.
     *
     * Commit-then-snap ordering matters: it means both steps are proper
     * domain translations (not a hidden group-level transform), the
     * snap uses up-to-date centroids rather than pre-drop ones, and
     * either step alone is a recoverable state.
     */
    const wireDragAndSnap = (
      handle: ViewportHandle,
      root: Group,
    ): (() => void) => {
      const SNAP_DIST = 40;
      const ANTI_PARALLEL_DOT = -0.95;

      const canvas = handle.canvas;
      const raycaster = new Raycaster();
      const ndc = new Vector2();

      interface DragState {
        pointerId: number;
        groupId: string;
        /** Stripids in the dragged group (captured at drag start). */
        memberIds: string[];
        /** Per-strip Three.js Group references + their initial positions. */
        movers: Array<{ threeGroup: Group; initialPosition: Vector3 }>;
        /** Bench-plane intersection at pointer-down. */
        grabWorld: Vector3;
      }

      let drag: DragState | null = null;

      /**
       * Intersect the ray from a pointer event with the bench plane
       * (y = BENCH_Y). Returns the world point of intersection, or null
       * if the ray is parallel to (or pointing away from) the bench.
       */
      const benchPointFromPointer = (e: PointerEvent): Vector3 | null => {
        const rect = canvas.getBoundingClientRect();
        ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, handle.camera);
        const origin = raycaster.ray.origin;
        const dir = raycaster.ray.direction;
        if (Math.abs(dir.y) < 1e-9) return null;
        const t = (BENCH_Y - origin.y) / dir.y;
        if (t < 0) return null;
        return new Vector3(
          origin.x + t * dir.x,
          BENCH_Y,
          origin.z + t * dir.z,
        );
      };

      /** Find the Three.js Group under `root` whose userData.stripId matches. */
      const findStripGroup = (stripId: string): Group | null => {
        for (const child of root.children) {
          if (child instanceof Group && child.userData.stripId === stripId) {
            return child;
          }
        }
        return null;
      };

      const onPointerDown = (e: PointerEvent): void => {
        const rect = canvas.getBoundingClientRect();
        ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, handle.camera);

        const targets: Mesh[] = [];
        root.traverse((obj) => {
          if (
            obj instanceof Mesh &&
            obj.userData.stripId &&
            obj.userData.role !== 'face-highlight'
          ) {
            targets.push(obj);
          }
        });
        const hits = raycaster.intersectObjects(targets, false);
        if (hits.length === 0) return;

        const hitStripId = hits[0].object.userData.stripId as string;
        const gid = groupIdOf(joinGroups, hitStripId);
        if (!gid) return;
        const members = joinGroups.get(gid);
        if (!members) return;

        const grabWorld = benchPointFromPointer(e);
        if (!grabWorld) return;

        const movers: Array<{ threeGroup: Group; initialPosition: Vector3 }> = [];
        for (const id of members) {
          const g = findStripGroup(id);
          if (!g) continue;
          movers.push({
            threeGroup: g,
            initialPosition: g.position.clone(),
          });
        }
        if (movers.length === 0) return;

        drag = {
          pointerId: e.pointerId,
          groupId: gid,
          memberIds: [...members],
          movers,
          grabWorld,
        };
        handle.setControlsEnabled(false);
        // Pointer capture is a best-effort guarantee that all subsequent
        // move/up events route here even if the cursor leaves the canvas
        // — synthesized events in tests don't register as "real" pointers
        // and throw on capture, so we tolerate failure rather than abort.
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore — no active pointer (e.g., synthesized PointerEvent). */
        }
      };

      const onPointerMove = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const now = benchPointFromPointer(e);
        if (!now) return;
        const dx = now.x - drag.grabWorld.x;
        const dz = now.z - drag.grabWorld.z;
        for (const m of drag.movers) {
          m.threeGroup.position.set(
            m.initialPosition.x + dx,
            m.initialPosition.y,
            m.initialPosition.z + dz,
          );
        }
      };

      const finishDrag = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const now = benchPointFromPointer(e);
        const dx = now ? now.x - drag.grabWorld.x : 0;
        const dz = now ? now.z - drag.grabWorld.z : 0;
        const memberIds = drag.memberIds;
        const draggedGid = drag.groupId;

        try {
          if (canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch {
          /* ignore — pointer may never have been captured. */
        }
        handle.setControlsEnabled(true);
        drag = null;

        // Commit the drop delta to the Strip domain so faceCenter()
        // returns world-space centroids at the drop position.
        if (dx !== 0 || dz !== 0) {
          for (const id of memberIds) {
            const strip = stripsById.get(id);
            if (!strip) continue;
            const moved = strip.translate(dx, 0, dz);
            strip.dispose();
            stripsById.set(id, moved);
          }
        }

        // Snap detection — for each (dragged-face, stationary-face)
        // pair, if world normals are anti-parallel and XZ centroid
        // distance is within SNAP_DIST, keep the closest candidate.
        interface SnapCand {
          srcId: string;
          srcFaceId: number;
          tgtId: string;
          tgtFaceId: number;
          tgtGid: string;
          d: number;
          snapDx: number;
          snapDz: number;
        }
        let best: SnapCand | null = null;

        const draggedSet = new Set(memberIds);
        for (const srcId of memberIds) {
          const srcStrip = stripsById.get(srcId);
          if (!srcStrip) continue;
          for (const srcFace of srcStrip.faces) {
            const sc = srcStrip.faceCenter(srcFace.id);
            if (!sc) continue;
            const srcNormal = new Vector3(
              srcFace.plane.normal[0],
              srcFace.plane.normal[1],
              srcFace.plane.normal[2],
            );
            for (const [tgtId, tgtStrip] of stripsById.entries()) {
              if (draggedSet.has(tgtId)) continue;
              for (const tgtFace of tgtStrip.faces) {
                const tc = tgtStrip.faceCenter(tgtFace.id);
                if (!tc) continue;
                const tgtNormal = new Vector3(
                  tgtFace.plane.normal[0],
                  tgtFace.plane.normal[1],
                  tgtFace.plane.normal[2],
                );
                const dot = srcNormal.dot(tgtNormal);
                if (dot > ANTI_PARALLEL_DOT) continue;
                const d = Math.hypot(tc.x - sc.x, tc.z - sc.z);
                if (d > SNAP_DIST) continue;
                if (best && d >= best.d) continue;
                const tgtGid = groupIdOf(joinGroups, tgtId);
                if (!tgtGid) continue;
                best = {
                  srcId,
                  srcFaceId: srcFace.id,
                  tgtId,
                  tgtFaceId: tgtFace.id,
                  tgtGid,
                  d,
                  snapDx: tc.x - sc.x,
                  snapDz: tc.z - sc.z,
                };
              }
            }
          }
        }

        if (best) {
          // Apply snap translation to every strip in the dragged group.
          for (const id of memberIds) {
            const strip = stripsById.get(id);
            if (!strip) continue;
            const moved = strip.translate(best.snapDx, 0, best.snapDz);
            strip.dispose();
            stripsById.set(id, moved);
          }
          mergeGroups(joinGroups, best.tgtGid, draggedGid);
          appendLog(
            `snap: ${best.srcId}#${best.srcFaceId} → ${best.tgtId}#${best.tgtFaceId} · XZ d=${best.d.toFixed(2)}mm`,
          );
        } else {
          const n = memberIds.length;
          appendLog(
            `drop: moved ${n} strip${n === 1 ? '' : 's'} (Δx=${dx.toFixed(2)}mm, Δz=${dz.toFixed(2)}mm)`,
          );
        }

        render('update');
      };

      const onPointerUp = (e: PointerEvent): void => finishDrag(e);
      const onPointerCancel = (e: PointerEvent): void => finishDrag(e);

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerCancel);

      return () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        if (drag) {
          handle.setControlsEnabled(true);
          drag = null;
        }
      };
    };

    /**
     * Build the viewport for the current `stripsById`.
     *   'empty' : discard existing strips and leave the scene empty.
     *   'fresh' : discard and scatter the starting-four pieces.
     *   'update': keep the existing strips and rebuild the viewport,
     *             preserving camera orientation.
     *   'refit' : keep the existing strips but re-fit the camera to the
     *             current bounds (used when the first strip lands in an
     *             empty scene).
     */
    const render = (mode: 'fresh' | 'update' | 'empty' | 'refit'): void => {
      const previousCamera = handle?.getCameraState() ?? null;
      teardownSelection?.();
      teardownSelection = null;
      handle?.dispose();
      handle = null;
      currentRoot = null;
      currentHighlights = null;

      if (mode === 'fresh' || mode === 'empty') {
        for (const s of stripsById.values()) s.dispose();
        stripsById.clear();
        joinGroups = new Map();
      }
      if (mode === 'fresh') {
        const scattered = scatterStrips();
        for (const s of scattered) stripsById.set(s.id, s);
        joinGroups = makeInitialGroups(stripsById.keys());
        appendLog(
          `scatter: ${scattered.length}/${STARTING_PIECES.length} strips [${scattered
            .map((s) => s.id)
            .join(', ')}]`,
        );
      }

      const root = buildRoot(stripsById.values());
      const highlightsGroup = new Group();
      highlightsGroup.userData.role = 'face-highlights';
      root.add(highlightsGroup);
      currentRoot = root;
      currentHighlights = highlightsGroup;

      const initialCameraState =
        mode === 'update' && previousCamera ? previousCamera : ISO_VIEW;
      handle = setupViewport(tileEl, root, { initialCameraState });

      teardownSelection =
        currentMode === 'select'
          ? wireSelection(
              handle,
              root,
              highlightsGroup,
              renderStatus,
              () => currentAlgo().requiredSelections,
            )
          : wireDragAndSnap(handle, root);
      renderStatus([]);

      (window as any).__experiment = {
        camera: handle.camera,
        canvas: handle.canvas,
        root,
        highlightsGroup,
        stripsById,
        joinGroups,
        algos: JOIN_ALGOS,
        // Debug surface — drive selection state from devtools without
        // synthesizing pointer events. Re-bound on every render.
        setSelections: (sels: Selection[]) => renderStatus(sels),
        THREE: { Vector3, Raycaster, Vector2, Matrix4, Quaternion },
      };
    };

    const performJoin = (): void => {
      const algo = currentAlgo();
      if (currentSelections.length !== algo.requiredSelections) return;
      const plan = algo.plan(currentSelections, stripsById, joinGroups);
      if (!plan) {
        const selStr = currentSelections
          .map((s) => `${s.stripId}#${s.faceId}`)
          .join(' + ');
        appendLog(`join[${algo.id}] FAILED: ${selStr}`);
        console.warn('[join] could not plan join', currentSelections);
        return;
      }
      // Apply the transform to every strip in the moving group.
      for (const stripId of plan.movingStripIds) {
        const strip = stripsById.get(stripId);
        if (!strip) continue;
        const moved = strip.transform(plan.matrix);
        strip.dispose();
        stripsById.set(stripId, moved);
      }
      // Merge groups so future joins know they're rigidly linked.
      const keepGid =
        groupIdOf(joinGroups, plan.keepSel.stripId) ??
        groupIdOf(joinGroups, plan.moverSel.stripId);
      const absorbGid = plan.movingGroupId;
      if (keepGid && keepGid !== absorbGid) {
        mergeGroups(joinGroups, keepGid, absorbGid);
      }
      // Post-join diagnostics: flush Δ and, for bench-flush, the
      // residual bench-face-y offset so height mismatches are visible.
      const moverStrip = stripsById.get(plan.moverSel.stripId);
      const keepStrip = stripsById.get(plan.keepSel.stripId);
      const moverCenter = moverStrip?.faceCenter(plan.moverSel.faceId);
      const keepCenter = keepStrip?.faceCenter(plan.keepSel.faceId);
      const deltaStr =
        moverCenter && keepCenter
          ? moverCenter.distanceTo(keepCenter).toExponential(2)
          : 'n/a';
      let benchNote = '';
      if (algo.id === 'bench-flush' && currentSelections.length === 3) {
        const soloBenchSel = currentSelections[2];
        const bc = moverStrip?.faceCenter(soloBenchSel.faceId);
        if (bc) benchNote = ` · benchΔy=${(bc.y - BENCH_Y).toExponential(2)}`;
      }
      const movedCount = plan.movingStripIds.length;
      appendLog(
        `join[${algo.id}] ${plan.moverSel.stripId}#${plan.moverSel.faceId} → ${plan.keepSel.stripId}#${plan.keepSel.faceId} · moved ${movedCount} strip${movedCount === 1 ? '' : 's'} · flush Δ=${deltaStr}${benchNote}`,
      );
      // Rebuild scene preserving camera; selection state is reset.
      render('update');
    };

    const addStripOfType = (pieceName: string): void => {
      const piece = PIECES.find((p) => p.name === pieceName);
      if (!piece) {
        appendLog(`add: unknown piece type '${pieceName}'`);
        return;
      }
      // Pick the next free id — `rect`, then `rect-2`, `rect-3`, etc.
      let id = piece.name;
      let n = 1;
      while (stripsById.has(id)) {
        n += 1;
        id = `${piece.name}-${n}`;
      }
      const wasEmpty = stripsById.size === 0;
      // Slot index = current count; grows monotonically, never reused.
      const slotIndex = stripsById.size;
      const built = piece.build(id, piece.pair);
      const placed = placeInLineup(built, slotIndex);
      built.dispose();
      stripsById.set(id, placed);
      joinGroups.set(id, new Set([id]));
      appendLog(`add: +${id} at slot ${slotIndex}`);
      // First strip into an empty scene needs a camera refit — the
      // previous-camera state was framed for "no content," so the
      // freshly-placed strip would otherwise sit outside its frustum.
      render(wasEmpty ? 'refit' : 'update');
    };

    const performDetach = (): void => {
      if (currentSelections.length !== 1) return;
      const { stripId } = currentSelections[0];
      const gid = groupIdOf(joinGroups, stripId);
      if (!gid) return;
      const group = joinGroups.get(gid);
      if (!group || group.size <= 1) return;

      const oldMembers = [...group];
      group.delete(stripId);

      // If the detached strip's id WAS the group's key, the remaining
      // members need a fresh key — pick any remaining member.
      if (gid === stripId) {
        const remaining = [...group];
        joinGroups.delete(gid);
        joinGroups.set(remaining[0], new Set(remaining));
      }
      joinGroups.set(stripId, new Set([stripId]));

      appendLog(`detach: ${stripId} from [${oldMembers.join(', ')}]`);
      render('update');
    };

    render('empty');
    reshuffleBtn?.addEventListener('click', () => render('fresh'));
    joinBtn?.addEventListener('click', performJoin);
    detachBtn?.addEventListener('click', performDetach);
    // Switching algorithms changes required-selection count; clear
    // selections so the user starts fresh for the new mechanic.
    algoSelectEl?.addEventListener('change', () => render('update'));
    modeToggleBtn?.addEventListener('click', () => {
      currentMode = currentMode === 'select' ? 'drag' : 'select';
      modeToggleBtn.dataset.active = currentMode === 'drag' ? 'true' : 'false';
      render('update');
    });
    for (const btn of document.querySelectorAll<HTMLButtonElement>(
      '[data-add]',
    )) {
      const pieceName = btn.dataset.add ?? '';
      btn.addEventListener('click', () => addStripOfType(pieceName));
    }
  } catch (err) {
    console.error('[3d-experiment] boot failed', err);
    setStatus(
      `boot failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

boot();
