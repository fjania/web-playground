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
    /**
     * Feature id of the Cut this Arrange is paired with. Used to
     * bucket volumes by the correct generation of slice provenance —
     * a volume carries slice ids from every Cut in its history
     * (e.g. `cut-0-slice-2`, `cut-1-slice-0`), and we need to group
     * by THIS arrange's paired cut, not the first cut ever.
     *
     * When undefined (e.g. an orphan Arrange with no upstream Cut),
     * no volumes are grouped and the preview renders as a non-
     * interactive flat panel.
     */
    cutId: string | undefined;
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
</script>

<script lang="ts">
  import { SPECIES_COLOURS } from '../render/summary';
  type Volume = PanelSnapshot['volumes'][number];

  interface Props {
    /** Prop name `value` rather than `state` — `$state` rune collides
     *  with that identifier inside a Svelte 5 component script (same
     *  workaround as SliceList / StripReorder). */
    value: ArrangePreviewState;
    anchor: number | null;
    onSelectionChange: (ev: ArrangePreviewSelectionEvent) => void;
  }

  let { value, anchor, onSelectionChange }: Props = $props();

  /**
   * Return the slice index this volume belongs to according to
   * THIS arrange's paired cut (`value.cutId`), or null if the volume
   * has no provenance from that cut (e.g. a spacer, or a volume
   * descending only from an earlier-generation cut).
   *
   * Matches on the `${cutId}-slice-N` prefix rather than picking
   * `contributingSliceIds[0]`, because multi-generation cuts
   * accumulate slice ids from every cut in their history and the
   * earliest is always at index 0.
   */
  function sliceIdxFor(vol: Volume): number | null {
    const cutId = value.cutId;
    if (!cutId) return null;
    const prefix = `${cutId}-slice-`;
    for (const sid of vol.contributingSliceIds) {
      if (sid.startsWith(prefix)) {
        const n = Number(sid.slice(prefix.length));
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
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

  /** Sorted slice idxs so children render in a stable, predictable order
   *  (helpful for devtools inspection + snapshot testing). */
  const sortedSliceIdxs = $derived.by(() =>
    [...bucketed.groups.keys()].sort((a, b) => a - b),
  );

</script>

<svg
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

  <!-- Slice groups: each is a hit-zone for selection. -->
  {#each sortedSliceIdxs as sliceIdx (sliceIdx)}
    {@const vols = bucketed.groups.get(sliceIdx)!}
    {@const selected = value.selection.has(sliceIdx)}
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

</svg>

<style>
  .arrange-preview {
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
  }
  /* Slice-group base: opacity 0.35 dims unselected; selected / hover
     bump opacity back up. */
  .slice-group {
    cursor: pointer;
    outline: none;
    opacity: 0.35;
    transition: opacity 80ms ease-out;
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
</style>
