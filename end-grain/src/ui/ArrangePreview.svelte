<script lang="ts" module>
  /**
   * ArrangePreview — interactive top-down render of the post-Arrange
   * panel. Replaces the `renderArrangeOperation` SVG-string output
   * for the workbench; the harness and other call sites still use
   * the string form.
   *
   * SNAPSHOT IS TRUTH (see CLAUDE.md):
   *   The geometry drawn here comes exclusively from
   *   `arrangeResult.panel.volumes[*].topFace`. The pipeline has
   *   already applied every PlaceEdit, spacer, and per-slice rotation
   *   to those topFace polygons. The component does NOT re-derive
   *   geometry from CutResult, PlaceEdit[], or any feature params.
   *   No hidden rotate/shift/re-centre happens in this file.
   *
   * Slice grouping for interaction:
   *   Each volume tags itself with a `contributingSliceIds` like
   *   `${cutId}-slice-${sliceIdx}`. We parse the trailing number to
   *   bucket volumes into slice groups; each group is one clickable
   *   hit-zone. Volumes whose ids don't match (spacers, un-attributed)
   *   render but are not interactive.
   *
   * Spacer hatching carries over from the string renderer: volumes
   * whose contributingStripIds include a SpacerInsert id get a
   * diagonal hatch overlay so you can tell spacers from slices even
   * when species colours happen to match.
   */

  import type {
    ArrangeResult,
    PanelSnapshot,
    SpacerInsert,
  } from '../state/types';

  export interface ArrangePreviewState {
    arrangeResult: ArrangeResult;
    /** Spacers attached to this arrange — used only to identify
     *  which volumes need the hatch overlay. */
    spacers: SpacerInsert[];
    /** Currently selected slice indexes (shared with SliceList). */
    selection: ReadonlySet<number>;
  }

  export interface ArrangePreviewSelectionEvent {
    selection: Set<number>;
    anchor: number | null;
  }

  /** Emitted when a slice is dropped at a new visible position.
   *  `fromPos` / `toPos` are POSITIONS in the currently-rendered
   *  slice order, matching the pipeline's reorderSequence semantics
   *  (not upstream slice indexes). */
  export interface ArrangePreviewReorderEvent {
    fromPos: number;
    toPos: number;
  }

  const SLICE_ID_RE = /-slice-(\d+)$/;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { SPECIES_COLOURS } from '../render/summary';
  type Volume = PanelSnapshot['volumes'][number];

  interface Props {
    /** Prop name `value` rather than `state` — `$state` rune collides
     *  with that identifier inside a Svelte 5 component script (same
     *  workaround as SliceList / StripReorder). */
    value: ArrangePreviewState;
    anchor: number | null;
    onSelectionChange: (ev: ArrangePreviewSelectionEvent) => void;
    /** Reorder commit — fires on drop if the drop slot differs from
     *  the pick slot. Parent appends a reorder PlaceEdit. */
    onReorder: (ev: ArrangePreviewReorderEvent) => void;
  }

  let { value, anchor, onSelectionChange, onReorder }: Props = $props();

  /** Derived — slice id from contributing ids. Pipeline-driven; no recompute. */
  function sliceIdxFor(vol: Volume): number | null {
    const sid = vol.contributingSliceIds[0];
    if (!sid) return null;
    const m = sid.match(SLICE_ID_RE);
    return m ? Number(m[1]) : null;
  }

  const spacerIds = $derived(new Set(value.spacers.map((s) => s.id)));
  function isSpacerVolume(vol: Volume): boolean {
    return vol.contributingStripIds.some((id) => spacerIds.has(id));
  }

  /** Bucket volumes by slice idx; spacer + un-attributed volumes go
   *  into a separate list that renders but is not interactive. */
  interface VolumesBySlice {
    groups: Map<number, Volume[]>;
    nonSlice: Volume[];
  }

  const bucketed = $derived.by<VolumesBySlice>(() => {
    const groups = new Map<number, Volume[]>();
    const nonSlice: Volume[] = [];
    for (const vol of value.arrangeResult.panel.volumes) {
      const idx = sliceIdxFor(vol);
      if (idx === null) {
        nonSlice.push(vol);
        continue;
      }
      const arr = groups.get(idx);
      if (arr) arr.push(vol);
      else groups.set(idx, [vol]);
    }
    return { groups, nonSlice };
  });

  /** viewBox direct from the panel snapshot's bbox — no recentring.
   *  Axis swap: world Z → SVG X (length horizontal), world X → SVG Y
   *  (width vertical). Matches `summarize()` and the Compose preview. */
  const viewBox = $derived.by(() => {
    const bb = value.arrangeResult.panel.bbox;
    const x = bb.min[2];
    const y = bb.min[0];
    const w = bb.max[2] - bb.min[2];
    const h = bb.max[0] - bb.min[0];
    return { x, y, w, h };
  });

  function polygonPoints(vol: Volume): string {
    // Axis swap: (world x, z) → SVG (z, x).
    return vol.topFace.map((p) => `${fmt(p.z)},${fmt(p.x)}`).join(' ');
  }

  function fmt(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
  }

  function onGroupClick(sliceIdx: number, ev: MouseEvent): void {
    ev.stopPropagation();
    const current = new Set(value.selection);
    if (ev.shiftKey && anchor !== null) {
      const lo = Math.min(anchor, sliceIdx);
      const hi = Math.max(anchor, sliceIdx);
      const next = new Set(current);
      for (let i = lo; i <= hi; i++) next.add(i);
      onSelectionChange({ selection: next, anchor });
    } else if (ev.metaKey || ev.ctrlKey) {
      const next = new Set(current);
      if (next.has(sliceIdx)) next.delete(sliceIdx);
      else next.add(sliceIdx);
      onSelectionChange({ selection: next, anchor: sliceIdx });
    } else {
      onSelectionChange({ selection: new Set([sliceIdx]), anchor: sliceIdx });
    }
  }

  function onBackgroundClick(): void {
    // Clicking outside any slice clears selection. Leaves anchor
    // at its last position so shift-click still makes sense.
    if (value.selection.size === 0) return;
    onSelectionChange({ selection: new Set(), anchor });
  }

  /** Per-slice length-axis extent in the CURRENT arrangement, sorted
   *  by visible position (centerZ). The visible position = index in
   *  this array, which is what the reorder op's `fromPos`/`toPos`
   *  refer to (matching the pipeline's `reorderSequence` semantics).
   *  Upstream `sliceIdx` travels with each entry so the UI can still
   *  bucket volumes for rendering. */
  interface SliceSlot {
    sliceIdx: number;
    minZ: number;
    maxZ: number;
    centerZ: number;
  }
  const slots = $derived.by<SliceSlot[]>(() => {
    const out: SliceSlot[] = [];
    for (const [sliceIdx, vols] of bucketed.groups) {
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const v of vols) {
        if (v.bbox.min[2] < minZ) minZ = v.bbox.min[2];
        if (v.bbox.max[2] > maxZ) maxZ = v.bbox.max[2];
      }
      out.push({ sliceIdx, minZ, maxZ, centerZ: (minZ + maxZ) / 2 });
    }
    out.sort((a, b) => a.centerZ - b.centerZ);
    return out;
  });

  /** Slice-idx → visible position map for quick lookup in the
   *  click/drag handlers. */
  const visiblePosBySliceIdx = $derived.by(() => {
    const m = new Map<number, number>();
    slots.forEach((s, i) => m.set(s.sliceIdx, i));
    return m;
  });

  // ---- Drag-to-reorder ---------------------------------------------

  const DRAG_THRESHOLD_MM = 8; // world units — below this, treat as click
  /** Perpendicular offset applied to the dragged slice so it reads as
   *  "lifted off the stack." Same visual language as StripReorder. */
  const DRAG_LIFT_MM = 6;
  /** Drop-settle animation duration. Must match the CSS transition
   *  on .slice-group.dragging.settling so the reorder commit lands
   *  exactly when the transform animation completes. */
  const SETTLE_MS = 140;

  interface Dragging {
    sliceIdx: number;      // upstream idx of the slice being dragged
    fromPos: number;       // visible position at pick time
    startSvgX: number;     // pointer X in SVG user space at pick time
    dxMm: number;          // current SVG-X delta (= world Z delta)
    currentPos: number;    // drop-target visible position
    committed: boolean;    // true once dx passes threshold; suppresses click
    /** Settling phase: pointer is up, transform is animating to the
     *  target slot's offset. While settling, the dragged slice lands
     *  (lift → 0) and slides to its target; neighbours keep their
     *  rehearsal transforms so nothing snaps underfoot. */
    settling: boolean;
  }
  let dragging = $state<Dragging | null>(null);
  let svgEl: SVGSVGElement | undefined = $state();
  /** Suppress the click that the browser fires after pointerup on a
   *  committed drag. Flip to true in pointerup, reset to false by the
   *  click handler (or a microtask if no click fires). */
  let suppressNextClick = false;

  /** Convert a viewport pointer X to SVG user-space X using the live
   *  CTM. Accounts for preserveAspectRatio letterboxing — `meet` can
   *  offset/scale the content differently on each axis, so naive
   *  `viewBox.width / clientRect.width` is wrong. */
  function clientToSvgX(clientX: number, clientY: number): number {
    if (!svgEl) return 0;
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return 0;
    return pt.matrixTransform(ctm.inverse()).x;
  }

  function posAtCenterZ(zCenter: number): number {
    if (slots.length === 0) return 0;
    if (zCenter <= slots[0].centerZ) return 0;
    for (let i = 0; i < slots.length; i++) {
      if (zCenter < slots[i].centerZ) return i;
    }
    return slots.length - 1;
  }

  function onSlicePointerDown(ev: PointerEvent, sliceIdx: number): void {
    if (slots.length <= 1) return;
    // Only primary (left) button starts a drag.
    if (ev.button !== 0) return;
    const fromPos = visiblePosBySliceIdx.get(sliceIdx);
    if (fromPos === undefined) return;
    const target = ev.currentTarget as SVGGElement;
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      /* ok on some browsers for SVG <g> */
    }
    dragging = {
      sliceIdx,
      fromPos,
      startSvgX: clientToSvgX(ev.clientX, ev.clientY),
      dxMm: 0,
      currentPos: fromPos,
      committed: false,
      settling: false,
    };
  }

  function handlePointerMove(ev: PointerEvent): void {
    if (!dragging) return;
    const svgX = clientToSvgX(ev.clientX, ev.clientY);
    const dxMm = svgX - dragging.startSvgX;
    const centerZ = slots[dragging.fromPos].centerZ + dxMm;
    const currentPos = posAtCenterZ(centerZ);
    const committed = dragging.committed || Math.abs(dxMm) > DRAG_THRESHOLD_MM;
    dragging = { ...dragging, dxMm, currentPos, committed };
  }

  function handlePointerUp(_ev: PointerEvent): void {
    if (!dragging) return;
    if (dragging.settling) return; // already animating
    const { fromPos, currentPos, committed } = dragging;
    if (!committed) {
      dragging = null;
      return;
    }
    // Release the synthetic click that follows pointerup.
    suppressNextClick = true;
    queueMicrotask(() => {
      suppressNextClick = false;
    });
    if (fromPos === currentPos) {
      dragging = null;
      return;
    }
    // Settle phase: snap the dragged slice's transform to the target
    // slot's offset (and drop the lift back to 0). CSS transitions
    // ease the transform over SETTLE_MS. Commit the reorder edit at
    // the end of the transition so the new snapshot-is-truth render
    // replaces the animated transform with zero-offset polygons
    // already at the correct position.
    const targetDxMm = slots[currentPos].centerZ - slots[fromPos].centerZ;
    dragging = {
      ...dragging,
      dxMm: targetDxMm,
      settling: true,
    };
    setTimeout(() => {
      const d = dragging;
      dragging = null;
      if (d) onReorder({ fromPos: d.fromPos, toPos: d.currentPos });
    }, SETTLE_MS);
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

  /** Build an array mapping "current visible position" → "rehearsal
   *  visible position" for a drag from `fromPos` to `currentPos`.
   *  Non-dragged slices shift one slot toward the gap the dragged
   *  slice would leave. */
  function rehearsalOrder(fromPos: number, currentPos: number): number[] {
    const n = slots.length;
    const ids = Array.from({ length: n }, (_, i) => i);
    const [picked] = ids.splice(fromPos, 1);
    ids.splice(currentPos, 0, picked);
    return ids;
  }

  /** CSS transform for a slice during drag. Emitted via `style:`
   *   so the property animates on change — the SVG `transform`
   *   attribute does NOT reliably transition. Units in px because
   *   CSS transform on SVG elements treats lengths as user units
   *   when the element is inside an SVG viewBox.
   *   - dragged slice: tracks the pointer (dxMm along SVG X)
   *   - non-dragged: animates to its rehearsal slot so the user sees
   *     the would-be final arrangement while the mouse is held. */
  function sliceTransform(sliceIdx: number): string {
    if (!dragging) return '';
    if (dragging.sliceIdx === sliceIdx) {
      // Lift applied during active drag; lands (lift → 0) during
      // the settle animation so the slice "sets down" on the stack.
      const lift = dragging.settling ? 0 : -DRAG_LIFT_MM;
      return `translate(${fmt(dragging.dxMm)}px, ${lift}px)`;
    }
    const currentPos = visiblePosBySliceIdx.get(sliceIdx);
    if (currentPos === undefined) return '';
    const reh = rehearsalOrder(dragging.fromPos, dragging.currentPos);
    const rehearsalPos = reh.indexOf(currentPos);
    if (rehearsalPos === -1 || rehearsalPos === currentPos) return '';
    const dx = slots[rehearsalPos].centerZ - slots[currentPos].centerZ;
    return `translate(${fmt(dx)}px, 0px)`;
  }

  /** Swallow clicks that the pointer-up handler already treated as a
   *  drop. Svelte still fires `click` after pointerdown+move+up, so
   *  without this the drag would also toggle selection. */
  function onGroupClickWrapped(sliceIdx: number, ev: MouseEvent): void {
    if (suppressNextClick) {
      ev.stopPropagation();
      return;
    }
    onGroupClick(sliceIdx, ev);
  }

  /** Sorted slice idxs so children render in a stable, predictable order
   *  (helpful for devtools inspection + snapshot testing). */
  const sortedSliceIdxs = $derived.by(() =>
    [...bucketed.groups.keys()].sort((a, b) => a - b),
  );

</script>

<svg
  bind:this={svgEl}
  class="arrange-preview"
  viewBox="{viewBox.x} {viewBox.y} {viewBox.w} {viewBox.h}"
  preserveAspectRatio="xMidYMid meet"
  xmlns="http://www.w3.org/2000/svg"
  onclick={onBackgroundClick}
  role="presentation"
>
  <defs>
    <pattern
      id="arrange-preview-spacer-hatch"
      patternUnits="userSpaceOnUse"
      width="6"
      height="6"
      patternTransform="rotate(45)"
    >
      <line
        x1="0"
        y1="0"
        x2="0"
        y2="6"
        stroke="#00000055"
        stroke-width="1.2"
        vector-effect="non-scaling-stroke"
      />
    </pattern>
  </defs>

  <!-- Non-slice volumes (spacers + un-attributed). Rendered first so
       slice groups paint on top; non-interactive. -->
  {#each bucketed.nonSlice as vol, i (i)}
    {#if vol.topFace.length >= 3}
      <polygon
        points={polygonPoints(vol)}
        fill={SPECIES_COLOURS[vol.species]}
        stroke="#00000022"
        stroke-width="0.5"
        vector-effect="non-scaling-stroke"
        data-species={vol.species}
        pointer-events="none"
      />
    {/if}
  {/each}

  <!-- Slice groups: each is a hit-zone for selection + drag. -->
  {#each sortedSliceIdxs as sliceIdx (sliceIdx)}
    {@const vols = bucketed.groups.get(sliceIdx)!}
    {@const selected = value.selection.has(sliceIdx)}
    {@const isDragging = dragging?.sliceIdx === sliceIdx}
    {@const isSettling = isDragging && dragging?.settling === true}
    <g
      class="slice-group"
      class:selected
      class:dragging={isDragging}
      class:settling={isSettling}
      data-slice-idx={sliceIdx}
      onclick={(e) => onGroupClickWrapped(sliceIdx, e)}
      onpointerdown={(e) => onSlicePointerDown(e, sliceIdx)}
      style:transform={sliceTransform(sliceIdx)}
      role="button"
      aria-label={`Slice ${sliceIdx}`}
      tabindex="-1"
    >
      {#each vols as vol, vi (vi)}
        {#if vol.topFace.length >= 3}
          <polygon
            points={polygonPoints(vol)}
            fill={SPECIES_COLOURS[vol.species]}
            data-species={vol.species}
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/each}
    </g>
  {/each}

  <!-- Spacer hatch overlay. Drawn last so it sits on top of its
       underlying fill regardless of paint order. Non-interactive. -->
  {#each value.arrangeResult.panel.volumes as vol, vi ('hatch-' + vi)}
    {#if isSpacerVolume(vol) && vol.topFace.length >= 3}
      <polygon
        points={polygonPoints(vol)}
        fill="url(#arrange-preview-spacer-hatch)"
        stroke="none"
        pointer-events="none"
      />
    {/if}
  {/each}

  <!-- Selection affordance: dim everything, then un-dim selected
       slices. Driven entirely via CSS on the .slice-group element
       — no extra SVG elements. -->
</svg>

<style>
  .arrange-preview {
    display: block;
    width: 100%;
    height: 100%;
    /* Fill stays on the polygons. The slice group controls the stroke
       so select-halos are one attribute toggle. */
    /* touch-action: none so a finger drag on the preview reorders
       slices instead of scrolling the page. */
    touch-action: none;
    user-select: none;
  }
  /* Slice-group base:
     - Default opacity 0.35 = the dim-on-unselected affordance.
     - Selected / hover bumps opacity back up.
     - Transform animates so rehearsal + settle slides are fluid;
       dragged slice below disables the transform transition so the
       live drag pins 1:1 to the pointer. */
  .slice-group {
    cursor: pointer;
    outline: none;
    opacity: 0.35;
    transition:
      transform 140ms ease,
      opacity 80ms ease-out;
    /* Ensures CSS transform on <g> behaves in user space across
       browsers, so our translate(…px, …px) reads as user units
       just like SVG attribute transforms do. */
    transform-box: view-box;
    transform-origin: 0 0;
  }
  .slice-group:focus,
  .slice-group:focus-visible {
    outline: none;
  }
  .slice-group.selected {
    opacity: 1;
  }
  .slice-group:hover {
    opacity: 0.8;
  }
  .slice-group.selected:hover {
    opacity: 1;
  }
  .slice-group polygon {
    stroke: #00000022;
    stroke-width: 0.5;
    transition:
      stroke-width 80ms ease-out,
      stroke 80ms ease-out,
      opacity 80ms ease-out;
  }
  .slice-group:hover polygon {
    stroke: #00000088;
    stroke-width: 1.2;
  }
  .slice-group.dragging {
    /* Lift the dragged slice above neighbours + keep it fully bright
       so it reads as "attached to the cursor." Transition disabled
       so the transform tracks the pointer exactly. */
    opacity: 1;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.2));
    cursor: grabbing;
    transition: none;
  }
  /* Settle phase: re-enable the transform transition so the drop
     glides into the target slot. Duration matches SETTLE_MS. */
  .slice-group.dragging.settling {
    transition: transform 140ms ease;
    cursor: default;
  }
</style>
