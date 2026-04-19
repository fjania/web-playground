/**
 * Strip reorder — drag-to-reorder UI for the ComposeStrips arrangement.
 *
 * Visual language matches the Arrange operation tile
 * (`renderArrangeOperation` → `summarize(panel)`): strips are rendered
 * as SVG `<polygon>` fills using `SPECIES_COLOURS`, with the same
 * muted stroke (`#00000022`, 0.5 mm width). The viewBox is in mm — 1
 * unit == 1 mm — so strip widths and lengths display in true relative
 * proportion, exactly like every other IXO tile.
 *
 * Strips are shown **exploded** with small gaps (GAP_MM) so narrow
 * strips stay grabbable, and so the render reads as "pieces not yet
 * flush" (composition happens downstream in the 3D Output tile).
 *
 * Interaction: pointer-down on a strip polygon captures the pointer,
 * a CSS transform follows the cursor, neighbours animate into their
 * rehearsal positions as the cursor crosses midpoints, and on
 * pointer-up the new order commits via `onChange(newOrder)`.
 *
 * No HTML5 drag-and-drop (clunky). No drop shadows, no rounded
 * background boxes, no in-strip width labels — the visual vocabulary
 * is intentionally the same as every other 2D operation tile.
 *
 * State:
 *   - inventory: StripDef[] — the full set of available strips.
 *   - order: string[] — ordered strip ids (permutation of inventory).
 *   - stripLength: number — mm, panel Z extent. Drives the SVG
 *     viewBox's Z dimension so the aspect ratio matches the 3D panel.
 *
 * Downstream: the pipeline sees `order.map(id => inventory[id])`.
 */

import type { StripDef } from '../state/types';
import { SPECIES_COLOURS } from '../render/summary';

export interface ReorderState {
  inventory: StripDef[];
  order: string[];
  stripLength: number;
}

export interface ReorderMountOptions {
  /** Fires with the new stripId order on drop. */
  onChange: (nextOrder: string[]) => void;
}

export interface ReorderHandle {
  update: (next: ReorderState) => void;
  dispose: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Visual constants (mm units — consistent with summarize()).
const GAP_MM = 5;
const STROKE = '#00000022';
const STROKE_WIDTH_MM = 0.5;
const DRAG_STROKE = '#1a1a1a';
const DRAG_STROKE_WIDTH_MM = 1.2;
const DRAG_LIFT_MM = 6;

// Animations measured in ms (CSS), hit-padding in mm (SVG user units).
const ANIM_MS = 140;
/**
 * Minimum hit width in mm. Narrow strips get a transparent rect
 * behind them extending the grab target. 20 mm is ≈ 3/4" which is
 * roughly the smallest strip a hand-tool maker would realistically
 * want.
 */
const MIN_HIT_WIDTH_MM = 20;

export function mountStripReorder(
  el: HTMLElement,
  initial: ReorderState,
  options: ReorderMountOptions,
): ReorderHandle {
  let state: ReorderState = cloneState(initial);

  let pointerCleanup: (() => void) | null = null;

  function render(): void {
    el.innerHTML = '';
    pointerCleanup?.();
    pointerCleanup = null;

    const strips = resolveStrips(state);
    const widths = strips.map((s) => s.width);
    const totalWidth =
      widths.reduce((s, w) => s + w, 0) +
      Math.max(0, strips.length - 1) * GAP_MM;

    const Z = Math.max(1, state.stripLength);

    // Outer centring wrapper — keeps SVG centred in the tile's render
    // slot at any aspect ratio.
    const wrap = document.createElement('div');
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.userSelect = 'none';
    wrap.style.touchAction = 'none';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute(
      'viewBox',
      `${fmt(-GAP_MM)} ${fmt(-GAP_MM)} ${fmt(totalWidth + 2 * GAP_MM)} ${fmt(Z + 2 * GAP_MM)}`,
    );
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    // Compute per-slot X offsets (cumulative with gaps).
    const slotX: number[] = [];
    {
      let x = 0;
      for (let i = 0; i < strips.length; i++) {
        slotX.push(x);
        x += widths[i] + GAP_MM;
      }
    }

    // One <g> per strip so we can transform each independently on drag.
    const stripGroups: SVGGElement[] = strips.map((strip, i) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.dataset.stripId = strip.stripId;
      g.dataset.slotIdx = String(i);
      g.style.transition = `transform ${ANIM_MS}ms ease`;
      g.style.cursor = 'grab';

      // Generous hit rect — transparent, extends beneath narrow strips
      // so they remain grabbable. Centred on the visible polygon.
      const w = widths[i];
      const hitW = Math.max(MIN_HIT_WIDTH_MM, w);
      const hitXOff = (hitW - w) / 2;
      const hit = document.createElementNS(SVG_NS, 'rect');
      hit.setAttribute('x', fmt(slotX[i] - hitXOff));
      hit.setAttribute('y', fmt(0));
      hit.setAttribute('width', fmt(hitW));
      hit.setAttribute('height', fmt(Z));
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('pointer-events', 'all');
      g.appendChild(hit);

      // Visible polygon — actual strip width.
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', fmt(slotX[i]));
      rect.setAttribute('y', fmt(0));
      rect.setAttribute('width', fmt(w));
      rect.setAttribute('height', fmt(Z));
      rect.setAttribute('fill', SPECIES_COLOURS[strip.species]);
      rect.setAttribute('stroke', STROKE);
      rect.setAttribute('stroke-width', fmt(STROKE_WIDTH_MM));
      rect.setAttribute('vector-effect', 'non-scaling-stroke');
      rect.setAttribute('data-species', strip.species);
      rect.setAttribute('pointer-events', 'none');
      g.appendChild(rect);

      svg.appendChild(g);
      return g;
    });

    wrap.appendChild(svg);
    el.appendChild(wrap);

    // Wire drag (needs the SVG + slots + widths in closure).
    if (strips.length > 1) {
      pointerCleanup = attachDrag(
        svg,
        stripGroups,
        widths,
        slotX,
        state,
        (nextOrder) => {
          state = { ...state, order: nextOrder };
          options.onChange([...nextOrder]);
          render();
        },
      );
    }
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
    },
  };
}

// ---- drag machinery -------------------------------------------------------

function attachDrag(
  svg: SVGSVGElement,
  stripGroups: SVGGElement[],
  widths: number[],
  slotX: number[],
  state: ReorderState,
  commit: (newOrder: string[]) => void,
): () => void {
  let dragging: {
    fromSlot: number;
    currentSlot: number;
    stripId: string;
    startClientX: number;
    el: SVGGElement;
    // Cached mm-per-px at drag start so pointermove converts correctly
    // even if layout shifts mid-gesture.
    mmPerPx: number;
  } | null = null;

  function mmPerPx(): number {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    if (rect.width === 0 || !vb || vb.width === 0) return 1;
    return vb.width / rect.width;
  }

  const onPointerDown = (e: PointerEvent): void => {
    const target = e.target as Element;
    const g = findStripAncestor(target);
    if (!g) return;
    const fromSlot = Number(g.dataset.slotIdx);
    if (!Number.isFinite(fromSlot)) return;
    const stripId = g.dataset.stripId!;
    e.preventDefault();
    try {
      g.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers disallow capture on SVG <g>. Fine — doc-level
      // move listeners still receive events.
    }

    dragging = {
      fromSlot,
      currentSlot: fromSlot,
      stripId,
      startClientX: e.clientX,
      el: g,
      mmPerPx: mmPerPx(),
    };
    setDraggingStyle(g, 0, true);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dxPx = e.clientX - dragging.startClientX;
    const dxMm = dxPx * dragging.mmPerPx;
    setDraggingStyle(dragging.el, dxMm, true);

    const origCentre = slotX[dragging.fromSlot] + widths[dragging.fromSlot] / 2;
    const centre = origCentre + dxMm;
    const newSlot = slotAtCentreX(widths, slotX, centre);
    if (newSlot !== dragging.currentSlot) {
      dragging.currentSlot = newSlot;
      layoutRehearsal(
        stripGroups,
        widths,
        slotX,
        dragging.fromSlot,
        newSlot,
      );
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!dragging) return;
    const { fromSlot, currentSlot, stripId, el } = dragging;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragging = null;
    setDraggingStyle(el, 0, false);

    if (fromSlot === currentSlot) {
      resetRehearsal(stripGroups);
      return;
    }
    const newOrder = moveInArray(state.order, fromSlot, currentSlot);
    if (newOrder[currentSlot] !== stripId) {
      resetRehearsal(stripGroups);
      return;
    }
    commit(newOrder);
  };

  for (const g of stripGroups) {
    g.addEventListener('pointerdown', onPointerDown);
  }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  return () => {
    for (const g of stripGroups) {
      g.removeEventListener('pointerdown', onPointerDown);
    }
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
  };
}

/**
 * Set / clear the "being dragged" visual: lift the strip up by
 * DRAG_LIFT_MM and bump the stroke. CSS transform is in SVG user
 * units because the <g> lives inside the viewBox coordinate system.
 */
function setDraggingStyle(
  g: SVGGElement,
  dxMm: number,
  active: boolean,
): void {
  if (active) {
    g.style.transition = 'none';
    g.style.transform = `translate(${dxMm}px, ${-DRAG_LIFT_MM}px)`;
    g.style.cursor = 'grabbing';
    g.style.filter = 'drop-shadow(0 2px 3px rgba(0,0,0,0.18))';
    // Bump the visible polygon's stroke for clearer focus.
    const rect = g.querySelector('rect[data-species]');
    if (rect) {
      rect.setAttribute('stroke', DRAG_STROKE);
      rect.setAttribute('stroke-width', fmt(DRAG_STROKE_WIDTH_MM));
    }
  } else {
    g.style.transition = `transform ${ANIM_MS}ms ease`;
    g.style.transform = 'translate(0px, 0px)';
    g.style.cursor = 'grab';
    g.style.filter = '';
    const rect = g.querySelector('rect[data-species]');
    if (rect) {
      rect.setAttribute('stroke', STROKE);
      rect.setAttribute('stroke-width', fmt(STROKE_WIDTH_MM));
    }
  }
}

/**
 * Reposition non-dragged strips so the composition pretends the
 * dragged element is at `currentSlot`. Produces the "make room"
 * effect. Uses CSS transform (in SVG user units) so positions
 * animate with a transition.
 */
function layoutRehearsal(
  stripGroups: SVGGElement[],
  widths: number[],
  slotX: number[],
  fromSlot: number,
  currentSlot: number,
): void {
  const rehearsalOrder = moveInArray(
    Array.from({ length: stripGroups.length }, (_, i) => i),
    fromSlot,
    currentSlot,
  );
  stripGroups.forEach((g, i) => {
    if (i === fromSlot) return; // dragged element handled elsewhere
    const rehearsalSlot = rehearsalOrder.indexOf(i);
    const dxMm = slotX[rehearsalSlot] - slotX[i];
    g.style.transition = `transform ${ANIM_MS}ms ease`;
    g.style.transform = `translate(${dxMm}px, 0px)`;
  });
}

function resetRehearsal(stripGroups: SVGGElement[]): void {
  stripGroups.forEach((g) => {
    g.style.transition = `transform ${ANIM_MS}ms ease`;
    g.style.transform = 'translate(0px, 0px)';
  });
}

/**
 * Walk slot centres and return the slot whose centre `centre` is
 * closest to (or past) given the cumulative slot widths.
 */
function slotAtCentreX(
  widths: number[],
  slotX: number[],
  centre: number,
): number {
  if (centre <= slotX[0] + widths[0] / 2) return 0;
  for (let i = 0; i < widths.length; i++) {
    const mid = slotX[i] + widths[i] / 2;
    if (centre < mid) return i;
  }
  return widths.length - 1;
}

function findStripAncestor(el: Element): SVGGElement | null {
  let cur: Element | null = el;
  while (cur) {
    if (
      cur instanceof SVGGElement &&
      (cur as SVGGElement).dataset &&
      (cur as SVGGElement).dataset.stripId
    ) {
      return cur as SVGGElement;
    }
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
    stripLength: s.stripLength,
  };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  const norm = Object.is(r, -0) ? 0 : r;
  return String(norm);
}
