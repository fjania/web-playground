/**
 * Strip reorder — framework-agnostic drag-to-reorder UI for the
 * ComposeStrips arrangement.
 *
 * Renders the strips as horizontal boxes with **exploded gaps**
 * between them (so narrow strips are easier to grab). Widths in the
 * render mirror the actual strip widths so the maker can see the
 * pattern they're making, but each strip has a generous hit area
 * (enforced min of 28px) so drags work even on very narrow strips.
 *
 * Interaction: pointer-down on a strip captures the pointer, the
 * strip follows the cursor (translated), neighbours animate to their
 * new positions as the cursor crosses midpoints, and on pointer-up
 * the new order commits via `onChange(newOrder)`.
 *
 * Deliberately uses pointer events rather than HTML5 drag-and-drop
 * (the user's explicit preference — DnD is clunky for this kind of
 * interaction).
 *
 * State:
 *   - inventory: StripDef[] — the full set of available strips.
 *   - order: string[] — ordered strip ids. Must be a permutation of
 *     inventory's stripIds. If inventory and order ever get out of
 *     sync (e.g. the owner adds/removes strips in the inventory
 *     component), call `update(next)` to refresh.
 *
 * Downstream: the pipeline sees `order.map(id => inventory[id])`.
 */

import type { StripDef } from '../state/types';
import { SPECIES_COLOURS } from '../render/summary';

export interface ReorderState {
  inventory: StripDef[];
  order: string[];
}

export interface ReorderMountOptions {
  /** Fires with the new stripId order on drop. */
  onChange: (nextOrder: string[]) => void;
}

export interface ReorderHandle {
  update: (next: ReorderState) => void;
  dispose: () => void;
}

// Visual constants.
const STRIP_HEIGHT_PX = 84; // "thickness" shown on screen
const MIN_STRIP_WIDTH_PX = 28; // minimum hit area, regardless of mm width
const MM_PER_PX = 1; // 1mm = 1px at default zoom; narrow strips still get MIN_STRIP_WIDTH_PX
const STRIP_GAP_PX = 8; // explode gap between strips

export function mountStripReorder(
  el: HTMLElement,
  initial: ReorderState,
  options: ReorderMountOptions,
): ReorderHandle {
  let state: ReorderState = cloneState(initial);
  let containerEl: HTMLElement | null = null;

  // Resources we need to clean up on dispose / rerender.
  let pointerCleanup: (() => void) | null = null;

  function render(): void {
    el.innerHTML = '';
    pointerCleanup?.();
    pointerCleanup = null;

    const wrap = document.createElement('div');
    wrap.className = 'strip-reorder';
    wrap.style.position = 'relative';
    wrap.style.width = '100%';
    wrap.style.minHeight = `${STRIP_HEIGHT_PX + 40}px`;
    wrap.style.padding = '18px 8px';
    wrap.style.overflowX = 'auto';
    wrap.style.overflowY = 'hidden';
    wrap.style.userSelect = 'none';
    wrap.style.background = '#f6f5f1';
    wrap.style.borderRadius = '4px';

    const strips = resolveStrips(state);
    const widths = strips.map(stripPxWidth);
    const totalWidth =
      widths.reduce((s, w) => s + w, 0) +
      Math.max(0, strips.length - 1) * STRIP_GAP_PX;

    // Track container for strips
    const track = document.createElement('div');
    track.style.position = 'relative';
    track.style.height = `${STRIP_HEIGHT_PX + 18}px`;
    track.style.width = `${Math.max(totalWidth, 100)}px`;
    track.style.margin = '0 auto';
    wrap.appendChild(track);

    // Each strip becomes a positioned element. We keep references so
    // drag can update their transforms.
    const stripEls: HTMLElement[] = strips.map((strip, i) => {
      const box = buildStripEl(strip, i, widths[i]);
      track.appendChild(box);
      return box;
    });

    // Layout strips at their slots
    layout(stripEls, widths, null, 0);

    // Wire drag
    pointerCleanup = attachDrag(track, stripEls, widths, state, (nextOrder) => {
      state = { ...state, order: nextOrder };
      options.onChange([...nextOrder]);
      render();
    });

    el.appendChild(wrap);
    containerEl = wrap;
  }

  render();

  return {
    update(next: ReorderState): void {
      state = cloneState(next);
      render();
    },
    dispose(): void {
      pointerCleanup?.();
      pointerCleanup = null;
      el.innerHTML = '';
      containerEl = null;
    },
  };
  // suppress "unused" lint
  void containerEl;
}

// ---- strip widget ----

function buildStripEl(
  strip: StripDef,
  idx: number,
  pxWidth: number,
): HTMLElement {
  const box = document.createElement('div');
  box.dataset.stripId = strip.stripId;
  box.dataset.slotIdx = String(idx);
  box.style.position = 'absolute';
  box.style.top = '0px';
  box.style.left = '0px';
  box.style.width = `${pxWidth}px`;
  box.style.height = `${STRIP_HEIGHT_PX}px`;
  box.style.background = SPECIES_COLOURS[strip.species];
  box.style.border = '1px solid #00000033';
  box.style.borderRadius = '3px';
  box.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
  box.style.cursor = 'grab';
  box.style.touchAction = 'none';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.alignItems = 'center';
  box.style.justifyContent = 'flex-end';
  box.style.paddingBottom = '4px';
  box.style.transition = 'transform 140ms ease, left 140ms ease';
  box.style.willChange = 'transform, left';

  // Index label below the strip
  const label = document.createElement('div');
  label.style.position = 'absolute';
  label.style.top = `${STRIP_HEIGHT_PX + 4}px`;
  label.style.left = '0';
  label.style.right = '0';
  label.style.textAlign = 'center';
  label.style.fontSize = '0.65rem';
  label.style.color = '#666';
  label.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, monospace';
  label.textContent = `${idx}`;
  box.appendChild(label);

  // Width label inside the strip (bottom) — shows actual mm.
  const widthLabel = document.createElement('div');
  widthLabel.style.fontSize = '0.6rem';
  widthLabel.style.color = isLightSpecies(strip) ? '#333' : '#f2efe8';
  widthLabel.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, monospace';
  widthLabel.style.textShadow = isLightSpecies(strip)
    ? 'none'
    : '0 1px 0 rgba(0,0,0,0.3)';
  widthLabel.textContent = `${strip.width}`;
  box.appendChild(widthLabel);

  return box;
}

function isLightSpecies(strip: StripDef): boolean {
  return strip.species === 'maple';
}

function stripPxWidth(s: StripDef): number {
  return Math.max(MIN_STRIP_WIDTH_PX, s.width * MM_PER_PX);
}

// ---- layout ----

/**
 * Compute the absolute left-offset for the slot at `idx`, given the
 * natural slot widths.
 */
function slotLeft(widths: number[], idx: number): number {
  let x = 0;
  for (let i = 0; i < idx; i++) x += widths[i] + STRIP_GAP_PX;
  return x;
}

function layout(
  stripEls: HTMLElement[],
  widths: number[],
  draggingIdx: number | null,
  dragDx: number,
): void {
  stripEls.forEach((el, i) => {
    const x = slotLeft(widths, i);
    el.style.left = `${x}px`;
    if (i === draggingIdx) {
      el.style.transform = `translate(${dragDx}px, -4px)`;
      el.style.transition = 'none';
      el.style.zIndex = '10';
      el.style.boxShadow = '0 6px 12px rgba(0,0,0,0.22)';
      el.style.cursor = 'grabbing';
    } else {
      el.style.transform = 'translate(0px, 0px)';
      el.style.transition = 'transform 140ms ease, left 140ms ease';
      el.style.zIndex = '1';
      el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
      el.style.cursor = 'grab';
    }
  });
}

// ---- drag machinery ----

function attachDrag(
  track: HTMLElement,
  stripEls: HTMLElement[],
  widths: number[],
  state: ReorderState,
  commit: (newOrder: string[]) => void,
): () => void {
  // Closure state — which strip is currently being dragged.
  let dragging: {
    fromSlot: number;
    currentSlot: number;
    stripId: string;
    startX: number;
    dx: number;
    el: HTMLElement;
  } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const stripEl = findStripAncestor(target);
    if (!stripEl) return;
    const fromSlotStr = stripEl.dataset.slotIdx;
    if (fromSlotStr === undefined) return;
    const fromSlot = Number(fromSlotStr);
    const stripId = stripEl.dataset.stripId!;
    e.preventDefault();
    stripEl.setPointerCapture(e.pointerId);

    dragging = {
      fromSlot,
      currentSlot: fromSlot,
      stripId,
      startX: e.clientX,
      dx: 0,
      el: stripEl,
    };
    layout(stripEls, widths, fromSlot, 0);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    dragging.dx = e.clientX - dragging.startX;
    // Compute which slot the dragged item's centre currently sits in.
    const halfW = widths[dragging.fromSlot] / 2;
    const origLeft = slotLeft(widths, dragging.fromSlot);
    const centreX = origLeft + halfW + dragging.dx;
    const newSlot = slotAtX(widths, centreX);
    if (newSlot !== dragging.currentSlot) {
      dragging.currentSlot = newSlot;
      // Repaint: ghosts of non-dragged strips shift to make room.
      layoutWithRehearsal(
        stripEls,
        widths,
        dragging.fromSlot,
        newSlot,
        dragging.dx,
      );
    } else {
      // Just move the dragged strip; ghosts stay put.
      dragging.el.style.transform = `translate(${dragging.dx}px, -4px)`;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    const { fromSlot, currentSlot, stripId, el } = dragging;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // nothing
    }
    const done = dragging;
    dragging = null;
    if (fromSlot === currentSlot) {
      // No move — relax back.
      layout(stripEls, widths, null, 0);
      return;
    }
    // Compute new order.
    const newOrder = moveInArray(state.order, fromSlot, currentSlot);
    // Ensure the moved stripId is consistent (defensive).
    if (newOrder[currentSlot] !== stripId) {
      // Should not happen, but bail to a safe state.
      layout(stripEls, widths, null, 0);
      return;
    }
    void done;
    commit(newOrder);
  };

  // Attach to each strip element.
  for (const stripEl of stripEls) {
    stripEl.addEventListener('pointerdown', onPointerDown);
  }
  // Move / up listeners on document so dragging still tracks if the
  // pointer leaves the track.
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  return () => {
    for (const stripEl of stripEls) {
      stripEl.removeEventListener('pointerdown', onPointerDown);
    }
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
  };
  void track;
}

/**
 * During a drag, visualise what the final order would be if dropped
 * now: the dragged strip follows the cursor; every other strip
 * settles into its rehearsal slot (which is its index in the
 * permutation `moveInArray(order, fromSlot, currentSlot)`).
 */
function layoutWithRehearsal(
  stripEls: HTMLElement[],
  widths: number[],
  fromSlot: number,
  currentSlot: number,
  dragDx: number,
): void {
  // rehearsalOrder[rehearsalSlot] = original slot index
  const rehearsalOrder = moveInArray(
    Array.from({ length: stripEls.length }, (_, i) => i),
    fromSlot,
    currentSlot,
  );
  stripEls.forEach((el, i) => {
    if (i === fromSlot) {
      // the dragged element — show at dragged position
      const origLeft = slotLeft(widths, fromSlot);
      el.style.left = `${origLeft}px`;
      el.style.transform = `translate(${dragDx}px, -4px)`;
      el.style.transition = 'none';
      el.style.zIndex = '10';
      el.style.boxShadow = '0 6px 12px rgba(0,0,0,0.22)';
      el.style.cursor = 'grabbing';
    } else {
      // Find this element's rehearsal slot (where it lives when the
      // dragged element is parked at currentSlot).
      const rehearsalSlot = rehearsalOrder.indexOf(i);
      const x = slotLeft(widths, rehearsalSlot);
      el.style.left = `${x}px`;
      el.style.transform = 'translate(0px, 0px)';
      el.style.transition = 'left 140ms ease, transform 140ms ease';
      el.style.zIndex = '1';
      el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
      el.style.cursor = 'grab';
    }
  });
}

/**
 * Given the track-relative X coordinate of a cursor, return the slot
 * index whose centre that X falls inside. Slot widths may vary, so we
 * walk them and compare.
 */
function slotAtX(widths: number[], x: number): number {
  if (x <= 0) return 0;
  let cumul = 0;
  for (let i = 0; i < widths.length; i++) {
    const slotMid = cumul + widths[i] / 2;
    if (x < slotMid) return i;
    cumul += widths[i] + STRIP_GAP_PX;
  }
  return widths.length - 1;
}

function findStripAncestor(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.dataset && cur.dataset.stripId) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function resolveStrips(state: ReorderState): StripDef[] {
  const byId = new Map(state.inventory.map((s) => [s.stripId, s]));
  const out: StripDef[] = [];
  for (const id of state.order) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  return out;
}

function cloneState(s: ReorderState): ReorderState {
  return {
    inventory: s.inventory.map((x) => ({ ...x })),
    order: [...s.order],
  };
}
