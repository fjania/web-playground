<script lang="ts" module>
  /**
   * SliceList — one row per cut slice, rendered in stack order, with
   * a grain-oriented mini-thumbnail that reifies the current edit
   * state. Clicking a row selects that slice; selection mirrors the
   * interactive preview (built in step 4).
   *
   * Spacers are deliberately absent from this UI — they're still in
   * the timeline (the pipeline still applies them) and still visible
   * in the 2D/3D previews, but the Arrange card treats the panel as
   * a pure slice stack. Spacer editing moves to a future assembly op.
   *
   * This is the primary "authoring space" for the Arrange card in the
   * revamp: the thumbnail shows what the slice looks like post-edit,
   * and a chip group lists every edit applied to the slice — `flip`,
   * `90°`, `270°`, and/or `+Nmm`. No form inputs.
   *
   * Actions (flip, rotate, shift, clear) don't live here — they go on
   * the toolbar in step 7/8. This component owns selection only.
   */

  import type { PanelSnapshot, PlaceEdit, Species } from '../state/types';

  export interface SliceListState {
    /** Arrange feature id — used purely for keying. */
    arrangeId: string;
    /** Cut output. One PanelSnapshot per slice in stack order. */
    slices: PanelSnapshot[];
    /** PlaceEdits attached to the Arrange. */
    edits: PlaceEdit[];
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
    /** Prop name `value` rather than `state` — `$state` rune collides
     *  with that identifier inside a Svelte 5 component script
     *  (same workaround as StripReorder.svelte). */
    value: SliceListState;
    /** Fires on any selection change. Parent owns the state. */
    onSelectionChange: (ev: SliceListSelectionEvent) => void;
    /** Anchor from parent — the last-clicked slice, used for shift-range. */
    anchor: number | null;
    /** Commit a new shift value for a single slice (set via the
     *  inline numeric chip editor). Parent writes through to its
     *  edit list via the canonical `setShift` helper. */
    onShiftCommit: (sliceIdx: number, delta: number) => void;
  }

  let { value, anchor, onSelectionChange, onShiftCommit }: Props = $props();

  /** Row currently in numeric-chip edit mode. Only one at a time. */
  let editingIdx = $state<number | null>(null);
  let editingDraft = $state('');
  let editingInputEl: HTMLInputElement | null = $state(null);

  function startChipEdit(sliceIdx: number, currentDelta: number, ev: Event): void {
    ev.stopPropagation();
    editingIdx = sliceIdx;
    editingDraft = String(currentDelta);
    // focus + select on the next tick so the input is rendered
    queueMicrotask(() => {
      editingInputEl?.focus();
      editingInputEl?.select();
    });
  }

  function commitChipEdit(sliceIdx: number): void {
    // Read directly from the DOM — bind:value can lag when commit
    // is triggered synchronously from Enter in programmatic tests.
    const raw = editingInputEl?.value ?? editingDraft;
    const v = Number(raw);
    if (Number.isFinite(v)) onShiftCommit(sliceIdx, Math.round(v));
    editingIdx = null;
    editingDraft = '';
  }

  function cancelChipEdit(): void {
    editingIdx = null;
    editingDraft = '';
  }

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


</script>

<div class="slice-list" role="listbox" aria-label="Slices" tabindex="-1">
  {#each value.slices as slice, i (i)}
    {@const rot = rotationForSlice(value.edits, i)}
    {@const shift = shiftForSlice(value.edits, i)}
    {@const bands = sliceSpeciesBands(slice)}
    {@const edited = rot !== 0 || shift !== 0}
    {@const selected = value.selection.has(i)}

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

      <span class="edits">
        {#if rot === 180}
          <span class="chip rot" title="flipped (rotated 180°)">flip</span>
        {:else if rot === 90 || rot === 270}
          <span class="chip rot" title="rotated {rot}°">{rot}°</span>
        {/if}
        {#if editingIdx === i}
          <span class="chip shift editing" onclick={(e) => e.stopPropagation()} role="presentation">
            <input
              bind:this={editingInputEl}
              class="chip-input"
              type="number"
              step="1"
              bind:value={editingDraft}
              onkeydown={(ev) => {
                if (ev.key === 'Enter') { ev.stopPropagation(); commitChipEdit(i); }
                else if (ev.key === 'Escape') { ev.stopPropagation(); cancelChipEdit(); }
              }}
              onblur={() => commitChipEdit(i)}
            />
            <span class="unit">mm</span>
          </span>
        {:else if shift !== 0}
          <span
            class="chip shift editable"
            title="click to edit · arrow keys to nudge"
            role="button"
            tabindex="-1"
            onclick={(e) => startChipEdit(i, shift, e)}
          >
            {shift > 0 ? '+' : ''}{shift}<span class="unit">mm</span>
          </span>
        {/if}
      </span>
    </button>

  {/each}

  {#if value.slices.length === 0}
    <div class="empty">No slices — run Cut first.</div>
  {/if}
</div>

<style>
  .slice-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 0.72rem;
    outline: none;
  }

  .row {
    display: grid;
    grid-template-columns: 22px 26px 1fr;
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
  /* Selection = blue, matching the halo in the preview. Chips stay
     amber since they represent edits (a separate visual vocabulary). */
  .row.selected {
    background: #dbeafe;
    border-color: #2563eb;
  }
  .row.selected:hover {
    background: #bfdbfe;
  }
  /* Keyboard focus ring — offset outline reads as 'cursor is here'
     and stays distinct from the filled-background selection state,
     so focused-and-selected is visually separable from just-selected.
     Mouse focus suppressed. */
  .row:focus {
    outline: none;
  }
  .row:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }

  .idx {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    color: #888;
    text-align: right;
  }
  .row.selected .idx {
    color: #1e40af;
  }

  .thumb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
  }

  .edits {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .chip {
    font-size: 0.62rem;
    font-family: ui-monospace, monospace;
    color: #5b4a2e;
    background: #fff3dc;
    border: 1px solid #eadbad;
    border-radius: 3px;
    padding: 0 4px;
    white-space: nowrap;
    line-height: 1.35;
  }
  .chip.rot {
    /* same palette as shift — chips compose as a single edit group */
    letter-spacing: 0.02em;
  }
  .chip.editable {
    cursor: text;
  }
  .chip.editable:hover {
    background: #ffe9b8;
  }
  .chip.editing {
    padding: 0 3px;
    background: #fff;
    border-color: #c89a3c;
  }
  .chip-input {
    width: 44px;
    border: none;
    background: transparent;
    font: inherit;
    color: #5b4a2e;
    padding: 0;
    outline: none;
    -moz-appearance: textfield;
  }
  .chip-input::-webkit-inner-spin-button,
  .chip-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .chip .unit {
    color: #8a6a2c;
    margin-left: 1px;
  }

  .empty {
    padding: 0.5rem 0.2rem;
    color: #888;
    font-size: 0.68rem;
  }
</style>
