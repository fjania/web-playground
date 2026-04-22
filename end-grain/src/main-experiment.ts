/**
 * Side-quest harness — four pieces (rectangle, parallelogram, wedge,
 * doorstop) scattered into a single 3D scene at random orientation
 * and position. Each piece starts as a 500 × 50 × 50 mm bar of ten
 * 50 mm cubes alternating between its own pair of species, then gets
 * cut via the main pipeline's Manifold plane-clipping path.
 */

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

import { initManifold } from './domain/manifold';
import { Panel } from './domain/Panel';
import { buildPanelGroup } from './scene/meshBuilder';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import type { Species, StripDef } from './state/types';

const STRIP_COUNT = 10;
const STRIP_WIDTH = 50;
const BLOCK_HEIGHT = 50;
const BLOCK_DEPTH = 50;

/** Minimum clearance between any two pieces' AABBs, in mm. */
const PLACEMENT_MARGIN = 30;
/** Half-extent of the random placement volume, per axis, in mm. */
const SCENE_HALF = { x: 320, y: 160, z: 220 };
/** Rejection-sampling budget per piece before giving up. */
const MAX_PLACE_ATTEMPTS = 1200;

interface PieceDef {
  name: string;
  pair: [Species, Species];
  build: (prefix: string, pair: [Species, Species]) => Panel;
}

/**
 * Build the StripDef list for one piece. Every entry shares the same
 * `stripId` (the piece name) — a piece is ONE logical strip, and the
 * 10 alternating-color blocks are visual parts of that strip. Keeping
 * one segment per block preserves the alternating species pattern
 * through cuts/transforms; collapsing stripId is what makes "face of
 * the strip" a well-defined cross-part concept.
 */
function makeAlternatingStrips(
  pieceId: string,
  pair: [Species, Species],
): StripDef[] {
  const strips: StripDef[] = [];
  for (let i = 0; i < STRIP_COUNT; i++) {
    strips.push({
      stripId: pieceId,
      species: pair[i % 2],
      width: STRIP_WIDTH,
    });
  }
  return strips;
}

function buildRectangle(prefix: string, pair: [Species, Species]): Panel {
  return Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
}

/**
 * Parallelogram: two 45° cuts in the XZ plane remove opposite corner
 * triangles at the short ends so the top-down outline becomes a
 * parallelogram. Both cuts keep the `below` half.
 */
function buildParallelogram(prefix: string, pair: [Species, Species]): Panel {
  const base = Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
  const INV_SQRT2 = 1 / Math.SQRT2;
  const offset = 225 * INV_SQRT2;
  const leftCut = base.cut([-INV_SQRT2, 0, INV_SQRT2], offset);
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut([INV_SQRT2, 0, -INV_SQRT2], offset);
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Wedge: two angled cuts in the YZ plane collapse the 50×50 end
 * face into a triangle with apex at (y=+25, z=0) and flat base
 * along y=-25 from z=-25 to z=+25.
 */
function buildWedge(prefix: string, pair: [Species, Species]): Panel {
  const base = Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
  const INV_SQRT5 = 1 / Math.sqrt(5);
  const offset = 5 * Math.sqrt(5);
  const leftCut = base.cut([0, INV_SQRT5, -2 * INV_SQRT5], offset);
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut([0, INV_SQRT5, 2 * INV_SQRT5], offset);
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Doorstop: both long edges of the top-down XZ rectangle taper evenly
 * inward to a point at X=+250, producing a tall isosceles triangle
 * when viewed from above. Base (Z from -25 to +25) stays at X=-250.
 * Y extent is unchanged, so the piece looks like a 500×50 rectangle
 * from the side.
 *
 * Cut planes (vertical, extruded along Y):
 *   1. through (-250, ·, +25) → (+250, ·, 0), normal (1, 0, 20)/√401
 *   2. through (-250, ·, -25) → (+250, ·, 0), normal (1, 0, -20)/√401
 * Both share offset 250/√401, and both keep the `below` half.
 */
function buildDoorstop(prefix: string, pair: [Species, Species]): Panel {
  const base = Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
  const INV_SQRT401 = 1 / Math.sqrt(401);
  const offset = 250 * INV_SQRT401;
  const topCut = base.cut([INV_SQRT401, 0, 20 * INV_SQRT401], offset);
  base.dispose();
  topCut.above.dispose();
  const bottomCut = topCut.below.cut(
    [INV_SQRT401, 0, -20 * INV_SQRT401],
    offset,
  );
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

/**
 * Shoemake uniform random rotation: samples three uniforms and
 * assembles a quaternion distributed uniformly on SO(3). Necessary
 * because naive Euler-angle randomization biases toward the poles.
 */
function randomRotationMatrix(): Matrix4 {
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

/**
 * Rotate `panel` by a random orientation, then rejection-sample
 * translations until the expanded AABB clears every previously
 * placed box. Returns the placed Panel and its raw AABB so the
 * caller can track the occupied region for subsequent pieces.
 */
function placePanel(
  panel: Panel,
  existing: Box3[],
): { placed: Panel; box: Box3 } | null {
  const rotated = panel.transform(randomRotationMatrix());
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

/** Build a single scatter attempt. Returns null if any piece fails to place. */
function tryBuildScene(): { root: Group; placedPanels: Panel[] } | null {
  const root = new Group();
  const existing: Box3[] = [];
  const placedPanels: Panel[] = [];
  for (const piece of PIECES) {
    const built = piece.build(piece.name, piece.pair);
    const result = placePanel(built, existing);
    built.dispose();
    if (!result) {
      placedPanels.forEach((p) => p.dispose());
      return null;
    }
    existing.push(result.box);
    const panelGroup = buildPanelGroup(result.placed);
    annotateFaceIDs(panelGroup, result.placed);
    root.add(panelGroup);
    placedPanels.push(result.placed);
  }
  return { root, placedPanels };
}

/**
 * Tolerances for coplanar-face grouping. Chosen conservatively for
 * our scale (pieces ~500 mm, strips ~50 mm):
 *   - NORMAL_DOT_TOL = 1e-4  →  angular tolerance ≈ 0.8°, well below
 *     the smallest meaningful angle in our geometry (45° cuts).
 *   - PLANE_D_TOL = 0.01 mm  →  10 µm, orders of magnitude tighter
 *     than the 50 mm smallest feature size.
 * FP noise accumulated through a rotation matrix + translation is
 * well under both — rotations preserve norms exactly for unit
 * normals up to the last FP bit.
 */
const NORMAL_DOT_TOL = 1e-4;
const PLANE_D_TOL = 0.01;

/**
 * One planar face of a segment mesh, in world-space coordinates. The
 * normal is a unit vector; `planeD = n·p` for any p on the face.
 * Faces with matching (normal, planeD) across meshes of the same
 * strip form one "strip face" (the user-facing selection target).
 */
interface FaceInfo {
  normal: Vector3;
  planeD: number;
}

/**
 * Group the triangles of a mesh by their supporting plane. Returns
 * `{ ids, faces }`:
 *   - `ids[t]` = face index for triangle t.
 *   - `faces[i]` = the supporting plane (normal + offset) for face i.
 *
 * We roll our own grouping rather than use manifold's `mesh.faceID`
 * because the latter is unreliable through our cut pipeline: the
 * kernel's ID pool reuses IDs across "above"/"below" splits, and we
 * observed single manifold faceIDs covering triangles on two
 * non-coplanar planes on every wedge and doorstop strip.
 *
 * Complexity is O(T·F) per mesh (T triangles, F distinct faces) —
 * fine for strip segments which have ~12 triangles and ~6 faces.
 *
 * Safety: each segment is CONVEX, so a plane supports at most one
 * connected region of its surface. Grouping by plane match is
 * therefore equivalent to grouping by face, within a single mesh.
 */
function computeFaceGrouping(
  mesh: Mesh,
): { ids: Uint32Array; faces: FaceInfo[] } | null {
  const posAttr = mesh.geometry.getAttribute('position') as
    | BufferAttribute
    | undefined;
  const indexAttr = mesh.geometry.getIndex();
  if (!posAttr || !indexAttr) return null;
  const numTri = indexAttr.count / 3;
  const ids = new Uint32Array(numTri);
  const faces: FaceInfo[] = [];

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const n = new Vector3();

  for (let t = 0; t < numTri; t++) {
    a.fromBufferAttribute(posAttr, indexAttr.getX(t * 3));
    b.fromBufferAttribute(posAttr, indexAttr.getX(t * 3 + 1));
    c.fromBufferAttribute(posAttr, indexAttr.getX(t * 3 + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len < 1e-12) {
      // Degenerate triangle. Park it in its own face so downstream
      // logic doesn't choke on a zero normal.
      ids[t] = faces.length;
      faces.push({ normal: new Vector3(0, 0, 0), planeD: 0 });
      continue;
    }
    n.divideScalar(len);
    const d = n.dot(a);

    let matched = -1;
    for (let f = 0; f < faces.length; f++) {
      if (1 - faces[f].normal.dot(n) > NORMAL_DOT_TOL) continue;
      if (Math.abs(faces[f].planeD - d) > PLANE_D_TOL) continue;
      matched = f;
      break;
    }
    if (matched < 0) {
      matched = faces.length;
      faces.push({ normal: n.clone(), planeD: d });
    }
    ids[t] = matched;
  }

  return { ids, faces };
}

/**
 * Attach per-triangle face IDs + per-face (normal, planeD) to each
 * segment mesh in a panel group. The (normal, planeD) array is what
 * strip-level selection needs: to match "the same face" across all
 * meshes belonging to one strip, we compare supporting planes.
 */
function annotateFaceIDs(panelGroup: Group, _panel: Panel): void {
  panelGroup.children.forEach((child) => {
    if (!(child instanceof Mesh)) return;
    if (typeof child.userData.segIdx !== 'number') return;
    const grouping = computeFaceGrouping(child);
    if (!grouping) return;
    child.userData.faceID = grouping.ids;
    child.userData.faces = grouping.faces;
  });
}

/**
 * Do two supporting planes represent the same world-space face?
 * Uses the same tolerance the grouping step does, so any pair of
 * plane descriptors that came out of computeFaceGrouping on a single
 * strip's meshes will compare equal iff they describe the same
 * logical strip face.
 */
function planesMatch(a: FaceInfo, b: FaceInfo): boolean {
  if (1 - a.normal.dot(b.normal) > NORMAL_DOT_TOL) return false;
  if (Math.abs(a.planeD - b.planeD) > PLANE_D_TOL) return false;
  return true;
}

/**
 * Retry the whole scatter on failure. Placement failure comes from an
 * unlucky rotation combination, not a fundamentally infeasible layout
 * — fresh rotations almost always fit the same scene bounds.
 */
const MAX_SCENE_ATTEMPTS = 6;
function buildScene(): { root: Group; placedCount: number } {
  for (let i = 0; i < MAX_SCENE_ATTEMPTS; i++) {
    const scene = tryBuildScene();
    if (scene) {
      scene.placedPanels.forEach((p) => p.dispose());
      return { root: scene.root, placedCount: scene.placedPanels.length };
    }
  }
  console.warn('[3d-experiment] scene placement never fit all pieces');
  return { root: new Group(), placedCount: 0 };
}

const ISO_VIEW = {
  direction: [-0.55, -0.5, -0.67] as [number, number, number],
  up: [0, 1, 0] as [number, number, number],
};

// ---------------------------------------------------------------------------
// Face selection
// ---------------------------------------------------------------------------

/**
 * A user-facing strip face selection. Identified by the strip it
 * belongs to and the world-space supporting plane of the face. The
 * plane is carried directly (not a mesh-local face ID) because a
 * strip face can span multiple segment meshes — every mesh of the
 * strip that has triangles on this plane contributes to the
 * highlighted region.
 */
interface Selection {
  stripId: string;
  plane: FaceInfo;
}

/**
 * Two highlight colors so the user can tell the two current
 * selections apart. Index 0 = first-placed, index 1 = second. When a
 * selection updates in place (same strip, different face), the slot
 * it occupied is preserved.
 */
const SELECTION_COLORS = [0xffc400, 0x26c6da];

/**
 * Click-vs-drag threshold. TrackballControls consumes mouse moves
 * for orbit/pan/zoom; a click is "pointer didn't travel far between
 * down and up". 5 px is generous enough to absorb hand jitter
 * without eating deliberate small drags.
 */
const CLICK_MAX_DRAG_PX = 5;

/**
 * Collect all segment meshes in the scene that belong to a given
 * strip. Each mesh exposes its strip membership via userData, written
 * by buildPanelGroup from the segment's contributingStripIds.
 */
function collectStripMeshes(root: Group, stripId: string): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (obj.userData.role === 'face-highlight') return;
    const ids = obj.userData.contributingStripIds as string[] | undefined;
    if (!ids || !ids.includes(stripId)) return;
    if (!obj.userData.faces) return;
    meshes.push(obj);
  });
  return meshes;
}

/**
 * Subset BufferGeometry containing exactly the triangles of a given
 * face on `mesh`. Positions are cloned (not shared) so disposing the
 * highlight doesn't perturb the underlying face geometry.
 */
function buildMeshFaceOverlay(
  mesh: Mesh,
  faceId: number,
  color: number,
): Mesh | null {
  const faceIDArr = mesh.userData.faceID as Uint32Array | undefined;
  const origIndex = mesh.geometry.getIndex();
  const posAttr = mesh.geometry.getAttribute('position') as
    | BufferAttribute
    | undefined;
  if (!faceIDArr || !origIndex || !posAttr) return null;
  const indices: number[] = [];
  for (let t = 0; t < faceIDArr.length; t++) {
    if (faceIDArr[t] === faceId) {
      indices.push(
        origIndex.getX(t * 3),
        origIndex.getX(t * 3 + 1),
        origIndex.getX(t * 3 + 2),
      );
    }
  }
  if (indices.length === 0) return null;
  const geom = new BufferGeometry();
  geom.setAttribute('position', posAttr.clone());
  geom.setIndex(indices);
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
  const highlight = new Mesh(geom, mat);
  highlight.userData.role = 'face-highlight';
  highlight.renderOrder = 10;
  return highlight;
}

/**
 * Replace the contents of `highlightsGroup`. For each selection, walk
 * every mesh belonging to the selected strip and add an overlay for
 * any face on that mesh whose plane matches the selection — that's
 * the strip-level "entire face" semantic: if ten parts share the
 * strip, all ten contribute their coplanar triangles.
 */
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
  selections.forEach((sel, i) => {
    const color = SELECTION_COLORS[i % SELECTION_COLORS.length];
    const meshes = collectStripMeshes(root, sel.stripId);
    for (const mesh of meshes) {
      const faces = mesh.userData.faces as FaceInfo[];
      for (let f = 0; f < faces.length; f++) {
        if (!planesMatch(faces[f], sel.plane)) continue;
        const overlay = buildMeshFaceOverlay(mesh, f, color);
        if (overlay) highlightsGroup.add(overlay);
      }
    }
  });
}

/**
 * Apply the "at most 2 selections on at most 2 different strips" rule.
 * Clicking a face:
 *   - On a strip already selected: same face-plane → deselect;
 *     different plane → update the selection's plane in place.
 *   - On a new strip: append; if two strips were already selected,
 *     FIFO-evict the older one first.
 */
function updateSelections(
  selections: Selection[],
  stripId: string,
  plane: FaceInfo,
): void {
  const existingIdx = selections.findIndex((s) => s.stripId === stripId);
  if (existingIdx >= 0) {
    const sel = selections[existingIdx];
    if (planesMatch(sel.plane, plane)) {
      selections.splice(existingIdx, 1);
    } else {
      sel.plane = { normal: plane.normal.clone(), planeD: plane.planeD };
    }
    return;
  }
  if (selections.length >= 2) selections.shift();
  selections.push({
    stripId,
    plane: { normal: plane.normal.clone(), planeD: plane.planeD },
  });
}

/**
 * Wire pointer events on the renderer canvas for face selection.
 * Listens in bubbling phase so TrackballControls sees events first
 * (and we don't interfere with orbit). Detects click-vs-drag by
 * pointer travel distance between down and up.
 *
 * Returns a teardown function that removes all listeners.
 */
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

    // Only raycast against annotated segment meshes. Skip edge
    // LineSegments and highlight overlays.
    const targets: Mesh[] = [];
    root.traverse((obj) => {
      if (
        obj instanceof Mesh &&
        obj.userData.faceID &&
        obj.userData.role !== 'face-highlight'
      ) {
        targets.push(obj);
      }
    });

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;
    const hit = hits[0];
    const mesh = hit.object as Mesh;
    const faceIDArr = mesh.userData.faceID as Uint32Array | undefined;
    const faces = mesh.userData.faces as FaceInfo[] | undefined;
    if (!faceIDArr || !faces) return;
    const localFaceId = faceIDArr[hit.faceIndex ?? 0];
    const plane = faces[localFaceId];
    if (!plane) return;
    const strips = mesh.userData.contributingStripIds as string[] | undefined;
    if (!strips || strips.length === 0) return;
    const stripId = strips[0];

    updateSelections(selections, stripId, plane);
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
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>('[data-slot="status"]');
  const tileEl = document.querySelector<HTMLElement>('[data-tile="scene"]');
  const reshuffleBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="reshuffle"]',
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
    let currentPlacedCount = 0;

    const renderStatus = (selections: Selection[]): void => {
      const selDesc =
        selections.length === 0
          ? 'click any face to select'
          : `selected ${selections.length}/2 · ${selections
              .map((s) => s.stripId)
              .join(' + ')}`;
      setStatus(
        `${currentPlacedCount}/${PIECES.length} pieces · drag to orbit · scroll to zoom · ${selDesc} · reshuffle for a new layout`,
      );
    };

    const render = () => {
      teardownSelection?.();
      teardownSelection = null;
      handle?.dispose();

      const { root, placedCount } = buildScene();
      currentPlacedCount = placedCount;

      const highlightsGroup = new Group();
      highlightsGroup.userData.role = 'face-highlights';
      root.add(highlightsGroup);

      handle = setupViewport(tileEl, root, { initialCameraState: ISO_VIEW });
      teardownSelection = wireSelection(
        handle,
        root,
        highlightsGroup,
        renderStatus,
      );
      renderStatus([]);

      // Expose live references for debug / automated verification.
      // This harness exists to reason about an interaction, so
      // having the scene pokeable from the console is useful.
      (window as any).__experiment = {
        camera: handle.camera,
        canvas: handle.canvas,
        root,
        highlightsGroup,
        THREE: { Vector3, Raycaster, Vector2 },
      };
    };

    render();
    reshuffleBtn?.addEventListener('click', render);
  } catch (err) {
    console.error('[3d-experiment] boot failed', err);
    setStatus(
      `boot failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

boot();
