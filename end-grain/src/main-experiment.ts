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
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Material,
} from 'three';

import { initManifold } from './domain/manifold';
import {
  Strip,
  computePartTriangleFaceIds,
  type Part,
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

/**
 * Bench-edge axis gizmo — visible when the rotation panel is showing, so
 * the user can tell which world axis each `Rotate X/Y/Z` button targets.
 *
 * Origin is the bench's -X/-Z corner at `(-HALF_X, 0, -HALF_Z)`. From
 * that corner:
 *   X axis runs +X along the bench's z=-HALF_Z edge (red).
 *   Z axis runs +Z along the bench's x=-HALF_X edge (blue).
 *   Y axis rises vertically out of the corner (green), 1/8 as tall as
 *     the bench span so it doesn't overwhelm the scene.
 *
 * Implementation notes:
 *   - Shafts are thin BoxGeometry bars, not LineSegments. Line widths
 *     render at 1px on most GPUs regardless of `LineBasicMaterial.linewidth`,
 *     which would look indistinguishable from the strip edges; slim boxes
 *     give us controllable thickness.
 *   - Arrowheads are ConeGeometry at the far end, oriented outward.
 *   - Labels are CanvasTexture-on-Sprite so they billboard (always face
 *     the camera) and stay legible as the user orbits. Label color
 *     matches the axis.
 *   - `depthTest: false` + high `renderOrder` keeps the gizmo visible
 *     when strips are sitting on top of the corner.
 *   - No `userData.stripId`, so the raycast loops in `wireStripSelection`
 *     and `wireDragAndSnap` ignore it naturally — matching how the bench
 *     panel is excluded.
 */
function buildAxisGizmo(): Group {
  const group = new Group();
  group.userData.role = 'axis-gizmo';
  group.visible = false; // only shown when a strip is selected

  const HALF_X = 800;
  const HALF_Z = 800;
  const ORIGIN_X = -HALF_X;
  const ORIGIN_Z = -HALF_Z;

  const X_LEN = HALF_X * 2; // 1600 mm along +X
  const Z_LEN = HALF_Z * 2; // 1600 mm along +Z
  const Y_LEN = 200; // short vertical stub

  const SHAFT = 8; // shaft cross-section in mm
  const CONE_R = 20;
  const CONE_H = 40;

  const COLOR_X = 0xe74c3c;
  const COLOR_Y = 0x2ecc71;
  const COLOR_Z = 0x3498db;

  const makeMat = (color: number): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
    });

  // ---------------- X axis (along +X at z = -HALF_Z) ----------------
  const xShaft = new Mesh(new BoxGeometry(X_LEN, SHAFT, SHAFT), makeMat(COLOR_X));
  xShaft.position.set(ORIGIN_X + X_LEN / 2, 0, ORIGIN_Z);
  xShaft.renderOrder = 30;
  group.add(xShaft);

  const xCone = new Mesh(new ConeGeometry(CONE_R, CONE_H, 24), makeMat(COLOR_X));
  // Cone default points +Y; rotate -Z by 90° so it points +X.
  xCone.rotation.z = -Math.PI / 2;
  xCone.position.set(ORIGIN_X + X_LEN + CONE_H / 2, 0, ORIGIN_Z);
  xCone.renderOrder = 30;
  group.add(xCone);

  // ---------------- Z axis (along +Z at x = -HALF_X) ----------------
  const zShaft = new Mesh(new BoxGeometry(SHAFT, SHAFT, Z_LEN), makeMat(COLOR_Z));
  zShaft.position.set(ORIGIN_X, 0, ORIGIN_Z + Z_LEN / 2);
  zShaft.renderOrder = 30;
  group.add(zShaft);

  const zCone = new Mesh(new ConeGeometry(CONE_R, CONE_H, 24), makeMat(COLOR_Z));
  // Cone default points +Y; rotate +X by 90° so it points +Z.
  zCone.rotation.x = Math.PI / 2;
  zCone.position.set(ORIGIN_X, 0, ORIGIN_Z + Z_LEN + CONE_H / 2);
  zCone.renderOrder = 30;
  group.add(zCone);

  // ---------------- Y axis (vertical at corner) ---------------------
  const yShaft = new Mesh(new BoxGeometry(SHAFT, Y_LEN, SHAFT), makeMat(COLOR_Y));
  yShaft.position.set(ORIGIN_X, Y_LEN / 2, ORIGIN_Z);
  yShaft.renderOrder = 30;
  group.add(yShaft);

  const yCone = new Mesh(new ConeGeometry(CONE_R, CONE_H, 24), makeMat(COLOR_Y));
  // Cone default already points +Y.
  yCone.position.set(ORIGIN_X, Y_LEN + CONE_H / 2, ORIGIN_Z);
  yCone.renderOrder = 30;
  group.add(yCone);

  // ---------------- Labels ------------------------------------------
  const LABEL_SIZE = 128;
  const buildLabel = (text: string, hex: string): Sprite => {
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_SIZE;
    canvas.height = LABEL_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, LABEL_SIZE, LABEL_SIZE);
    ctx.fillStyle = hex;
    ctx.font = 'bold 96px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, LABEL_SIZE / 2, LABEL_SIZE / 2);
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new Sprite(mat);
    // World-unit size — sprites are in mm because the scene is.
    sprite.scale.set(100, 100, 1);
    sprite.renderOrder = 40;
    return sprite;
  };

  const xLabel = buildLabel('X', '#e74c3c');
  xLabel.position.set(ORIGIN_X + X_LEN + CONE_H + 60, 0, ORIGIN_Z);
  group.add(xLabel);

  const yLabel = buildLabel('Y', '#2ecc71');
  yLabel.position.set(ORIGIN_X, Y_LEN + CONE_H + 60, ORIGIN_Z);
  group.add(yLabel);

  const zLabel = buildLabel('Z', '#3498db');
  zLabel.position.set(ORIGIN_X, 0, ORIGIN_Z + Z_LEN + CONE_H + 60);
  group.add(zLabel);

  return group;
}

/** Build a Three.js root Group from the given strips, no placement. */
function buildRoot(strips: Iterable<Strip>): Group {
  const root = new Group();
  root.add(buildBenchMesh());
  root.add(buildAxisGizmo());
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
// Selection — pieces, not faces
// ---------------------------------------------------------------------------
//
// The current pass disables the face-driven join / detach / algo flows
// and replaces select-mode with piece-level selection: a click on a
// strip toggles a persistent selection on that piece, rendered as an
// edge-line halo. Multi-select via shift. Plain click on empty space
// clears; shift-click on empty is a no-op.
//
// `Selection` and `Selection[]` remain in the file as a reference for
// the face-selection flows we plan to revive — they're referenced by
// `JoinAlgo.plan(...)` signatures below. While parked, `currentSelections`
// is always `[]`.

/**
 * Selection identifies a strip face by `(stripId, faceId)`. The id is
 * first-class state on the strip (set at construction or by a cut),
 * so click lookup is a plain integer match — no geometric tolerance
 * at the selection layer.
 *
 * Parked: the face-selection flow is disabled for this pass; kept as a
 * reference for future re-introduction.
 */
interface Selection {
  stripId: string;
  faceId: number;
}

const CLICK_MAX_DRAG_PX = 5;
/** Edge-line halo color for piece-level selection. Same yellow as the
 *  old face-highlight #0 for visual continuity. */
const HALO_COLOR = 0xffc400;

/**
 * Rebuild the selection halo group from the current `selectedStripIds`.
 *
 * For each selected strip, generate an `EdgesGeometry` per part mesh,
 * grouped under that strip's Three.js Group so the halo inherits any
 * in-group transform. The halo is a `LineSegments` drawn thicker and
 * brighter than the baked-in part edges, with `depthTest: false` so it
 * reads through occlusion.
 */
function rebuildHalos(haloGroup: Group, root: Group, selectedIds: Set<string>): void {
  // Clear existing halo children.
  while (haloGroup.children.length > 0) {
    const child = haloGroup.children[0];
    haloGroup.remove(child);
    if (child instanceof LineSegments) {
      child.geometry.dispose();
      (child.material as LineBasicMaterial).dispose();
    }
  }
  if (selectedIds.size === 0) return;

  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (obj.userData.role === 'face-highlight') return;
    if (obj.userData.role === 'face-highlight-preview') return;
    const stripId = obj.userData.stripId as string | undefined;
    if (!stripId) return;
    if (!selectedIds.has(stripId)) return;

    const edgesGeo = new EdgesGeometry(obj.geometry, 1);
    const mat = new LineBasicMaterial({
      color: HALO_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const halo = new LineSegments(edgesGeo, mat);
    halo.userData.role = 'strip-halo';
    halo.userData.stripId = stripId;
    halo.renderOrder = 20;
    haloGroup.add(halo);
  });
}

/**
 * Piece-level pointer selection.
 *
 * Plain click → `selected = {clickedId}`.
 * Shift+click on strip → toggle that id in/out of `selected`.
 * Plain click on empty (raycast misses all strip meshes; bench ignored) → clear.
 * Shift+click on empty → no-op.
 *
 * Camera-modifier handling: shift doubles as "extend selection" in
 * select-mode and as "orbit camera" via the global modifier-key
 * tracker. Both get a pointerdown, but TrackballControls only acts on
 * drags — a shift+click (no drag, ≤ CLICK_MAX_DRAG_PX movement) falls
 * through to the selection handler. shift+drag orbits as before.
 */
function wireStripSelection(
  handle: ViewportHandle,
  root: Group,
  haloGroup: Group,
  selectedIds: Set<string>,
  onChange: (ids: Set<string>) => void,
): () => void {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  let downX = 0;
  let downY = 0;
  // Alt / Meta is strictly a camera-orbit gesture; suppress the click
  // even if it stayed under the drag threshold so orbit taps don't
  // accidentally clear selection.
  let downWithOrbitModifier = false;

  const onPointerDown = (e: PointerEvent): void => {
    downX = e.clientX;
    downY = e.clientY;
    downWithOrbitModifier = e.altKey || e.metaKey;
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (downWithOrbitModifier || e.altKey || e.metaKey) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MAX_DRAG_PX) {
      return;
    }
    const shift = e.shiftKey;
    const rect = handle.canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, handle.camera);

    // Raycast only against strip meshes — skip the bench, skip halos,
    // skip highlight previews. `userData.stripId` is the discriminator
    // and `userData.role` filters out non-part overlays.
    const targets: Mesh[] = [];
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      if (!obj.userData.stripId) return;
      const role = obj.userData.role;
      if (role === 'face-highlight' || role === 'face-highlight-preview') return;
      targets.push(obj);
    });

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      // Empty-space click. Shift-click on empty is a no-op; plain
      // click clears selection.
      if (shift) return;
      if (selectedIds.size === 0) return;
      selectedIds.clear();
      rebuildHalos(haloGroup, root, selectedIds);
      onChange(selectedIds);
      return;
    }
    const stripId = hits[0].object.userData.stripId as string | undefined;
    if (!stripId) return;

    if (shift) {
      if (selectedIds.has(stripId)) selectedIds.delete(stripId);
      else selectedIds.add(stripId);
    } else {
      selectedIds.clear();
      selectedIds.add(stripId);
    }
    rebuildHalos(haloGroup, root, selectedIds);
    onChange(selectedIds);
  };

  handle.canvas.addEventListener('pointerdown', onPointerDown);
  handle.canvas.addEventListener('pointerup', onPointerUp);

  return () => {
    handle.canvas.removeEventListener('pointerdown', onPointerDown);
    handle.canvas.removeEventListener('pointerup', onPointerUp);
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
  const rotateXBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="rotate-x"]',
  );
  const rotateYBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="rotate-y"]',
  );
  const rotateZBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="rotate-z"]',
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
    /**
     * Bench-edge axis gizmo — cached after each `buildRoot` so
     * `updateRotatePanel` can flip `group.visible` in sync with the
     * rotation panel without rebuilding the gizmo on every selection
     * change.
     */
    let currentAxisGizmo: Group | null = null;
    // Parked reference for future face-selection revival. Stays empty
    // while the face-driven flow is disabled.
    const currentSelections: Selection[] = [];
    /**
     * Piece-level selection set — the actual select-mode state. Persists
     * across `render('update')`; filtered after every render to drop
     * ids that no longer exist in `stripsById`.
     */
    const selectedStripIds: Set<string> = new Set();
    // Callbacks invoked after each successful render(), used by
    // persistent subsystems (modifier-key tracker) to resync state
    // against the freshly-created handle.
    const renderCallbacks: Array<() => void> = [];
    const stripsById = new Map<string, Strip>();
    let joinGroups: JoinGroups = new Map();

    /** Interaction mode — 'select' highlights pieces for rotation; 'drag'
     * grabs pieces and snaps on release. Toggled by the header button. */
    let currentMode: 'select' | 'drag' = 'select';

    const modeToggleBtn = document.querySelector<HTMLButtonElement>(
      '[data-slot="mode-toggle"]',
    );
    const rotatePanelEl = document.querySelector<HTMLElement>(
      '[data-slot="rotate-panel"]',
    );

    // Face-driven flow (join / detach / algorithm dropdown) is parked for
    // this pass. DOM elements stay in place so future revival is a one-
    // line toggle; handlers are no-ops and the buttons are always
    // disabled.
    if (joinBtn) joinBtn.disabled = true;
    if (detachBtn) detachBtn.disabled = true;
    if (algoSelectEl) algoSelectEl.disabled = true;

    const updateRotatePanel = (): void => {
      // Panel is visible iff we're in select mode with ≥1 strip selected.
      // Individual axis buttons stay enabled whenever the panel is shown;
      // there's no degenerate state once a piece is selected.
      // The bench-edge axis gizmo (world X / Y / Z indicator) tracks
      // the same predicate — it's only useful when the rotation panel
      // is actionable, and it would otherwise clutter the scene.
      const visible = currentMode === 'select' && selectedStripIds.size > 0;
      if (rotatePanelEl) rotatePanelEl.hidden = !visible;
      if (currentAxisGizmo) currentAxisGizmo.visible = visible;
    };

    const renderStatus = (): void => {
      updateRotatePanel();
      const placed = stripsById.size;
      const groupCount = joinGroups.size;
      const groupNote =
        groupCount < placed
          ? ` · ${placed - groupCount + 1} strips joined`
          : '';
      const pieceNote = `${placed} piece${placed === 1 ? '' : 's'}`;
      let guidance: string;
      if (placed === 0) {
        guidance = 'add a strip from the upper-left to begin';
      } else if (currentMode === 'drag') {
        guidance = 'drag & snap active · drag a piece to slide it on the bench';
      } else if (selectedStripIds.size === 0) {
        guidance =
          'click a strip to select · shift+click to multi-select';
      } else {
        const ids = [...selectedStripIds].join(', ');
        guidance = `${selectedStripIds.size} selected: [${ids}] · click empty to deselect · rotate via the panel`;
      }
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
       * Find the best (dragged-face, stationary-face) snap candidate given
       * an offset `(dx, dz)` applied to the dragged strips' face centroids.
       *
       * Used by both pointer-move (to drive the snap preview — Strip domain
       * is still at drop-start, so the offset reflects the in-progress drag)
       * and pointer-up post-commit (with dx = dz = 0 since the domain has
       * been translated to the current drop position). Both paths apply
       * identical ordering (smallest XZ distance wins) so the preview
       * matches what the snap will actually produce.
       */
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
      const findSnapCandidate = (
        draggedSet: Set<string>,
        dx: number,
        dz: number,
      ): SnapCand | null => {
        let best: SnapCand | null = null;
        for (const srcId of draggedSet) {
          const srcStrip = stripsById.get(srcId);
          if (!srcStrip) continue;
          for (const srcFace of srcStrip.faces) {
            const scRaw = srcStrip.faceCenter(srcFace.id);
            if (!scRaw) continue;
            // Offset the dragged face centroid by the in-progress drag
            // delta. Rotation is identity during a drag, so translating
            // the centroid is equivalent to translating the whole strip.
            const scx = scRaw.x + dx;
            const scz = scRaw.z + dz;
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
                const d = Math.hypot(tc.x - scx, tc.z - scz);
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
                  snapDx: tc.x - scx,
                  snapDz: tc.z - scz,
                };
              }
            }
          }
        }
        return best;
      };

      /**
       * Rebuild the snap preview into the highlights group.
       *
       * Two face highlights with a distinct color scheme (lighter green for
       * the dragged source, darker green for the stationary target) so the
       * preview reads differently from click selection.
       *
       * The dragged strip's Mesh vertices live at the pre-drag (domain)
       * position; its Three.js parent Group carries the visual translation.
       * We slice the highlight geometry from the Mesh's position buffer
       * (same pattern as `rebuildHighlights`) but parent the resulting
       * highlight Mesh to the dragged strip's parent Group so it inherits
       * the in-progress translation. Target side has no translation so it
       * goes into the shared `highlightsGroup` directly.
       */
      const PREVIEW_SRC_COLOR = 0x6ae080; // lighter / yellowish green
      const PREVIEW_TGT_COLOR = 0x2aa050; // darker green
      const clearSnapPreview = (): void => {
        // Previews parent themselves to the dragged strip's Group (so the
        // in-progress translation inherits correctly), NOT just to
        // `highlightsGroup`, so scan the whole root.
        const victims: Mesh[] = [];
        root.traverse((obj) => {
          if (obj instanceof Mesh && obj.userData.role === 'face-highlight-preview') {
            victims.push(obj);
          }
        });
        for (const m of victims) {
          m.parent?.remove(m);
          m.geometry.dispose();
          (m.material as MeshBasicMaterial).dispose();
        }
      };

      const buildPreviewHighlight = (
        sourceMesh: Mesh,
        faceId: number,
        color: number,
      ): Mesh | null => {
        const faceIds = sourceMesh.userData.faceIds as Uint32Array | undefined;
        if (!faceIds) return null;
        const origIndex = sourceMesh.geometry.getIndex();
        if (!origIndex) return null;
        const indices: number[] = [];
        for (let t = 0; t < faceIds.length; t++) {
          if (faceIds[t] !== faceId) continue;
          indices.push(
            origIndex.getX(t * 3),
            origIndex.getX(t * 3 + 1),
            origIndex.getX(t * 3 + 2),
          );
        }
        if (indices.length === 0) return null;
        const posAttr = sourceMesh.geometry.getAttribute('position') as BufferAttribute;
        const hgeom = new BufferGeometry();
        hgeom.setAttribute('position', posAttr.clone());
        hgeom.setIndex(indices);
        const mat = new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.6,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const mesh = new Mesh(hgeom, mat);
        mesh.userData.role = 'face-highlight-preview';
        mesh.renderOrder = 11;
        return mesh;
      };

      const rebuildSnapPreview = (cand: SnapCand | null): void => {
        clearSnapPreview();
        if (!cand || !currentHighlights) return;
        // Source (dragged) side: find the Mesh under the dragged strip's
        // parent Group, build the highlight from its geometry, then parent
        // the highlight to that same parent Group so the in-progress
        // translation carries through.
        root.traverse((obj) => {
          if (!(obj instanceof Mesh)) return;
          if (obj.userData.role === 'face-highlight') return;
          if (obj.userData.role === 'face-highlight-preview') return;
          if (!obj.userData.faceIds) return;
          if (obj.userData.stripId === cand.srcId) {
            const h = buildPreviewHighlight(obj, cand.srcFaceId, PREVIEW_SRC_COLOR);
            if (h && obj.parent) obj.parent.add(h);
          } else if (obj.userData.stripId === cand.tgtId) {
            const h = buildPreviewHighlight(obj, cand.tgtFaceId, PREVIEW_TGT_COLOR);
            if (h) currentHighlights!.add(h);
          }
        });
      };

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
        // Modifier-held pointerdown is a camera-orbit gesture (handled
        // by TrackballControls / OrbitControls). Leave the event alone.
        if (e.shiftKey || e.altKey || e.metaKey) return;

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
        // Drive snap preview from the delta-offset centroid query (Strip
        // domain is still at drop-start position during a drag).
        const cand = findSnapCandidate(new Set(drag.memberIds), dx, dz);
        rebuildSnapPreview(cand);
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

        // Snap detection — domain is now at the drop position, so query
        // with zero offset. Same helper the preview uses: identical
        // ordering guarantees the snap matches the last-previewed pair.
        const best = findSnapCandidate(new Set(memberIds), 0, 0);

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
        drag = null;
      };
    };

    /**
     * Build the viewport for the current `stripsById`.
     *   'empty' : discard existing strips and leave the scene empty.
     *   'fresh' : discard and scatter the starting-four pieces.
     *   'update': keep the existing strips and rebuild the viewport,
     *             preserving the user's camera pose exactly (position,
     *             target, up — zoom and centre included, not just
     *             direction). This is what makes a drag-drop not feel
     *             like a camera reset.
     *   'refit' : keep the existing strips but re-fit the camera to the
     *             current bounds (used when the first strip lands in an
     *             empty scene).
     */
    const render = (mode: 'fresh' | 'update' | 'empty' | 'refit'): void => {
      // Full pose (position + target + up) beats orientation-only
      // CameraState for 'update' — the scene's bbox centroid may shift
      // when a piece moves, and we want the user's exact view to
      // carry across the viewport rebuild without re-centering or
      // re-fitting.
      const previousPose = handle?.getCameraPose() ?? null;
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
      // `highlightsGroup` hosts both the drag-mode snap preview (green
      // face highlights) AND the select-mode piece halo overlay. The
      // two systems share a parent so teardown is a single node to
      // traverse, but use distinct `userData.role` tags so each can
      // clean up independently.
      const highlightsGroup = new Group();
      highlightsGroup.userData.role = 'face-highlights';
      root.add(highlightsGroup);
      currentRoot = root;
      currentHighlights = highlightsGroup;
      // Locate the bench-edge axis gizmo so `updateRotatePanel` can
      // toggle `group.visible` in sync with the rotation panel. The
      // gizmo is built inside `buildRoot` tagged with
      // `userData.role = 'axis-gizmo'`.
      currentAxisGizmo = null;
      for (const child of root.children) {
        if (child instanceof Group && child.userData.role === 'axis-gizmo') {
          currentAxisGizmo = child;
          break;
        }
      }

      // Purge selection ids for strips that no longer exist. Today the
      // set of ops preserves strip identity (rotate / join / drag all
      // keep the same ids), so this is defensive rather than load-
      // bearing — but a future detach-or-delete op would break
      // selection invariants without it.
      for (const id of [...selectedStripIds]) {
        if (!stripsById.has(id)) selectedStripIds.delete(id);
      }

      const viewportOptions =
        mode === 'update' && previousPose
          ? { initialCameraPose: previousPose }
          : { initialCameraState: ISO_VIEW };
      handle = setupViewport(tileEl, root, viewportOptions);
      // Both orbit controllers start disabled; the harness owns plain
      // pointer gestures for piece-drag / piece-select. Modifier-key
      // state toggles one controller on while its modifier is held.
      handle.setTrackballEnabled(false);
      handle.setOrbitEnabled(false);

      if (currentMode === 'select') {
        // Re-apply the halo overlay for any surviving selection.
        rebuildHalos(highlightsGroup, root, selectedStripIds);
        teardownSelection = wireStripSelection(
          handle,
          root,
          highlightsGroup,
          selectedStripIds,
          () => renderStatus(),
        );
      } else {
        // Drag mode is untouched — its snap-preview highlights coexist
        // with any surviving (but visually inert) piece selection.
        teardownSelection = wireDragAndSnap(handle, root);
      }
      renderStatus();

      (window as any).__experiment = {
        handle,
        camera: handle.camera,
        canvas: handle.canvas,
        root,
        highlightsGroup,
        stripsById,
        joinGroups,
        selectedStripIds,
        algos: JOIN_ALGOS,
        // Debug surface — drive selection from devtools without
        // synthesizing pointer events. Re-bound on every render.
        setSelectedStripIds: (ids: Iterable<string>) => {
          selectedStripIds.clear();
          for (const id of ids) selectedStripIds.add(id);
          if (currentHighlights && currentRoot) {
            rebuildHalos(currentHighlights, currentRoot, selectedStripIds);
          }
          renderStatus();
        },
        THREE: { Vector3, Raycaster, Vector2, Matrix4, Quaternion },
      };

      for (const cb of renderCallbacks) cb();
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

    /**
     * "Tip onto next face" rotation for world X or Z; fixed 90° for Y.
     *
     * Real-world framing (user's ask): the rotation should take the
     * current bench face off the bench and tip the piece onto the NEXT
     * face — so it always lands flat on the bench, never balanced on
     * an edge. For a rect (square cross-section) the next face is 90°
     * away; for a wedge / doorstop / bevel the angle depends on the
     * geometry.
     *
     * X / Z algorithm (per group, computed from the group's first
     * strip's face list):
     *   1. Enumerate face normals. Skip any whose component along the
     *      rotation axis is non-zero (|n·axis| >= 0.01) — those can't
     *      be rotated to -Y by rotation around that axis.
     *   2. For each remaining face, project the normal and (0,-1,0)
     *      onto the plane perpendicular to the axis and compute the
     *      signed angle θ via `atan2((n̂×d̂)·a, n̂·d̂)` taking n̂ →
     *      d̂=(0,-1,0) via rotation around axis.
     *   3. The current bench face has θ≈0 — skip it (|θ| > 0.01 rad).
     *   4. Pick the smallest *positive* θ — CCW around the axis,
     *      matching the old fixed-90° direction.
     *
     * Y algorithm: keep 90°. Every face normal has a Y component of
     * the same sign before and after Y-rotation (Y-rotation doesn't
     * change n_y), so no face can be rotated onto -Y by spinning
     * around Y. Instead Y just spins the piece in place — 90° is the
     * intuitive "turn 90° on the bench" quarter turn.
     *
     * Multi-select + shared-group dedupe is unchanged: we iterate
     * distinct group ids so one group rotates once even if multiple
     * selected strips belong to it. Pivot is per-group: the union
     * bbox centroid of all members. Per-group θ is derived from the
     * FIRST member strip's faces — for axis-aligned groups (all our
     * strips) that's sufficient. After rotation each group is
     * translated by `(0, BENCH_Y - newBBox.min.y, 0)` so it lands
     * bench-flush; group membership and strip identity are preserved
     * by `Strip.transform()`.
     */
    const performRotate = (axis: 'x' | 'y' | 'z'): void => {
      if (currentMode !== 'select') return;
      if (selectedStripIds.size === 0) return;

      // Dedupe selected strips to their group ids so multi-select
      // within one group doesn't double-rotate that group.
      const groupIds = new Set<string>();
      for (const stripId of selectedStripIds) {
        const gid = groupIdOf(joinGroups, stripId);
        if (gid) groupIds.add(gid);
      }
      if (groupIds.size === 0) return;

      // World axis vector for rotation.
      const axisVec =
        axis === 'x'
          ? new Vector3(1, 0, 0)
          : axis === 'y'
            ? new Vector3(0, 1, 0)
            : new Vector3(0, 0, 1);
      const down = new Vector3(0, -1, 0);

      const AXIS_PERP_TOL = 0.01; // |n·axis| below this → face is perpendicular to the axis.
      const CURRENT_BENCH_TOL = 0.01; // |θ| below this → this face is already on the bench.

      /**
       * Compute the tip angle θ for rotation around `axis` that takes
       * the "next" face onto -Y. Returns `null` if no suitable face
       * exists (shouldn't happen for our shapes — defensive).
       *
       * Algorithm per the spec:
       *   - Skip stale faces — `Strip.cut` preserves every existing
       *     face in its face list even if the cut clips it to zero
       *     area (e.g. the wedge's +Y box face is a shadow of the pre-
       *     cut bar). `faceCenter()` returns null for those, which is
       *     exactly the "no polygon in this plane" filter we want.
       *   - Skip faces whose normal has |n·axis| >= AXIS_PERP_TOL
       *     (those can't reach -Y by rotation around `axis`).
       *   - For each remaining face, compute signed angle taking its
       *     projected normal onto projected `-Y` around `axis`:
       *     θ = atan2((n̂ × d̂) · axis, n̂ · d̂) after projecting both
       *     onto the plane perpendicular to axis.
       *   - Skip the current bench face (|θ| < CURRENT_BENCH_TOL).
       *   - Of the rest, pick the smallest strictly-positive θ (CCW
       *     around axis — matches the old fixed-90° sign convention).
       */
      const tipAngleForStrip = (strip: Strip): number | null => {
        let bestTheta: number | null = null;
        for (const face of strip.faces) {
          // Skip stale faces (clipped to zero area by a subsequent cut).
          if (strip.faceCenter(face.id) === null) continue;

          const n = new Vector3(
            face.plane.normal[0],
            face.plane.normal[1],
            face.plane.normal[2],
          );
          if (Math.abs(n.dot(axisVec)) >= AXIS_PERP_TOL) continue;

          // Project n and down onto the plane perpendicular to axis.
          const nProj = n.clone().sub(axisVec.clone().multiplyScalar(n.dot(axisVec)));
          const dProj = down
            .clone()
            .sub(axisVec.clone().multiplyScalar(down.dot(axisVec)));
          if (nProj.lengthSq() < 1e-12 || dProj.lengthSq() < 1e-12) continue;
          nProj.normalize();
          dProj.normalize();

          // Signed angle from nProj → dProj around axisVec.
          const cross = new Vector3().crossVectors(nProj, dProj);
          const theta = Math.atan2(cross.dot(axisVec), nProj.dot(dProj));

          if (Math.abs(theta) < CURRENT_BENCH_TOL) continue; // current bench face
          if (theta <= 0) continue; // want the smallest positive (CCW) tip

          if (bestTheta === null || theta < bestTheta) bestTheta = theta;
        }
        return bestTheta;
      };

      const rotatedGroupSummaries: string[] = [];

      for (const gid of groupIds) {
        const group = joinGroups.get(gid);
        if (!group || group.size === 0) continue;
        const memberIds = [...group];

        // Per-group pivot: union bbox centroid.
        const bbox = new Box3();
        for (const id of memberIds) {
          const strip = stripsById.get(id);
          if (!strip) continue;
          bbox.union(strip.boundingBox());
        }
        if (bbox.isEmpty()) continue;
        const pivot = bbox.getCenter(new Vector3());

        // Compute rotation angle θ.
        //   Y axis: always 90° (spin in place — no face tips onto -Y).
        //   X/Z axis: tip onto the next face of the first member strip.
        //            That's enough for axis-aligned groups (all ours).
        let theta: number;
        if (axis === 'y') {
          theta = Math.PI / 2;
        } else {
          const firstStrip = stripsById.get(memberIds[0]);
          if (!firstStrip) continue;
          const computed = tipAngleForStrip(firstStrip);
          if (computed === null) {
            appendLog(
              `rotate[${axis}] group [${memberIds.join(', ')}]: no candidate face — skipped`,
            );
            continue;
          }
          theta = computed;
        }

        // Build T(p) · R(axis, θ) · T(-p).
        const T1 = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
        const R = new Matrix4();
        if (axis === 'x') R.makeRotationX(theta);
        else if (axis === 'y') R.makeRotationY(theta);
        else R.makeRotationZ(theta);
        const T2 = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
        const rotMat = new Matrix4().multiplyMatrices(T2, R).multiply(T1);

        // Apply rotation to every strip in the group.
        for (const id of memberIds) {
          const strip = stripsById.get(id);
          if (!strip) continue;
          const rotated = strip.transform(rotMat);
          strip.dispose();
          stripsById.set(id, rotated);
        }

        // Recompute post-rotation bbox and drop the group to bench-flush.
        const newBbox = new Box3();
        for (const id of memberIds) {
          const strip = stripsById.get(id);
          if (!strip) continue;
          newBbox.union(strip.boundingBox());
        }
        const dy = BENCH_Y - newBbox.min.y;
        if (Math.abs(dy) > 1e-9) {
          for (const id of memberIds) {
            const strip = stripsById.get(id);
            if (!strip) continue;
            const moved = strip.translate(0, dy, 0);
            strip.dispose();
            stripsById.set(id, moved);
          }
        }

        const thetaDeg = (theta * 180) / Math.PI;
        rotatedGroupSummaries.push(
          `[${memberIds.join(', ')}] θ=${thetaDeg.toFixed(1)}° pivot=(${pivot.x.toFixed(1)}, ${pivot.y.toFixed(1)}, ${pivot.z.toFixed(1)}) Δy=${dy.toFixed(2)}mm`,
        );
      }

      appendLog(
        `rotate[${axis}] × ${groupIds.size} group${groupIds.size === 1 ? '' : 's'}: ${rotatedGroupSummaries.join(' | ')}`,
      );
      // Selection survives the rotation — strip ids are preserved by
      // Strip.transform(). `render('update')` re-applies the halos.
      render('update');
    };

    // Modifier-gated camera controls. Shift → TrackballControls
    // (full 3-DoF orbit with roll). Alt/Option → OrbitControls
    // (Y-up locked, simpler). Plain drag is owned by the harness
    // (piece-drag or face-select) — no camera motion.
    //
    // Toggle ON on keydown so the controller is primed and ready to
    // handle the NEXT pointerdown; toggle OFF on keyup so subsequent
    // plain-drags don't orbit. A release mid-orbit stops the gesture
    // — acceptable tradeoff for a simple, predictable state machine.
    //
    // Mouse-wheel zoom is always on (via viewport.ts's standalone
    // wheel handler), regardless of modifier. No modifier needed
    // just to zoom in / out.
    let shiftHeld = false;
    let altHeld = false;
    const syncControls = (): void => {
      if (!handle) return;
      // Alt wins over Shift when both are held. Only one controller
      // is ever enabled at a time; the "loser" stays disabled so its
      // own pointerdown doesn't capture the gesture.
      if (altHeld) {
        handle.setTrackballEnabled(false);
        handle.setOrbitEnabled(true);
      } else if (shiftHeld) {
        handle.setTrackballEnabled(true);
        handle.setOrbitEnabled(false);
      } else {
        handle.setTrackballEnabled(false);
        handle.setOrbitEnabled(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Shift' && !shiftHeld) {
        shiftHeld = true;
        syncControls();
      } else if ((e.key === 'Alt' || e.key === 'Meta') && !altHeld) {
        altHeld = true;
        syncControls();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Shift' && shiftHeld) {
        shiftHeld = false;
        syncControls();
      } else if ((e.key === 'Alt' || e.key === 'Meta') && altHeld) {
        altHeld = false;
        syncControls();
      }
    };
    // Modifier state may need resyncing when window loses focus — a
    // modifier keyup that happened while the tab was backgrounded is
    // lost otherwise, leaving the controller stuck "enabled".
    const onWindowBlur = (): void => {
      shiftHeld = false;
      altHeld = false;
      syncControls();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    // After every render the handle is fresh and its controllers are
    // both disabled. Resync so a modifier held across the re-render
    // is immediately reflected in the new controllers.
    renderCallbacks.push(syncControls);

    render('empty');
    reshuffleBtn?.addEventListener('click', () => {
      // Reshuffle replaces the whole lineup — any selection that referred
      // to the old ids is stale, so clear the set up front.
      selectedStripIds.clear();
      render('fresh');
    });
    // Face-selection-driven actions are parked for this pass while we
    // test piece-level selection. Keeping the DOM elements so revival is
    // a single wiring change; calling `performJoin` / `performDetach`
    // is a no-op because `currentSelections` is never populated.
    // `void` the references so the linter doesn't flag them as unused.
    void performJoin;
    void performDetach;
    rotateXBtn?.addEventListener('click', () => performRotate('x'));
    rotateYBtn?.addEventListener('click', () => performRotate('y'));
    rotateZBtn?.addEventListener('click', () => performRotate('z'));
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
