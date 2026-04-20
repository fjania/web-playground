<script lang="ts" module>
  /**
   * ArrangeEditList — Svelte 5 port of arrange-edit-list.ts.
   *
   * Form-based edit list for PlaceEdits + SpacerInserts attached to
   * one Arrange feature. Each row has op-type-specific controls;
   * add-buttons at the bottom mint new edits via the supplied
   * `allocateId` callback.
   *
   * onChange fires with a fresh { edits, spacers } whenever any row is
   * added, removed, or edited. The workbench uses that payload to
   * splice the Arrange's attached features in the timeline.
   */

  import type { PlaceEdit, SpacerInsert } from '../state/types';

  export interface ArrangeEditListState {
    arrangeId: string;
    edits: PlaceEdit[];
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
  import type { PlaceEdit, SpacerInsert, Species } from '../state/types';
  import { SPECIES_COLOURS } from '../render/summary';

  const SPECIES_LIST: Species[] = ['maple', 'walnut', 'cherry', 'padauk', 'purpleheart'];

  interface Props {
    state: ArrangeEditListState;
    allocateId: (prefix: 'edit' | 'spacer') => string;
    onChange: (next: ArrangeEditListChange) => void;
  }

  let { state, allocateId, onChange }: Props = $props();

  function emit(edits: PlaceEdit[], spacers: SpacerInsert[]): void {
    onChange({
      edits: edits.map(cloneEdit),
      spacers: spacers.map((s) => ({ ...s })),
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
    emit([...state.edits, next], state.spacers);
  }

  function addShift(): void {
    const next: PlaceEdit = {
      kind: 'placeEdit',
      id: allocateId('edit'),
      target: { arrangeId: state.arrangeId, sliceIdx: 0 },
      op: { kind: 'shift', delta: 10 },
      status: 'ok',
    };
    emit([...state.edits, next], state.spacers);
  }

  function addSpacer(): void {
    const next: SpacerInsert = {
      kind: 'spacerInsert',
      id: allocateId('spacer'),
      arrangeId: state.arrangeId,
      afterSliceIdx: 0,
      species: 'walnut',
      width: 5,
      status: 'ok',
    };
    emit(state.edits, [...state.spacers, next]);
  }

  function removeEdit(id: string): void {
    emit(
      state.edits.filter((e) => e.id !== id),
      state.spacers,
    );
  }

  function removeSpacer(id: string): void {
    emit(
      state.edits,
      state.spacers.filter((s) => s.id !== id),
    );
  }

  function updateEditSliceIdx(id: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const idx = clampInt(v, 0, maxIdx());
    const nextEdits = state.edits.map((e) =>
      e.id === id ? { ...e, target: { ...e.target, sliceIdx: idx } } : e,
    );
    emit(nextEdits, state.spacers);
  }

  function updateEditRotateDegrees(id: string, degrees: 90 | 180 | 270): void {
    const nextEdits = state.edits.map((e) =>
      e.id === id && e.op.kind === 'rotate' ? { ...e, op: { ...e.op, degrees } } : e,
    );
    emit(nextEdits, state.spacers);
  }

  function updateEditShiftDelta(id: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const delta = clampInt(v, -200, 200);
    const nextEdits = state.edits.map((e) =>
      e.id === id && e.op.kind === 'shift' ? { ...e, op: { ...e.op, delta } } : e,
    );
    emit(nextEdits, state.spacers);
  }

  function updateSpacerAfter(id: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const idx = clampInt(v, 0, maxIdx());
    const nextSpacers = state.spacers.map((s) =>
      s.id === id ? { ...s, afterSliceIdx: idx } : s,
    );
    emit(state.edits, nextSpacers);
  }

  function updateSpacerSpecies(id: string, species: Species): void {
    const nextSpacers = state.spacers.map((s) =>
      s.id === id ? { ...s, species } : s,
    );
    emit(state.edits, nextSpacers);
  }

  function updateSpacerWidth(id: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const w = clampInt(v, 1, 100);
    const nextSpacers = state.spacers.map((s) =>
      s.id === id ? { ...s, width: w } : s,
    );
    emit(state.edits, nextSpacers);
  }

  // --- ordered interleave ------------------------------------------

  type Item =
    | { kind: 'edit'; idx: number; e: PlaceEdit }
    | { kind: 'spacer'; idx: number; s: SpacerInsert };

  const items = $derived.by<Item[]>(() => {
    const out: Item[] = [];
    for (const e of state.edits) out.push({ kind: 'edit', idx: e.target.sliceIdx, e });
    for (const s of state.spacers) out.push({ kind: 'spacer', idx: s.afterSliceIdx, s });
    out.sort((a, b) => a.idx - b.idx);
    return out;
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
    <span class="title">{state.edits.length + state.spacers.length} edits</span>
    <span class="ctx">· {state.sliceCount} slices</span>
  </div>

  <div class="list">
    {#if items.length === 0}
      <div class="empty">No edits yet. Add one below.</div>
    {:else}
      {#each items as item (item.kind === 'edit' ? 'e-' + item.e.id : 's-' + item.s.id)}
        {#if item.kind === 'edit'}
          <div class="row">
            <span class="glyph">{item.e.op.kind === 'shift' ? '⇢' : '↻'}</span>
            <input
              class="num"
              type="number"
              min="0"
              max={maxIdx()}
              step="1"
              value={item.e.target.sliceIdx}
              title="slice index"
              onchange={(e) => updateEditSliceIdx(item.e.id, (e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => { if (e.key === 'Enter') { updateEditSliceIdx(item.e.id, (e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).blur(); } }}
            />
            <span class="unit">slice</span>

            <div class="op-editor">
              {#if item.e.op.kind === 'rotate'}
                {@const curDeg = item.e.op.degrees}
                <div class="seg">
                  {#each [90, 180, 270] as d}
                    <button
                      type="button"
                      class:on={curDeg === d}
                      onclick={() => updateEditRotateDegrees(item.e.id, d as 90 | 180 | 270)}
                    >{d}°</button>
                  {/each}
                </div>
              {:else if item.e.op.kind === 'shift'}
                <input
                  class="num shift"
                  type="number"
                  min="-200"
                  max="200"
                  step="1"
                  value={item.e.op.delta}
                  title="shift delta (mm)"
                  onchange={(e) => updateEditShiftDelta(item.e.id, (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => { if (e.key === 'Enter') { updateEditShiftDelta(item.e.id, (e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).blur(); } }}
                />
                <span class="unit-inline">mm</span>
              {/if}
            </div>

            <button type="button" class="rm" title="Remove" onclick={() => removeEdit(item.e.id)}>×</button>
          </div>
        {:else}
          <div class="row">
            <span
              class="swatch"
              style:background={SPECIES_COLOURS[item.s.species]}
            ></span>
            <input
              class="num"
              type="number"
              min="0"
              max={maxIdx()}
              step="1"
              value={item.s.afterSliceIdx}
              title="after slice index"
              onchange={(e) => updateSpacerAfter(item.s.id, (e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => { if (e.key === 'Enter') { updateSpacerAfter(item.s.id, (e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).blur(); } }}
            />
            <span class="unit">after</span>

            <div class="op-editor">
              <select
                value={item.s.species}
                onchange={(e) => updateSpacerSpecies(item.s.id, (e.currentTarget as HTMLSelectElement).value as Species)}
              >
                {#each SPECIES_LIST as sp}
                  <option value={sp}>{sp}</option>
                {/each}
              </select>
              <input
                class="num spacer-width"
                type="number"
                min="1"
                max="100"
                step="1"
                value={item.s.width}
                title="spacer width (mm)"
                onchange={(e) => updateSpacerWidth(item.s.id, (e.currentTarget as HTMLInputElement).value)}
                onkeydown={(e) => { if (e.key === 'Enter') { updateSpacerWidth(item.s.id, (e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).blur(); } }}
              />
              <span class="unit-inline">mm</span>
            </div>

            <button type="button" class="rm" title="Remove" onclick={() => removeSpacer(item.s.id)}>×</button>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="add-row">
    <button type="button" class="add" onclick={() => addRotate(180)}>+ flip</button>
    <button type="button" class="add" onclick={() => addRotate(90)}>+ rotate</button>
    <button type="button" class="add" onclick={() => addShift()}>+ shift</button>
    <button type="button" class="add" onclick={() => addSpacer()}>+ spacer</button>
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
  .swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin: 0 auto;
    border-radius: 1px;
    border: 1px solid #00000033;
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
  .num.spacer-width {
    width: 46px;
  }
  .op-editor {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.66rem;
  }
  .op-editor select {
    font-size: 0.64rem;
    padding: 1px 3px;
    border: 1px solid #d6d3cd;
    border-radius: 2px;
    background: #fff;
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
