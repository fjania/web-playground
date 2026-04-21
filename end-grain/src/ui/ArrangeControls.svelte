<script lang="ts" module>
  /**
   * ArrangeControls — the controls-panel half of the workbench's
   * Arrange stage, extracted for reuse in `ArrangeApp.svelte` (the
   * focused Arrange harness) so the harness is direct-manipulable
   * (drag/flip/rotate) instead of URL-only.
   *
   * Composition:
   *   - Selection toolbar (All / None / Invert / Every other / Odd)
   *   - Action toolbar (Flip / Rotate 90° / Clear edits)
   *   - `SliceList` (per-slice thumbnail + shift chip editor)
   *
   * Host owns: timeline mutation, selection-by-arrangeId map, id
   * counter. This component is pure props-in / events-out — it never
   * writes to localStorage or touches a global store. Actions dispatch
   * via `src/state/arrangeActions.ts`, shared with the workbench.
   *
   * Keyboard handling: this component does NOT attach its own listener;
   * the host binds a listener to whichever element should capture keys
   * (a stage <article> in the workbench; the operation tile's <article>
   * in the harness) and calls `handleArrangeKey` from that handler.
   */

  import type { PanelSnapshot, PlaceEdit } from '../state/types';

  export interface ArrangeControlsState {
    /** Arrange feature id — used purely for keying SliceList. */
    arrangeId: string;
    /** Upstream Cut's slice snapshots (one per slice in stack order). */
    upstreamSlices: PanelSnapshot[];
    /** PlaceEdits currently targeting this Arrange. */
    edits: PlaceEdit[];
    /** Selection set + last-click anchor. */
    selection: { set: Set<number>; anchor: number | null };
  }

  export interface ArrangeControlsSelectionEvent {
    set: Set<number>;
    anchor: number | null;
  }
</script>

<script lang="ts">
  import SliceList from './SliceList.svelte';
  import {
    selectAll,
    selectNone,
    invertSelection,
    selectEvery,
    flipSelection,
    rotate90Selection,
    clearSelectionEdits,
    setShiftForSlice,
    type ArrangeActionContext,
  } from '../state/arrangeActions';

  interface Props {
    value: ArrangeControlsState;
    /** Emits when the user changes the selection (buttons, clicks). */
    onSelectionChange: (ev: ArrangeControlsSelectionEvent) => void;
    /** Emits when the user changes the PlaceEdits (toolbar actions,
     *  shift-chip commits). Host replaces its edit list for this Arrange. */
    onEditsChange: (next: PlaceEdit[]) => void;
    /** Host mints a new PlaceEdit id when needed. */
    allocateEditId: () => string;
  }

  let { value, onSelectionChange, onEditsChange, allocateEditId }: Props = $props();

  const sliceCount = $derived(value.upstreamSlices.length);
  const selectionEmpty = $derived(value.selection.set.size === 0);

  function ctx(): ArrangeActionContext {
    return {
      arrangeId: value.arrangeId,
      sliceCount,
      selection: value.selection,
      edits: value.edits,
      setSelection: (set, anchor) => onSelectionChange({ set, anchor }),
      setEdits: (next) => onEditsChange(next),
      allocateEditId,
    };
  }
</script>

<div class="arrange-ctrl-stack">
  <div class="select-bar" aria-label="Select">
    <span class="bar-label">Select</span>
    <button type="button" title="All (A)" onclick={() => selectAll(ctx())}>All</button>
    <button type="button" title="None (Esc)" onclick={() => selectNone(ctx())}>None</button>
    <button type="button" title="Invert (I)" onclick={() => invertSelection(ctx())}>Invert</button>
    <button type="button" title="Every other (E)" onclick={() => selectEvery(ctx(), 0)}>Every other</button>
    <button type="button" title="Odd indices (O)" onclick={() => selectEvery(ctx(), 1)}>Odd</button>
  </div>
  <div class="action-bar" aria-label="Edit">
    <span class="bar-label">Edit</span>
    <button
      type="button"
      title="Flip (F)"
      disabled={selectionEmpty}
      onclick={() => flipSelection(ctx())}
    >Flip</button>
    <button
      type="button"
      title="Rotate 90° (R)"
      disabled={selectionEmpty}
      onclick={() => rotate90Selection(ctx())}
    >Rotate 90°</button>
    <button
      type="button"
      title="Clear edits (Delete)"
      disabled={selectionEmpty}
      onclick={() => clearSelectionEdits(ctx())}
    >Clear edits</button>
  </div>
  <SliceList
    value={{
      arrangeId: value.arrangeId,
      slices: value.upstreamSlices,
      edits: value.edits,
      selection: value.selection.set,
    }}
    anchor={value.selection.anchor}
    onSelectionChange={(ev) => onSelectionChange({ set: ev.selection, anchor: ev.anchor })}
    onShiftCommit={(sliceIdx, delta) => setShiftForSlice(ctx(), sliceIdx, delta)}
  />
</div>

<style>
  .arrange-ctrl-stack {
    display: flex;
    flex-direction: column;
    padding: 0.4rem 0.45rem 0.3rem;
    gap: 0.35rem;
  }
  .select-bar,
  .action-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 2px 1px 4px;
  }
  .select-bar {
    border-bottom: 1px solid #eee;
  }
  .action-bar {
    border-bottom: 1px solid #eee;
  }
  .select-bar .bar-label,
  .action-bar .bar-label {
    font-size: 0.62rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 2px;
  }
  .select-bar button,
  .action-bar button {
    font-size: 0.65rem;
    padding: 2px 6px;
    border: 1px solid #d6d3cd;
    background: #fff;
    color: #555;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.3;
    white-space: nowrap;
  }
  .select-bar button:hover,
  .action-bar button:not(:disabled):hover {
    border-color: #2563eb;
    color: #1e40af;
    background: #eff6ff;
  }
  .select-bar button:active,
  .action-bar button:not(:disabled):active {
    background: #dbeafe;
  }
  .action-bar button:disabled {
    color: #bbb;
    background: #fafaf7;
    border-color: #e8e6df;
    cursor: not-allowed;
  }
  .select-bar button:focus,
  .action-bar button:focus {
    outline: none;
  }
  .select-bar button:focus-visible,
  .action-bar button:not(:disabled):focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
</style>
