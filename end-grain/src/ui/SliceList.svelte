<script lang="ts" module>
  /**
   * SliceList — one row per cut slice, rendered in stack order, with
   * a grain-oriented mini-thumbnail that reifies the current edit
   * state. Clicking a row selects that slice; selection mirrors the
   * interactive preview (built in step 4). Spacer inserts are shown
   * inline as read-only separator chips between their surrounding
   * slices — they're not editable here, but still visible so the
   * assembled order makes sense at a glance.
   *
   * This is the primary "authoring space" for the Arrange card in the
   * revamp: the thumbnail shows what the slice looks like post-edit,
   * the shift chip shows any offset, the edited-dot flags that a
   * rotate or shift is applied. No form inputs.
   *
   * Actions (flip, rotate, shift, clear) don't live here — they go on
   * the toolbar in step 7/8. This component owns selection only.
   */

  import type { PanelSnapshot, PlaceEdit, Species, SpacerInsert } from '../state/types';

  export interface SliceListState {
    /** Arrange feature id — used purely for keying. */
    arrangeId: string;
    /** Cut output. One PanelSnapshot per slice in stack order. */
    slices: PanelSnapshot[];
    /** PlaceEdits attached to the Arrange. */
    edits: PlaceEdit[];
    /** Spacers attached to the Arrange (read-only in this UI). */
    spacers: SpacerInsert[];
    /** Currently-selected slice indexes. */
    selection: ReadonlySet<number>;
  }

  export interface SliceListSelectionEvent {
    /** Full replacement of the selection set. */
    selection: Set<number>;
    /** Anchor for future shift-click. */
    anchor: number | null;
  }
</script>

<script lang="ts">
  import { rotationForSlice, shiftForSlice } from '../state/edits';
  import { SPECIES_COLOURS } from '../render/summary';

  interface Props {
    state: SliceListState;
    /** Fires on any selection change. Parent owns the state. */
    onSelectionChange: (ev: SliceListSelectionEvent) => void;
    /** Anchor from parent — the last-clicked slice, used for shift-range. */
    anchor: number | null;
  }

  let { state, anchor, onSelectionChange }: Props = $props();

  /**
   * Decompose a slice into proportional species bands along the
   * slice's stack axis. A slice is a cross-section through the
   * composed panel, so its volumes sit side-by-side along one axis
   * (x or z — whichever varies most between volume bboxes). We use
   * that axis to build a stack of color-proportional bands for the
   * mini-thumbnail.
   *
   * Returns `[{ species, fraction }, ...]` with fractions summing to
   * ~1. Single-volume slices collapse to one full band.
   */
  interface SpeciesBand {
    species: Species;
    fraction: number;
  }

  function sliceSpeciesBands(slice: PanelSnapshot): SpeciesBand[] {
    if (slice.volumes.length === 0) return [];
    if (slice.volumes.length === 1) {
      return [{ species: slice.volumes[0].species, fraction: 1 }];
    }
    // Pick the axis with the largest between-volume span. For a
    // standard compose→cut output this is the strip-stacking axis
    // (x for strips stacked along x, etc.).
    const axisExtents: [number, number] = [
      slice.bbox.max[0] - slice.bbox.min[0],
      slice.bbox.max[2] - slice.bbox.min[2],
    ];
    const axis: 0 | 2 = axisExtents[1] > axisExtents[0] ? 2 : 0;
    const total = axisExtents[axis === 0 ? 0 : 1];
    if (total <= 0) return [{ species: slice.volumes[0].species, fraction: 1 }];

    // Sort by axis min so bands render in panel order.
    const sorted = [...slice.volumes].sort(
      (a, b) => a.bbox.min[axis] - b.bbox.min[axis],
    );
    return sorted.map((v) => ({
      species: v.species,
      fraction: Math.max(0, (v.bbox.max[axis] - v.bbox.min[axis]) / total),
    }));
  }

  function onRowClick(sliceIdx: number, ev: MouseEvent): void {
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

  // Spacer inserts keyed by afterSliceIdx for inline rendering.
  const spacersAfter = $derived.by<Map<number, SpacerInsert[]>>(() => {
    const m = new Map<number, SpacerInsert[]>();
    for (const s of state.spacers) {
      const arr = m.get(s.afterSliceIdx) ?? [];
      arr.push(s);
      m.set(s.afterSliceIdx, arr);
    }
    return m;
  });
</script>

<div class="slice-list" role="listbox" aria-label="Slices" tabindex="-1">
  {#each state.slices as slice, i (i)}
    {@const rot = rotationForSlice(state.edits, i)}
    {@const shift = shiftForSlice(state.edits, i)}
    {@const bands = sliceSpeciesBands(slice)}
    {@const edited = rot !== 0 || shift !== 0}
    {@const selected = state.selection.has(i)}

    <button
      type="button"
      class="row"
      class:selected
      class:edited
      role="option"
      aria-selected={selected}
      onclick={(e) => onRowClick(i, e)}
    >
      <span class="idx">{i}</span>

      <!-- Slice thumbnail: proportional species bands, rotated with
           the slice's current orientation. The short dark edge at
           "top" disambiguates 0° vs 180° (and 90° vs 270°) — it
           rotates with the group, so a flipped slice's dark edge
           is at the bottom. -->
      <span class="thumb" aria-hidden="true">
        <svg viewBox="0 0 22 22" width="22" height="22">
          <g transform={`rotate(${rot} 11 11)`}>
            {#if bands.length > 0}
              {@const W = 16}
              {@const H = 5}
              {@const x0 = (22 - W) / 2}
              {@const y0 = (22 - H) / 2}
              {#each bands as b, bi (bi)}
                {@const startFrac = bands.slice(0, bi).reduce((a, c) => a + c.fraction, 0)}
                <rect
                  x={x0 + startFrac * W}
                  y={y0}
                  width={b.fraction * W}
                  height={H}
                  fill={SPECIES_COLOURS[b.species]}
                />
              {/each}
              <!-- outline + orientation cap -->
              <rect
                x={x0}
                y={y0}
                width={W}
                height={H}
                fill="none"
                stroke="#00000044"
                stroke-width="0.5"
              />
              <!-- dark edge at the slice's "left" end — rotates with g -->
              <rect x={x0} y={y0} width="1.5" height={H} fill="#00000066" />
            {:else}
              <rect x="3" y="8.5" width="16" height="5" fill="#ccc" />
            {/if}
          </g>
        </svg>
      </span>

      {#if shift !== 0}
        <span class="chip shift" title="shift {shift} mm">
          {shift > 0 ? '+' : ''}{shift}<span class="unit">mm</span>
        </span>
      {:else}
        <span class="chip-placeholder"></span>
      {/if}

      <span class="edited-dot" class:visible={edited} aria-hidden="true"></span>
    </button>

    {#if spacersAfter.has(i)}
      {#each spacersAfter.get(i)! as s (s.id)}
        <div class="spacer-row" title="Spacer (read-only · edit in a future compose)">
          <span class="s-idx">↳</span>
          <span
            class="s-swatch"
            style:background={SPECIES_COLOURS[s.species]}
          ></span>
          <span class="s-label">{s.width} mm spacer</span>
        </div>
      {/each}
    {/if}
  {/each}

  {#if state.slices.length === 0}
    <div class="empty">No slices — run Cut first.</div>
  {/if}
</div>

<style>
  .slice-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 0.72rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    outline: none;
  }

  .row {
    display: grid;
    grid-template-columns: 22px 26px 48px 8px;
    gap: 0.4rem;
    align-items: center;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
    user-select: none;
  }
  .row:hover {
    background: #f6f5f1;
  }
  .row.selected {
    background: #fff3dc;
    border-color: #c89a3c;
  }
  .row.selected:hover {
    background: #fdeac2;
  }

  .idx {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    color: #888;
    text-align: right;
  }
  .row.selected .idx {
    color: #5b4a2e;
  }

  .thumb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
  }

  .chip {
    font-size: 0.62rem;
    font-family: ui-monospace, monospace;
    color: #5b4a2e;
    background: #fff3dc;
    border: 1px solid #eadbad;
    border-radius: 3px;
    padding: 0 4px;
    justify-self: start;
    white-space: nowrap;
  }
  .chip .unit {
    color: #8a6a2c;
    margin-left: 1px;
  }
  .chip-placeholder {
    /* keep grid slot stable when no shift chip present */
    width: 0;
    height: 0;
  }

  .edited-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: transparent;
    justify-self: end;
  }
  .edited-dot.visible {
    background: #c89a3c;
  }

  .spacer-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 1px 6px 1px 28px;
    color: #999;
    font-size: 0.64rem;
    font-family: ui-monospace, monospace;
    background: #f6f5f1;
    border-radius: 3px;
    margin: 1px 0;
    cursor: default;
  }
  .s-idx {
    color: #bbb;
  }
  .s-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 1px;
    border: 1px solid #00000033;
  }
  .s-label {
    color: #888;
  }

  .empty {
    padding: 0.5rem 0.2rem;
    color: #888;
    font-size: 0.68rem;
  }
</style>
