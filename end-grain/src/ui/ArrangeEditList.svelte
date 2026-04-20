<script lang="ts" module>
  /**
   * ArrangeEditList — per-slice PlaceEdit form for one Arrange feature.
   *
   * Spacer editing was removed as of the arrange-revamp branch: spacers
   * will migrate to a future compose-style assembly op. Existing
   * SpacerInsert data in the timeline is still passed through the
   * change payload unchanged so designs with spacers don't lose them
   * when edits are touched here.
   *
   * onChange fires with a fresh { edits, spacers } whenever any edit
   * row is added, removed, or modified.
   */

  import type { PlaceEdit, SpacerInsert } from '../state/types';

  export interface ArrangeEditListState {
    arrangeId: string;
    edits: PlaceEdit[];
    /** Spacers attached to this arrange. Not editable here — held for
     *  passthrough so the data isn't dropped on edit commits. */
    spacers: SpacerInsert[];
    /** Upstream Cut's slice count — bounds the slice-idx inputs. */
    sliceCount: number;
  }

  export interface ArrangeEditListChange {
    edits: PlaceEdit[];
    spacers: SpacerInsert[];
  }
</script>

<script lang="ts">
  interface Props {
    state: ArrangeEditListState;
    allocateId: (prefix: 'edit' | 'spacer') => string;
    onChange: (next: ArrangeEditListChange) => void;
  }

  let { state, allocateId, onChange }: Props = $props();

  function emit(edits: PlaceEdit[]): void {
    // Spacers always pass through untouched — this component doesn't
    // edit them. See module comment.
    onChange({
      edits: edits.map(cloneEdit),
      spacers: state.spacers.map((s) => ({ ...s })),
    });
  }

  function maxIdx(): number {
    return Math.max(0, state.sliceCount - 1);
  }

  function clampInt(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, Math.floor(v)));
  }

  // --- edit ops -----------------------------------------------------

  function addRotate(degrees: number): void {
    const next: PlaceEdit = {
      kind: 'placeEdit',
      id: allocateId('edit'),
      target: { arrangeId: state.arrangeId, sliceIdx: 0 },
      op: { kind: 'rotate', degrees: degrees as 90 | 180 | 270 },
      status: 'ok',
    };
    emit([...state.edits, next]);
  }

  function addShift(): void {
    const next: PlaceEdit = {
      kind: 'placeEdit',
      id: allocateId('edit'),
      target: { arrangeId: state.arrangeId, sliceIdx: 0 },
      op: { kind: 'shift', delta: 10 },
      status: 'ok',
    };
    emit([...state.edits, next]);
  }

  function removeEdit(id: string): void {
    emit(state.edits.filter((e) => e.id !== id));
  }

  function updateEditSliceIdx(id: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const idx = clampInt(v, 0, maxIdx());
    const nextEdits = state.edits.map((e) =>
      e.id === id ? { ...e, target: { ...e.target, sliceIdx: idx } } : e,
    );
    emit(nextEdits);
  }

  function updateEditRotateDegrees(id: string, degrees: 90 | 180 | 270): void {
    const nextEdits = state.edits.map((e) =>
      e.id === id && e.op.kind === 'rotate' ? { ...e, op: { ...e.op, degrees } } : e,
    );
    emit(nextEdits);
  }

  function updateEditShiftDelta(id: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const delta = clampInt(v, -200, 200);
    const nextEdits = state.edits.map((e) =>
      e.id === id && e.op.kind === 'shift' ? { ...e, op: { ...e.op, delta } } : e,
    );
    emit(nextEdits);
  }

  // --- display order -----------------------------------------------
  // Legacy sort-by-idx kept for this step to preserve the current
  // visual. Step 3 replaces this component with a per-slice list and
  // the sort goes away.

  const items = $derived.by<PlaceEdit[]>(() => {
    return [...state.edits].sort((a, b) => a.target.sliceIdx - b.target.sliceIdx);
  });

  function cloneEdit(e: PlaceEdit): PlaceEdit {
    return {
      kind: 'placeEdit',
      id: e.id,
      target: { ...e.target },
      op: { ...e.op } as PlaceEdit['op'],
      status: e.status,
      ...(e.statusReason ? { statusReason: e.statusReason } : {}),
    };
  }
</script>

<div class="arrange-edit-list">
  <div class="header">
    <span class="title">{state.edits.length} edits</span>
    <span class="ctx">· {state.sliceCount} slices</span>
  </div>

  <div class="list">
    {#if items.length === 0}
      <div class="empty">No edits yet. Add one below.</div>
    {:else}
      {#each items as e (e.id)}
        <div class="row">
          <span class="glyph">{e.op.kind === 'shift' ? '⇢' : '↻'}</span>
          <input
            class="num"
            type="number"
            min="0"
            max={maxIdx()}
            step="1"
            value={e.target.sliceIdx}
            title="slice index"
            onchange={(ev) => updateEditSliceIdx(e.id, (ev.currentTarget as HTMLInputElement).value)}
            onkeydown={(ev) => { if (ev.key === 'Enter') { updateEditSliceIdx(e.id, (ev.currentTarget as HTMLInputElement).value); (ev.currentTarget as HTMLInputElement).blur(); } }}
          />
          <span class="unit">slice</span>

          <div class="op-editor">
            {#if e.op.kind === 'rotate'}
              {@const curDeg = e.op.degrees}
              <div class="seg">
                {#each [90, 180, 270] as d}
                  <button
                    type="button"
                    class:on={curDeg === d}
                    onclick={() => updateEditRotateDegrees(e.id, d as 90 | 180 | 270)}
                  >{d}°</button>
                {/each}
              </div>
            {:else if e.op.kind === 'shift'}
              <input
                class="num shift"
                type="number"
                min="-200"
                max="200"
                step="1"
                value={e.op.delta}
                title="shift delta (mm)"
                onchange={(ev) => updateEditShiftDelta(e.id, (ev.currentTarget as HTMLInputElement).value)}
                onkeydown={(ev) => { if (ev.key === 'Enter') { updateEditShiftDelta(e.id, (ev.currentTarget as HTMLInputElement).value); (ev.currentTarget as HTMLInputElement).blur(); } }}
              />
              <span class="unit-inline">mm</span>
            {/if}
          </div>

          <button type="button" class="rm" title="Remove" onclick={() => removeEdit(e.id)}>×</button>
        </div>
      {/each}
    {/if}
  </div>

  <div class="add-row">
    <button type="button" class="add" onclick={() => addRotate(180)}>+ flip</button>
    <button type="button" class="add" onclick={() => addRotate(90)}>+ rotate</button>
    <button type="button" class="add" onclick={() => addShift()}>+ shift</button>
  </div>
</div>

<style>
  .arrange-edit-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.72rem;
  }
  .header {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    color: #888;
    font-size: 0.66rem;
  }
  .title {
    color: #222;
    font-weight: 600;
  }
  .ctx {
    font-family: ui-monospace, monospace;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-right: 2px;
  }
  .empty {
    padding: 0.4rem 0.15rem;
    color: #888;
    font-size: 0.68rem;
  }

  .row {
    display: grid;
    grid-template-columns: 24px 54px 38px 1fr 20px;
    gap: 0.3rem;
    align-items: center;
    padding: 1px 2px;
  }
  .glyph {
    font-weight: 700;
    text-align: center;
    color: #555;
  }
  .unit {
    font-size: 0.62rem;
    color: #888;
    font-family: ui-monospace, monospace;
  }
  .num {
    width: 46px;
    padding: 1px 3px;
    border: 1px solid #d6d3cd;
    border-radius: 2px;
    font-family: ui-monospace, monospace;
    font-size: 0.64rem;
    background: #fff;
    min-width: 0;
  }
  .num.shift {
    width: 60px;
  }
  .op-editor {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.66rem;
  }
  .unit-inline {
    color: #888;
  }

  .seg {
    display: inline-flex;
    border: 1px solid #d6d3cd;
    border-radius: 3px;
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: #fff;
    color: #666;
    padding: 1px 6px;
    font-size: 0.64rem;
    cursor: pointer;
    font-family: inherit;
  }
  .seg button + button {
    border-left: 1px solid #d6d3cd;
  }
  .seg button.on {
    background: #fff3dc;
    color: #5b4a2e;
  }

  .rm {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid #d6d3cd;
    background: #fff;
    color: #888;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 2px;
  }

  .add-row {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding-top: 0.25rem;
  }
  .add {
    border: 1px dashed #c9c6be;
    background: #fff;
    color: #666;
    padding: 2px 8px;
    font-size: 0.66rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
  }
  .add:hover {
    border-color: #8a6a44;
    color: #5b4a2e;
  }
</style>
