<script lang="ts" module>
  /**
   * Trim controls — Svelte 5 port of trim-controls.ts.
   *
   * Surface: mode segmented selector (flush · rectangle · bbox);
   * optional bounds inputs visible only when mode === 'bbox'.
   * Same state shape as the imperative original.
   */

  export interface TrimControlsState {
    mode: 'flush' | 'rectangle' | 'bbox';
    bounds?: {
      xMin?: number;
      xMax?: number;
      zMin?: number;
      zMax?: number;
    };
  }
</script>

<script lang="ts">
  interface Props {
    state: TrimControlsState;
    onChange: (next: TrimControlsState) => void;
  }

  let { state, onChange }: Props = $props();

  const MODES: ReadonlyArray<TrimControlsState['mode']> = ['flush', 'rectangle', 'bbox'];

  function setMode(m: TrimControlsState['mode']): void {
    if (state.mode === m) return;
    onChange({ ...state, mode: m });
  }

  type BoundKey = 'xMin' | 'xMax' | 'zMin' | 'zMax';

  function commitBound(key: BoundKey, raw: string): void {
    const nextBounds = { ...(state.bounds ?? {}) };
    if (raw.trim() === '') {
      delete nextBounds[key];
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v)) {
        delete nextBounds[key];
      } else {
        nextBounds[key] = v;
      }
    }
    const hasAny = Object.keys(nextBounds).length > 0;
    onChange({ ...state, bounds: hasAny ? nextBounds : undefined });
  }

  function boundValue(key: BoundKey): string {
    const v = state.bounds?.[key];
    return v === undefined ? '' : String(v);
  }

  function onBoundChange(key: BoundKey, e: Event): void {
    commitBound(key, (e.currentTarget as HTMLInputElement).value);
  }

  function onBoundKeyDown(key: BoundKey, e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      commitBound(key, (e.currentTarget as HTMLInputElement).value);
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="trim-controls">
  <div class="mode-row">
    <label>mode</label>
    <div class="seg">
      {#each MODES as m}
        <button
          type="button"
          class:on={state.mode === m}
          onclick={() => setMode(m)}
        >{m}</button>
      {/each}
    </div>
  </div>

  {#if state.mode === 'bbox'}
    <div class="bounds">
      <p class="hint">blank = use the panel extent for that edge</p>
      <div class="bounds-row">
        <label>X</label>
        <input
          type="number"
          step="1"
          placeholder="—"
          value={boundValue('xMin')}
          onchange={(e) => onBoundChange('xMin', e)}
          onkeydown={(e) => onBoundKeyDown('xMin', e)}
        />
        <span class="arrow">→</span>
        <input
          type="number"
          step="1"
          placeholder="—"
          value={boundValue('xMax')}
          onchange={(e) => onBoundChange('xMax', e)}
          onkeydown={(e) => onBoundKeyDown('xMax', e)}
        />
      </div>
      <div class="bounds-row">
        <label>Z</label>
        <input
          type="number"
          step="1"
          placeholder="—"
          value={boundValue('zMin')}
          onchange={(e) => onBoundChange('zMin', e)}
          onkeydown={(e) => onBoundKeyDown('zMin', e)}
        />
        <span class="arrow">→</span>
        <input
          type="number"
          step="1"
          placeholder="—"
          value={boundValue('zMax')}
          onchange={(e) => onBoundChange('zMax', e)}
          onkeydown={(e) => onBoundKeyDown('zMax', e)}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .trim-controls {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.72rem;
  }
  .mode-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  label {
    flex: 0 0 58px;
    color: #666;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
  }
  .seg {
    display: inline-flex;
    border: 1px solid #d6d3cd;
    border-radius: 3px;
    overflow: hidden;
    flex: 1 1 auto;
  }
  .seg button {
    flex: 1 1 0;
    border: none;
    background: #fff;
    color: #666;
    padding: 2px 8px;
    font-size: 0.66rem;
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
  .bounds {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    border-top: 1px dashed #e4e4e0;
    padding-top: 0.35rem;
  }
  .hint {
    margin: 0;
    font-size: 0.62rem;
    color: #888;
  }
  .bounds-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .bounds-row label {
    flex: 0 0 14px;
  }
  .bounds-row input {
    flex: 1 1 0;
    min-width: 0;
    padding: 2px 4px;
    border: 1px solid #d6d3cd;
    border-radius: 2px;
    font-family: ui-monospace, monospace;
    font-size: 0.66rem;
  }
  .arrow {
    color: #c0bcb4;
    font-size: 0.7rem;
  }
</style>
