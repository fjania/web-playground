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

  const SLICE_ID_RE = /-slice-(\d+)$/;
</script>

<script lang="ts">
  import { SPECIES_COLOURS } from '../render/summary';
  type Volume = PanelSnapshot['volumes'][number];

  interface Props {
    state: ArrangePreviewState;
    anchor: number | null;
    onSelectionChange: (ev: ArrangePreviewSelectionEvent) => void;
  }

  let { state, anchor, onSelectionChange }: Props = $props();

  /** Derived — slice id from contributing ids. Pipeline-driven; no recompute. */
  function sliceIdxFor(vol: Volume): number | null {
    const sid = vol.contributingSliceIds[0];
    if (!sid) return null;
    const m = sid.match(SLICE_ID_RE);
    return m ? Number(m[1]) : null;
  }

  const spacerIds = $derived(new Set(state.spacers.map((s) => s.id)));
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
    for (const vol of state.arrangeResult.panel.volumes) {
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

  /** viewBox direct from the panel snapshot's bbox — no recentring. */
  const viewBox = $derived.by(() => {
    const bb = state.arrangeResult.panel.bbox;
    const x = bb.min[0];
    const z = bb.min[2];
    const w = bb.max[0] - bb.min[0];
    const h = bb.max[2] - bb.min[2];
    return { x, z, w, h };
  });

  function polygonPoints(vol: Volume): string {
    return vol.topFace.map((p) => `${fmt(p.x)},${fmt(p.z)}`).join(' ');
  }

  function fmt(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
  }

  function onGroupClick(sliceIdx: number, ev: MouseEvent): void {
    ev.stopPropagation();
    const current = new Set(state.selection);
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
    if (state.selection.size === 0) return;
    onSelectionChange({ selection: new Set(), anchor });
  }

  /** Sorted slice idxs so children render in a stable, predictable order
   *  (helpful for devtools inspection + snapshot testing). */
  const sortedSliceIdxs = $derived.by(() =>
    [...bucketed.groups.keys()].sort((a, b) => a - b),
  );
</script>

<svg
  class="arrange-preview"
  viewBox="{viewBox.x} {viewBox.z} {viewBox.w} {viewBox.h}"
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

  <!-- Slice groups: each is a hit-zone for selection. -->
  {#each sortedSliceIdxs as sliceIdx (sliceIdx)}
    {@const vols = bucketed.groups.get(sliceIdx)!}
    {@const selected = state.selection.has(sliceIdx)}
    <g
      class="slice-group"
      class:selected
      data-slice-idx={sliceIdx}
      onclick={(e) => onGroupClick(sliceIdx, e)}
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
  {#each state.arrangeResult.panel.volumes as vol, vi ('hatch-' + vi)}
    {#if isSpacerVolume(vol) && vol.topFace.length >= 3}
      <polygon
        points={polygonPoints(vol)}
        fill="url(#arrange-preview-spacer-hatch)"
        stroke="none"
        pointer-events="none"
      />
    {/if}
  {/each}
</svg>

<style>
  .arrange-preview {
    display: block;
    width: 100%;
    height: 100%;
    /* Fill stays on the polygons. The slice group controls the stroke
       so select-halos are one attribute toggle. */
  }

  .slice-group {
    cursor: pointer;
  }
  .slice-group polygon {
    stroke: #00000022;
    stroke-width: 0.5;
    transition: stroke-width 80ms ease-out, stroke 80ms ease-out;
  }
  .slice-group:hover polygon {
    stroke: #00000088;
    stroke-width: 1.2;
  }
  .slice-group.selected polygon {
    /* Blue outline for selection — stronger contrast against wood
       tones than the amber used elsewhere in the workbench. */
    stroke: #2563eb;
    stroke-width: 2.2;
  }
  .slice-group.selected:hover polygon {
    stroke: #1d4ed8;
  }
</style>
