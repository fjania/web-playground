<script lang="ts">
  import { appState } from '../state';
  import { SPECIES_HEX, SPECIES_LIST } from '../scene';

  // Per-species width input, shared across sessions within a page load.
  // Initialized to 50mm to match the prior default strip width.
  const speciesWidths: Record<string, number> = $state(
    Object.fromEntries(SPECIES_LIST.map((sp) => [sp, 50])),
  );

  function addStrip(sp: string) {
    const w = speciesWidths[sp];
    if (!Number.isFinite(w) || w < 5) return;
    appState.strips = [...appState.strips, { species: sp, width: Math.min(w, 200) }];
  }

  function clearAll() {
    if (appState.strips.length <= 1) return;
    appState.strips = appState.strips.slice(0, 1);
  }
</script>

<div id="strip-controls" class="ctrl-panel">
  <label>starting strips</label>

  <label style="margin-top:6px;">height: <span class="angle-val">{appState.stripHeight}mm</span></label>
  <input type="range" min="10" max="120" step="1" bind:value={appState.stripHeight} />

  <label style="margin-top:6px;">length: <span class="angle-val">{appState.stripLength}mm</span></label>
  <input type="range" min="100" max="800" step="10" bind:value={appState.stripLength} />

  <label style="margin-top:8px;">species</label>
  <div class="species-list">
    {#each SPECIES_LIST as sp}
      <div class="species-row">
        <span class="swatch" style="background: {SPECIES_HEX[sp]}"></span>
        <span class="name">{sp}</span>
        <input
          type="number" min="5" max="200" step="1"
          bind:value={speciesWidths[sp]}
          title="width in mm"
        />
        <button type="button" onclick={() => addStrip(sp)} title="append strip">+</button>
      </div>
    {/each}
  </div>

  <div class="hint">
    drag a strip in the panel to reorder · right-click to remove
  </div>

  <div class="action-row">
    <button type="button" onclick={clearAll} disabled={appState.strips.length <= 1}>
      clear all but one
    </button>
  </div>
</div>

<style>
  .species-list {
    border: 1px solid #3d3835;
    border-radius: 4px;
    padding: 4px;
    margin-bottom: 6px;
  }
  .species-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 10px;
  }
  .species-row .name {
    flex: 1;
    color: #e4cc8f;
  }
  .species-row input[type="number"] {
    width: 48px;
    background: #2a2622;
    color: #e4cc8f;
    border: 1px solid #3d3835;
    border-radius: 3px;
    padding: 2px 3px;
    font-family: inherit;
    font-size: 10px;
  }
  .species-row button {
    width: 22px;
    height: 22px;
    padding: 0;
    line-height: 1;
    background: #2d5a27;
    color: #e4cc8f;
    border: 1px solid #3d5a37;
    border-radius: 3px;
    font-family: inherit;
    font-size: 14px;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .species-row button:hover {
    background: #3d7a37;
  }
  .hint {
    font-size: 9px;
    color: #78716c;
    margin: 4px 0 6px;
    line-height: 1.4;
  }
</style>
