<script lang="ts" module>
  /**
   * StripReorder — Svelte 5 port of strip-reorder.ts.
   *
   * Same pointer-event drag math as the imperative original (no HTML5
   * drag-and-drop). Strips render as SVG rects in mm units; the
   * dragged strip follows the cursor along the stack axis, neighbours
   * animate into rehearsal slots as the cursor crosses midpoints, and
   * onPointerUp commits the new order via `onChange(newOrder)`.
   *
   * Differences from the imperative version:
   *   - Svelte owns the SVG DOM — the component re-renders on
   *     `order` / `inventory` / `stripLength` changes via reactivity.
   *   - Rehearsal / drag visual state lives in local `$state`; the
   *     template reads those to compute transforms + stroke.
   *   - Document-level pointer listeners are attached once on mount
   *     and cleaned up on destroy.
   */

  import type { StripDef } from '../state/types';

  export interface ReorderState {
    inventory: StripDef[];
    order: string[];
    stripLength: number;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { SPECIES_COLOURS } from '../render/summary';

  interface Props {
    value: ReorderState;
    onChange: (nextOrder: string[]) => void;
  }

  // Prop named `value` rather than `state` — `$state` collides with
  // Svelte 5's store auto-subscribe detection in template context.
  let { value, onChange }: Props = $props();

  // Visual constants (mm units).
  const GAP_MM = 5;
  const STROKE = '#00000022';
  const STROKE_WIDTH_MM = 0.5;
  const DRAG_STROKE = '#1a1a1a';
  const DRAG_STROKE_WIDTH_MM = 1.2;
  const DRAG_LIFT_MM = 6;
  const ANIM_MS = 140;
  const MIN_HIT_THICKNESS_MM = 20;

  // Resolve ordered strips from the current state.
  const strips = $derived.by<StripDef[]>(() => {
    const byId = new Map(value.inventory.map((s) => [s.stripId, s]));
    const out: StripDef[] = [];
    for (const id of value.order) {
      const s = byId.get(id);
      if (s) out.push(s);
    }
    return out;
  });

  const widths = $derived(strips.map((s) => s.width));
  const totalStack = $derived(
    widths.reduce((s, w) => s + w, 0) + Math.max(0, strips.length - 1) * GAP_MM,
  );
  const L = $derived(Math.max(1, value.stripLength));

  // Cumulative slot Y offsets.
  const slotY = $derived.by<number[]>(() => {
    const out: number[] = [];
    let y = 0;
    for (let i = 0; i < strips.length; i++) {
      out.push(y);
      y += widths[i] + GAP_MM;
    }
    return out;
  });

  const viewBox = $derived(
    `${fmt(-GAP_MM)} ${fmt(-GAP_MM)} ${fmt(L + 2 * GAP_MM)} ${fmt(totalStack + 2 * GAP_MM)}`,
  );

  // Drag state — nulls out when not dragging.
  interface Dragging {
    fromSlot: number;
    currentSlot: number;
    stripId: string;
    startClientY: number;
    mmPerPxY: number;
    dyMm: number;
  }
  let dragging: Dragging | null = $state(null);

  let svgEl: SVGSVGElement | undefined = $state();

  function mmPerPxY(): number {
    if (!svgEl) return 1;
    const rect = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox.baseVal;
    if (rect.height === 0 || !vb || vb.height === 0) return 1;
    return vb.height / rect.height;
  }

  function onPointerDown(e: PointerEvent, slotIdx: number, stripId: string): void {
    if (strips.length <= 1) return;
    e.preventDefault();
    const target = e.currentTarget as SVGGElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* ok on SVG <g> in some browsers */
    }
    dragging = {
      fromSlot: slotIdx,
      currentSlot: slotIdx,
      stripId,
      startClientY: e.clientY,
      mmPerPxY: mmPerPxY(),
      dyMm: 0,
    };
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dyPx = e.clientY - dragging.startClientY;
    const dyMm = dyPx * dragging.mmPerPxY;
    const origCentre = slotY[dragging.fromSlot] + widths[dragging.fromSlot] / 2;
    const centre = origCentre + dyMm;
    const newSlot = slotAtCentre(widths, slotY, centre);
    dragging = { ...dragging, dyMm, currentSlot: newSlot };
  }

  function handlePointerUp(_e: PointerEvent): void {
    if (!dragging) return;
    const { fromSlot, currentSlot, stripId } = dragging;
    dragging = null;
    if (fromSlot === currentSlot) return;
    const newOrder = moveInArray(value.order, fromSlot, currentSlot);
    if (newOrder[currentSlot] !== stripId) return;
    onChange(newOrder);
  }

  // For each non-dragged strip compute its rehearsal-slot Y delta.
  function rehearsalDy(i: number): number {
    if (!dragging) return 0;
    if (i === dragging.fromSlot) return 0;
    const rehearsalOrder = moveInArrayIdx(strips.length, dragging.fromSlot, dragging.currentSlot);
    const rehearsalSlot = rehearsalOrder.indexOf(i);
    return slotY[rehearsalSlot] - slotY[i];
  }

  onMount(() => {
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = (e: PointerEvent) => handlePointerUp(e);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  });

  // ---- helpers --------------------------------------------------------

  function slotAtCentre(widths: number[], slotY: number[], centre: number): number {
    if (widths.length === 0) return 0;
    if (centre <= slotY[0] + widths[0] / 2) return 0;
    for (let i = 0; i < widths.length; i++) {
      const mid = slotY[i] + widths[i] / 2;
      if (centre < mid) return i;
    }
    return widths.length - 1;
  }

  function moveInArray<T>(arr: T[], from: number, to: number): T[] {
    const copy = [...arr];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  }

  function moveInArrayIdx(n: number, from: number, to: number): number[] {
    return moveInArray(
      Array.from({ length: n }, (_, i) => i),
      from,
      to,
    );
  }

  function fmt(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 1000) / 1000;
    const norm = Object.is(r, -0) ? 0 : r;
    return String(norm);
  }

  // Compute per-strip style each render. The dragged strip uses
  // translate(LIFT, dyMm) with no transition; others use
  // translate(0, rehearsalDy) with a transition.
  function stripTransform(i: number): string {
    if (dragging && i === dragging.fromSlot) {
      return `translate(${DRAG_LIFT_MM}px, ${dragging.dyMm}px)`;
    }
    return `translate(0px, ${rehearsalDy(i)}px)`;
  }

  function stripTransition(i: number): string {
    if (dragging && i === dragging.fromSlot) return 'none';
    return `transform ${ANIM_MS}ms ease`;
  }

  function stripCursor(i: number): string {
    if (dragging && i === dragging.fromSlot) return 'grabbing';
    return 'grab';
  }

  function stripFilter(i: number): string {
    if (dragging && i === dragging.fromSlot) return 'drop-shadow(0 2px 3px rgba(0,0,0,0.18))';
    return '';
  }

  function stripStroke(i: number): string {
    return dragging && i === dragging.fromSlot ? DRAG_STROKE : STROKE;
  }

  function stripStrokeWidth(i: number): number {
    return dragging && i === dragging.fromSlot ? DRAG_STROKE_WIDTH_MM : STROKE_WIDTH_MM;
  }
</script>

<div class="wrap">
  <svg
    bind:this={svgEl}
    xmlns="http://www.w3.org/2000/svg"
    viewBox={viewBox}
    preserveAspectRatio="xMidYMid meet"
  >
    {#each strips as strip, i (strip.stripId)}
      {@const w = widths[i]}
      {@const y = slotY[i]}
      {@const hitH = Math.max(MIN_HIT_THICKNESS_MM, w)}
      {@const hitY = y - (hitH - w) / 2}
      <g
        data-strip-id={strip.stripId}
        data-slot-idx={i}
        style:transform={stripTransform(i)}
        style:transition={stripTransition(i)}
        style:cursor={stripCursor(i)}
        style:filter={stripFilter(i)}
        onpointerdown={(e) => onPointerDown(e, i, strip.stripId)}
      >
        <rect
          x={fmt(0)}
          y={fmt(hitY)}
          width={fmt(L)}
          height={fmt(hitH)}
          fill="transparent"
          pointer-events="all"
        />
        <rect
          x={fmt(0)}
          y={fmt(y)}
          width={fmt(L)}
          height={fmt(w)}
          fill={SPECIES_COLOURS[strip.species]}
          stroke={stripStroke(i)}
          stroke-width={fmt(stripStrokeWidth(i))}
          vector-effect="non-scaling-stroke"
          data-species={strip.species}
          pointer-events="none"
        />
      </g>
    {/each}
  </svg>
</div>

<style>
  .wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    touch-action: none;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
</style>
