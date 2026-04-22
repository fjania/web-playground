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

/** Minimum clearance between any two pieces' AABBs, in mm. */
const PLACEMENT_MARGIN = 30;
/** Half-extent of the random placement volume, per axis, in mm. */
const SCENE_HALF = { x: 320, y: 160, z: 220 };
/** Rejection-sampling budget per piece before giving up. */
const MAX_PLACE_ATTEMPTS = 1200;

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

const PIECES: PieceDef[] = [
  { name: 'rect', pair: ['maple', 'walnut'], build: buildRectangle },
  { name: 'parallelogram', pair: ['cherry', 'walnut'], build: buildParallelogram },
  { name: 'wedge', pair: ['padauk', 'maple'], build: buildWedge },
  { name: 'doorstop', pair: ['purpleheart', 'cherry'], build: buildDoorstop },
];

// ---------------------------------------------------------------------------
// Random orientation + placement
// ---------------------------------------------------------------------------

function randomRotationMatrix(): Matrix4 {
  // Shoemake's uniform random quaternion on SO(3).
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();
  const q = new Quaternion(
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
  );
  return new Matrix4().makeRotationFromQuaternion(q);
}

function placeStrip(
  strip: Strip,
  existing: Box3[],
): { placed: Strip; box: Box3 } | null {
  const rotated = strip.transform(randomRotationMatrix());
  const localBox = rotated.boundingBox();
  const offset = new Vector3();
  for (let i = 0; i < MAX_PLACE_ATTEMPTS; i++) {
    offset.set(
      (Math.random() - 0.5) * 2 * SCENE_HALF.x,
      (Math.random() - 0.5) * 2 * SCENE_HALF.y,
      (Math.random() - 0.5) * 2 * SCENE_HALF.z,
    );
    const candidate = localBox
      .clone()
      .translate(offset)
      .expandByScalar(PLACEMENT_MARGIN);
    if (!existing.some((e) => candidate.intersectsBox(e))) {
      const placed = rotated.translate(offset.x, offset.y, offset.z);
      rotated.dispose();
      return { placed, box: placed.boundingBox() };
    }
  }
  rotated.dispose();
  return null;
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

/** Build a single scatter attempt. Returns null if any piece fails to place. */
function tryScatterStrips(): Strip[] | null {
  const existing: Box3[] = [];
  const placed: Strip[] = [];
  for (const piece of PIECES) {
    const built = piece.build(piece.name, piece.pair);
    const result = placeStrip(built, existing);
    built.dispose();
    if (!result) {
      placed.forEach((s) => s.dispose());
      return null;
    }
    existing.push(result.box);
    placed.push(result.placed);
  }
  return placed;
}

const MAX_SCENE_ATTEMPTS = 6;
function scatterStrips(): Strip[] {
  for (let i = 0; i < MAX_SCENE_ATTEMPTS; i++) {
    const strips = tryScatterStrips();
    if (strips) return strips;
  }
  console.warn('[3d-experiment] scene placement never fit all pieces');
  return [];
}

/** Build a Three.js root Group from the given strips, no placement. */
function buildRoot(strips: Iterable<Strip>): Group {
  const root = new Group();
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

const SELECTION_COLORS = [0xffc400, 0x26c6da];
const CLICK_MAX_DRAG_PX = 5;

function updateSelections(
  selections: Selection[],
  stripId: string,
  faceId: number,
): void {
  const existingIdx = selections.findIndex((s) => s.stripId === stripId);
  if (existingIdx >= 0) {
    const sel = selections[existingIdx];
    if (sel.faceId === faceId) {
      selections.splice(existingIdx, 1);
    } else {
      sel.faceId = faceId;
    }
    return;
  }
  if (selections.length >= 2) selections.shift();
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

    updateSelections(selections, stripId, faceId);
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
}

function planJoin(
  selA: Selection,
  selB: Selection,
  stripsById: Map<string, Strip>,
  groups: JoinGroups,
): JoinPlan | null {
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
  let keepStrip: Strip;
  let keepFaceId: number;
  if (sizeA === 1 && sizeB > 1) {
    movingGid = gidA;
    moveStrip = stripA;
    moveFaceId = selA.faceId;
    keepStrip = stripB;
    keepFaceId = selB.faceId;
  } else if (sizeB === 1 && sizeA > 1) {
    movingGid = gidB;
    moveStrip = stripB;
    moveFaceId = selB.faceId;
    keepStrip = stripA;
    keepFaceId = selA.faceId;
  } else {
    movingGid = gidB;
    moveStrip = stripB;
    moveFaceId = selB.faceId;
    keepStrip = stripA;
    keepFaceId = selA.faceId;
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
  };
}

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
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };
  if (!tileEl) throw new Error('missing scene tile');

  try {
    setStatus('loading Manifold WASM…');
    await initManifold();

    let handle: ViewportHandle | null = null;
    let teardownSelection: (() => void) | null = null;
    let currentRoot: Group | null = null;
    let currentHighlights: Group | null = null;
    let currentSelections: Selection[] = [];
    const stripsById = new Map<string, Strip>();
    let joinGroups: JoinGroups = new Map();

    const updateJoinButton = (selections: Selection[]): void => {
      if (!joinBtn) return;
      const canJoin =
        selections.length === 2 &&
        selections[0].stripId !== selections[1].stripId;
      joinBtn.disabled = !canJoin;
    };

    const renderStatus = (selections: Selection[]): void => {
      currentSelections = selections;
      updateJoinButton(selections);
      const placed = stripsById.size;
      const groupCount = joinGroups.size;
      const groupNote =
        groupCount < placed
          ? ` · ${placed - groupCount + 1} strips joined`
          : '';
      const selDesc =
        selections.length === 0
          ? 'click any face to select'
          : `selected ${selections.length}/2 · ${selections
              .map((s) => `${s.stripId}#${s.faceId}`)
              .join(' + ')}`;
      setStatus(
        `${placed}/${PIECES.length} pieces${groupNote} · drag to orbit · scroll to zoom · ${selDesc} · reshuffle for a new layout`,
      );
    };

    /**
     * Build the viewport for the current `stripsById`. `mode === 'fresh'`
     * discards existing strips and scatters new ones; `'update'` keeps
     * the existing strips as-is and just rebuilds the viewport (used
     * after a join so the camera orientation persists).
     */
    const render = (mode: 'fresh' | 'update'): void => {
      const previousCamera = handle?.getCameraState() ?? null;
      teardownSelection?.();
      teardownSelection = null;
      handle?.dispose();
      handle = null;
      currentRoot = null;
      currentHighlights = null;

      if (mode === 'fresh') {
        for (const s of stripsById.values()) s.dispose();
        stripsById.clear();
        const scattered = scatterStrips();
        for (const s of scattered) stripsById.set(s.id, s);
        joinGroups = makeInitialGroups(stripsById.keys());
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

      teardownSelection = wireSelection(
        handle,
        root,
        highlightsGroup,
        renderStatus,
      );
      renderStatus([]);

      (window as any).__experiment = {
        camera: handle.camera,
        canvas: handle.canvas,
        root,
        highlightsGroup,
        stripsById,
        joinGroups,
        THREE: { Vector3, Raycaster, Vector2 },
      };
    };

    const performJoin = (): void => {
      if (currentSelections.length !== 2) return;
      const [selA, selB] = currentSelections;
      if (selA.stripId === selB.stripId) return;
      const plan = planJoin(selA, selB, stripsById, joinGroups);
      if (!plan) {
        console.warn('[join] could not plan join', selA, selB);
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
        groupIdOf(joinGroups, selA.stripId) ??
        groupIdOf(joinGroups, selB.stripId);
      const absorbGid = plan.movingGroupId;
      if (keepGid && keepGid !== absorbGid) {
        mergeGroups(joinGroups, keepGid, absorbGid);
      }
      // Rebuild scene preserving camera; selection state is reset.
      render('update');
    };

    render('fresh');
    reshuffleBtn?.addEventListener('click', () => render('fresh'));
    joinBtn?.addEventListener('click', performJoin);
  } catch (err) {
    console.error('[3d-experiment] boot failed', err);
    setStatus(
      `boot failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

boot();
