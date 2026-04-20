<script lang="ts" module>
  /**
   * Cut controls — Svelte 5 port of cut-controls.ts.
   *
   * Same state shape + `onChange` callback-prop contract as the
   * imperative original, so swap-in is mechanical. Used by the Cut
   * harness (src/main-cut.ts) and every Cut stage in the workbench.
   *
   * Commit behaviour: sliders fire onChange on every `input` event
   * (live); the pipeline debounces downstream.
   */

  export interface CutControlsState {
    /** -90..90 degrees. */
    rip: number;
    /** 45..90 degrees. */
    bevel: number;
    /** Which param drives slice density. */
    spacingMode: 'pitch' | 'slices';
    /** mm, used when spacingMode = 'pitch'. */
    pitch: number;
    /** count, used when spacingMode = 'slices'. */
    slices: number;
    /** Show thin offcut pieces alongside slices. */
    showOffcuts: boolean;
  }
</script>

<script lang="ts">
  interface Props {
    state: CutControlsState;
    onChange: (next: CutControlsState) => void;
  }

  let { state, onChange }: Props = $props();

  const MIN_RIP = -90;
  const MAX_RIP = 90;
  const MIN_BEVEL = 45;
  const MAX_BEVEL = 90;
  const MIN_SLICES = 2;
  const MAX_SLICES = 32;
  const MIN_PITCH = 1;
  const MAX_PITCH = 500;

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }

  function emit(patch: Partial<CutControlsState>): void {
    onChange({ ...state, ...patch });
  }

  function onRip(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    emit({ rip: clamp(v, MIN_RIP, MAX_RIP) });
  }

  function onBevel(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    emit({ bevel: clamp(v, MIN_BEVEL, MAX_BEVEL) });
  }

  function onSpacing(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    if (state.spacingMode === 'slices') {
      emit({ slices: clamp(Math.floor(v), MIN_SLICES, MAX_SLICES) });
    } else {
      emit({ pitch: clamp(Math.round(v), MIN_PITCH, MAX_PITCH) });
    }
  }

  function onOffcuts(e: Event): void {
    emit({ showOffcuts: (e.currentTarget as HTMLInputElement).checked });
  }

  function setMode(next: 'pitch' | 'slices'): void {
    if (state.spacingMode === next) return;
    emit({ spacingMode: next });
  }

  const spacingMin = $derived(state.spacingMode === 'slices' ? MIN_SLICES : MIN_PITCH);
  const spacingMax = $derived(state.spacingMode === 'slices' ? MAX_SLICES : MAX_PITCH);
  const spacingValue = $derived(
    state.spacingMode === 'slices' ? state.slices : state.pitch,
  );
  const spacingUnitText = $derived(
    state.spacingMode === 'slices' ? String(state.slices) : `${state.pitch} mm`,
  );
  const spacingLabel = $derived(state.spacingMode === 'slices' ? 'slices' : 'pitch');
</script>

<div class="cut-controls">
  <div class="row">
    <label>rip</label>
    <input
      type="range"
      min={MIN_RIP}
      max={MAX_RIP}
      step="1"
      value={state.rip}
      oninput={onRip}
    />
    <span class="value">{state.rip}°</span>
  </div>

  <div class="row">
    <label>bevel</label>
    <input
      type="range"
      min={MIN_BEVEL}
      max={MAX_BEVEL}
      step="1"
      value={state.bevel}
      oninput={onBevel}
    />
    <span class="value">{state.bevel}°</span>
  </div>

  <div class="row mode-row">
    <label>mode</label>
    <div class="seg">
      <button
        type="button"
        class:on={state.spacingMode === 'slices'}
        onclick={() => setMode('slices')}
      >slices</button>
      <button
        type="button"
        class:on={state.spacingMode === 'pitch'}
        onclick={() => setMode('pitch')}
      >pitch</button>
    </div>
  </div>

  <div class="row">
    <label>{spacingLabel}</label>
    <input
      type="range"
      min={spacingMin}
      max={spacingMax}
      step="1"
      value={spacingValue}
      oninput={onSpacing}
    />
    <span class="value">{spacingUnitText}</span>
  </div>

  <label class="offcuts">
    <input type="checkbox" checked={state.showOffcuts} onchange={onOffcuts} />
    show offcuts
  </label>
</div>

<style>
  .cut-controls {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.72rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .mode-row {
    padding: 0.2rem 0 0;
  }
  label {
    flex: 0 0 58px;
    color: #666;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
  }
  input[type="range"] {
    flex: 1;
    height: 16px;
  }
  .value {
    flex: 0 0 46px;
    padding: 1px 4px;
    border: 1px solid #d6d3cd;
    border-radius: 2px;
    font-family: ui-monospace, monospace;
    font-size: 0.66rem;
    text-align: right;
    background: #fff;
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
  .offcuts {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: #666;
    font-size: 0.66rem;
    padding-top: 0.15rem;
    flex: unset;
  }
</style>
