<script lang="ts" module>
  /**
   * StripInventory — Svelte 5 port of strip-inventory.ts.
   *
   * Global thickness + length inputs, plus a list of per-strip rows
   * (swatch, species dropdown, width input, duplicate, remove) in
   * arrangement order. "+ Add strip" appends to the arrangement with
   * the trailing strip's defaults.
   *
   * State shape matches the imperative InventoryState so the adapter
   * can translate 1:1.
   */

  import type { StripDef } from '../state/types';

  export const MIN_STRIPS = 1;
  export const MAX_STRIPS = 64;

  export interface InventoryState {
    inventory: StripDef[];
    order: string[];
    stripHeight: number;
    stripLength: number;
  }
</script>

<script lang="ts">
  import type { Species } from '../state/types';
  import { SPECIES_COLOURS } from '../render/summary';

  const SPECIES_LIST: Species[] = ['maple', 'walnut', 'cherry', 'padauk', 'purpleheart'];

  interface Props {
    state: InventoryState;
    allocateStripId: () => string;
    onChange: (next: InventoryState) => void;
  }

  let { state, allocateStripId, onChange }: Props = $props();

  function emit(next: InventoryState): void {
    onChange({
      inventory: next.inventory.map((s) => ({ ...s })),
      order: [...next.order],
      stripHeight: next.stripHeight,
      stripLength: next.stripLength,
    });
  }

  function commitHeight(raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    emit({ ...state, stripHeight: v });
  }

  function commitLength(raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    emit({ ...state, stripLength: v });
  }

  function commitWidth(stripId: string, raw: string): void {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const inv = state.inventory.map((s) =>
      s.stripId === stripId ? { ...s, width: v } : s,
    );
    emit({ ...state, inventory: inv });
  }

  function commitSpecies(stripId: string, species: Species): void {
    const inv = state.inventory.map((s) =>
      s.stripId === stripId ? { ...s, species } : s,
    );
    emit({ ...state, inventory: inv });
  }

  function addStrip(): void {
    if (state.inventory.length >= MAX_STRIPS) return;
    const lastId = state.order[state.order.length - 1];
    const last = lastId
      ? state.inventory.find((s) => s.stripId === lastId)
      : state.inventory[state.inventory.length - 1];
    const next: StripDef = {
      stripId: allocateStripId(),
      species: last?.species ?? 'maple',
      width: last?.width ?? 50,
    };
    emit({
      ...state,
      inventory: [...state.inventory, next],
      order: [...state.order, next.stripId],
    });
  }

  function duplicateStrip(stripId: string): void {
    if (state.inventory.length >= MAX_STRIPS) return;
    const strip = state.inventory.find((s) => s.stripId === stripId);
    if (!strip) return;
    const copy: StripDef = {
      stripId: allocateStripId(),
      species: strip.species,
      width: strip.width,
    };
    const pos = state.order.indexOf(stripId);
    const nextOrder =
      pos < 0
        ? [...state.order, copy.stripId]
        : [
            ...state.order.slice(0, pos + 1),
            copy.stripId,
            ...state.order.slice(pos + 1),
          ];
    emit({
      ...state,
      inventory: [...state.inventory, copy],
      order: nextOrder,
    });
  }

  function removeStrip(stripId: string): void {
    if (state.inventory.length <= MIN_STRIPS) return;
    emit({
      ...state,
      inventory: state.inventory.filter((s) => s.stripId !== stripId),
      order: state.order.filter((id) => id !== stripId),
    });
  }

  // Render list in arrangement order.
  const orderedStrips = $derived.by(() => {
    const byId = new Map(state.inventory.map((s) => [s.stripId, s]));
    const out: StripDef[] = [];
    for (const id of state.order) {
      const s = byId.get(id);
      if (s) out.push(s);
    }
    return out;
  });

  function commitNumber(handler: (raw: string) => void) {
    return (e: Event) => handler((e.currentTarget as HTMLInputElement).value);
  }

  function commitOnEnter(handler: (raw: string) => void) {
    return (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handler((e.currentTarget as HTMLInputElement).value);
        (e.currentTarget as HTMLInputElement).blur();
      }
    };
  }
</script>

<div class="strip-inventory">
  <div class="globals">
    <label>Thickness</label>
    <input
      type="number"
      min="1"
      step="1"
      value={state.stripHeight}
      onchange={commitNumber(commitHeight)}
      onkeydown={commitOnEnter(commitHeight)}
    />
    <label>Length</label>
    <input
      type="number"
      min="1"
      step="1"
      value={state.stripLength}
      onchange={commitNumber(commitLength)}
      onkeydown={commitOnEnter(commitLength)}
    />
  </div>

  <div class="toolbar">
    <button type="button" class="add-btn" disabled={state.inventory.length >= MAX_STRIPS} onclick={addStrip}>+ Add strip</button>
    <span class="count">{state.inventory.length} / {MAX_STRIPS} strips</span>
  </div>

  <div class="list-header">
    <div></div>
    <div>Species</div>
    <div>Width (mm)</div>
    <div></div>
    <div></div>
  </div>

  <div class="list">
    {#each orderedStrips as strip (strip.stripId)}
      <div class="row">
        <div class="swatch-cell">
          <span class="swatch" style:background={SPECIES_COLOURS[strip.species]}></span>
        </div>

        <select
          value={strip.species}
          onchange={(e) => commitSpecies(strip.stripId, (e.currentTarget as HTMLSelectElement).value as Species)}
        >
          {#each SPECIES_LIST as sp}
            <option value={sp}>{sp}</option>
          {/each}
        </select>

        <input
          type="number"
          min="1"
          step="1"
          value={strip.width}
          onchange={(e) => commitWidth(strip.stripId, (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => { if (e.key === 'Enter') { commitWidth(strip.stripId, (e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).blur(); } }}
        />

        <button
          type="button"
          class="icon-btn"
          title="Duplicate strip below"
          disabled={state.inventory.length >= MAX_STRIPS}
          onclick={() => duplicateStrip(strip.stripId)}
        >+</button>

        <button
          type="button"
          class="icon-btn rm"
          title="Remove strip"
          disabled={state.inventory.length <= MIN_STRIPS}
          onclick={() => removeStrip(strip.stripId)}
        >×</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .strip-inventory {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.78rem;
    line-height: 1.3;
    flex: 0 0 auto;
  }

  .globals {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 0.35rem 0.5rem;
    align-items: center;
  }
  .globals label {
    color: #666;
    font-size: 0.72rem;
  }
  .globals input {
    width: 100%;
    font-size: 0.78rem;
    padding: 2px 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.15rem;
  }
  .add-btn {
    border: 1px solid #c9c6be;
    background: #fff;
    font-size: 0.75rem;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #222;
  }
  .add-btn:hover:not(:disabled) {
    background: #f2efe8;
  }
  .count {
    color: #888;
    font-size: 0.7rem;
  }

  .list-header {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: 16px 1fr 72px 24px 24px;
    gap: 0.4rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #888;
  }

  .list {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-right: 4px;
  }

  .row {
    display: grid;
    grid-template-columns: 16px 1fr 72px 24px 24px;
    gap: 0.4rem;
    align-items: center;
  }

  .swatch-cell {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .swatch {
    display: inline-block;
    width: 12px;
    height: 18px;
    border-radius: 1px;
    border: 1px solid #00000033;
  }

  select {
    width: 100%;
    font-size: 0.78rem;
    padding: 2px 4px;
  }

  .row input[type="number"] {
    width: 100%;
    font-size: 0.78rem;
    padding: 2px 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .icon-btn {
    border: 1px solid #c9c6be;
    background: #fff;
    font-size: 0.95rem;
    padding: 0;
    width: 22px;
    height: 22px;
    line-height: 1;
    border-radius: 4px;
    cursor: pointer;
    color: #222;
  }
  .icon-btn.rm {
    font-size: 0.9rem;
  }
  .icon-btn:hover:not(:disabled) {
    background: #f2efe8;
  }
  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
