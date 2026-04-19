import {
  Group,
  Mesh,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { StripDef } from '../domain/types';
import type { Tile } from './Tile';

export interface StripDraggerDeps {
  tile: Tile;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  /** OrbitControls or similar with an `enabled` flag. Disabled during drag. */
  controls: { enabled: boolean };
  /**
   * Container holding per-strip sub-Groups (in render order). Each child's
   * userData.segIdx is the strip's index in the current list.
   */
  panelGroup: Group;
  /** Current strips (read at drag start to snapshot widths). */
  getStrips: () => StripDef[];
  /** Commit a reordered list when drag ends with a new order. */
  setStrips: (next: StripDef[]) => void;
  /** Called when a drag begins — lets caller suppress hover etc. */
  onDragStart?: () => void;
  /** Called when a drag ends (committed or cancelled). */
  onDragEnd?: () => void;
}

interface DragState {
  strips: StripDef[];
  originalCenters: number[];
  originalOrder: number[];         // identity permutation at start: [0,1,2,...]
  previewOrder: number[];          // mutated as drag crosses slot centers
  draggedOriginalIdx: number;      // index in originalOrder that user grabbed
  panelY: number;                  // world Y of the picked hit — drag plane
  pointerOffsetX: number;          // pointer world-X minus dragged center at grab
}

/** Compute each strip's slot center (world X) given a list of widths. */
function slotCenters(strips: StripDef[]): number[] {
  const total = strips.reduce((s, st) => s + st.width, 0);
  let x = -total / 2;
  return strips.map((st) => {
    const cx = x + st.width / 2;
    x += st.width;
    return cx;
  });
}

/**
 * Attach drag-to-reorder behavior to a Tile. Returns a teardown function.
 * The dragger is stateless across drags — listeners live on the renderer's
 * canvas, toggled on for the Tile's bounds.
 */
export function attachStripDragger(deps: StripDraggerDeps): () => void {
  const { tile, renderer, camera, controls, panelGroup } = deps;
  const canvas = renderer.domElement;

  const raycaster = new Raycaster();
  const mouse = new Vector2();
  let drag: DragState | null = null;

  function worldPointAtY(clientX: number, clientY: number, y: number): Vector3 | null {
    if (!tile.contains(clientX, clientY)) return null;
    const { nx, ny } = tile.ndc(clientX, clientY);
    mouse.set(nx, ny);
    raycaster.setFromCamera(mouse, camera);
    const plane = new Plane(new Vector3(0, 1, 0), -y);
    const hit = new Vector3();
    const r = raycaster.ray.intersectPlane(plane, hit);
    return r ? hit : null;
  }

  function pickStripAt(clientX: number, clientY: number):
    | { segIdx: number; panelY: number; worldX: number }
    | null {
    if (!tile.contains(clientX, clientY)) return null;
    const { nx, ny } = tile.ndc(clientX, clientY);
    mouse.set(nx, ny);
    raycaster.setFromCamera(mouse, camera);

    const meshes: Mesh[] = [];
    panelGroup.traverse((m: any) => {
      if (m.isMesh) meshes.push(m);
    });
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;

    // Walk up to find the per-strip sub-Group.
    let p: any = hit.object;
    while (p && p.userData?.segIdx == null) p = p.parent;
    if (!p) return null;

    return { segIdx: p.userData.segIdx, panelY: hit.point.y, worldX: hit.point.x };
  }

  function applyPreview(): void {
    if (!drag) return;
    // Compute slot centers in the preview order (reordered strips).
    const previewStrips = drag.previewOrder.map((i) => drag!.strips[i]);
    const previewCenters = slotCenters(previewStrips);
    // For each original strip i, find where it lives in previewOrder.
    for (let origIdx = 0; origIdx < drag.originalOrder.length; origIdx++) {
      const posInPreview = drag.previewOrder.indexOf(origIdx);
      const sub = panelGroup.children[origIdx] as Group;
      if (!sub) continue;
      const targetCenter = previewCenters[posInPreview];
      sub.position.x = targetCenter - drag.originalCenters[origIdx];
    }
  }

  function overridePositionForDragged(pointerWorldX: number): void {
    if (!drag) return;
    const origIdx = drag.draggedOriginalIdx;
    const sub = panelGroup.children[origIdx] as Group;
    if (!sub) return;
    const targetCenterX = pointerWorldX - drag.pointerOffsetX;
    sub.position.x = targetCenterX - drag.originalCenters[origIdx];
  }

  function updatePreviewOrder(pointerWorldX: number): void {
    if (!drag) return;
    // Remove the dragged strip from its current preview slot, then insert it
    // at the slot whose center in the REMAINING layout is nearest to the
    // pointer. This gives a stable "slide neighbors aside" feel.
    const without = drag.previewOrder.filter((i) => i !== drag!.draggedOriginalIdx);
    const widthsWithout = without.map((i) => drag!.strips[i]);
    const centersWithout = slotCenters(widthsWithout);

    // Find insertion index: the slot whose X is closest to pointer relative
    // to the dragged strip's midpoint. We look at gap positions between
    // existing strips.
    let insertAt = 0;
    // Gap positions are the left edge of slot k (for k=0..N-1) and the right edge of the last slot.
    const total = widthsWithout.reduce((s, st) => s + st.width, 0);
    let cursor = -total / 2;
    let bestDist = Infinity;
    for (let k = 0; k <= widthsWithout.length; k++) {
      const gapX = k === 0 ? cursor : cursor + 0;
      const dist = Math.abs(pointerWorldX - gapX);
      if (dist < bestDist) {
        bestDist = dist;
        insertAt = k;
      }
      if (k < widthsWithout.length) cursor += widthsWithout[k].width;
    }

    const next = without.slice();
    next.splice(insertAt, 0, drag.draggedOriginalIdx);
    drag.previewOrder = next;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // left-click only
    const pick = pickStripAt(e.clientX, e.clientY);
    if (!pick) return;

    const strips = deps.getStrips();
    if (strips.length <= 1) return;

    const originalCenters = slotCenters(strips);
    const originalOrder = strips.map((_, i) => i);
    const draggedOriginalIdx = pick.segIdx;
    const pointerWorld = worldPointAtY(e.clientX, e.clientY, pick.panelY);
    if (!pointerWorld) return;

    drag = {
      strips: strips.map((s) => ({ ...s })),
      originalCenters,
      originalOrder,
      previewOrder: originalOrder.slice(),
      draggedOriginalIdx,
      panelY: pick.panelY,
      pointerOffsetX: pointerWorld.x - originalCenters[draggedOriginalIdx],
    };

    controls.enabled = false;
    deps.onDragStart?.();
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const pointerWorld = worldPointAtY(e.clientX, e.clientY, drag.panelY);
    if (!pointerWorld) return;
    updatePreviewOrder(pointerWorld.x);
    applyPreview();
    overridePositionForDragged(pointerWorld.x);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag) return;
    const { previewOrder, strips } = drag;
    const nextStrips = previewOrder.map((i) => strips[i]);

    // Reset per-strip group offsets — the pipeline rebuild will re-lay out
    // segments from the new manifold positions.
    for (const c of panelGroup.children) c.position.set(0, 0, 0);

    canvas.releasePointerCapture?.(e.pointerId);
    controls.enabled = true;
    drag = null;
    deps.onDragEnd?.();

    // Only commit if the order actually changed.
    const changed = nextStrips.some(
      (s, i) => s.species !== strips[i].species || s.width !== strips[i].width,
    );
    if (changed) deps.setStrips(nextStrips);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  };
}

/**
 * Attach a right-click-to-remove handler for strips in the panel tile.
 * Picks the strip under the cursor and splices it from the list via
 * setStrips. Does nothing if the list has only one strip.
 */
export function attachStripRemover(deps: {
  tile: Tile;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  panelGroup: Group;
  getStrips: () => StripDef[];
  setStrips: (next: StripDef[]) => void;
}): () => void {
  const { tile, renderer, camera, panelGroup } = deps;
  const canvas = renderer.domElement;
  const raycaster = new Raycaster();
  const mouse = new Vector2();

  function onContext(e: MouseEvent): void {
    if (!tile.contains(e.clientX, e.clientY)) return;
    e.preventDefault();
    const strips = deps.getStrips();
    if (strips.length <= 1) return;

    const { nx, ny } = tile.ndc(e.clientX, e.clientY);
    mouse.set(nx, ny);
    raycaster.setFromCamera(mouse, camera);
    const meshes: Mesh[] = [];
    panelGroup.traverse((m: any) => {
      if (m.isMesh) meshes.push(m);
    });
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return;
    let p: any = hit.object;
    while (p && p.userData?.segIdx == null) p = p.parent;
    if (!p) return;

    const idx = p.userData.segIdx as number;
    const next = strips.slice();
    next.splice(idx, 1);
    deps.setStrips(next);
  }

  canvas.addEventListener('contextmenu', onContext);
  return () => canvas.removeEventListener('contextmenu', onContext);
}
