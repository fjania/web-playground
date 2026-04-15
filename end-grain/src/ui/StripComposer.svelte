<script lang="ts">
  import { appState } from '../state';
  import { SPECIES_LIST, SPECIES_HEX } from '../scene';
  import type { StripDef } from '../domain/types';

  // Named presets for quick seeds.
  const presets: Record<string, () => StripDef[]> = {
    ab8: () => {
      const out: StripDef[] = [];
      for (let i = 0; i < 16; i++) out.push({ species: i % 2 === 0 ? 'maple' : 'walnut', width: 50 });
      return out;
    },
    abc4: () => {
      const out: StripDef[] = [];
      const seq = ['maple', 'walnut', 'cherry'];
      for (let i = 0; i < 12; i++) out.push({ species: seq[i % 3], width: 50 });
      return out;
    },
    bookmatch: () => {
      const half = ['maple', 'walnut', 'maple', 'walnut', 'maple'];
      return [...half, ...half.slice().reverse()].map((sp) => ({ species: sp, width: 50 }));
    },
    single: () => [{ species: 'maple', width: 400 }],
    rainbow: () => SPECIES_LIST.map((sp) => ({ species: sp, width: 60 })),
  };

  let presetSelection = $state('');

  function onPresetChange() {
    if (presetSelection && presets[presetSelection]) {
      appState.strips = presets[presetSelection]();
    }
    presetSelection = '';
  }

  function moveUp(i: number) {
    if (i <= 0) return;
    const next = appState.strips.slice();
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    appState.strips = next;
  }
  function moveDown(i: number) {
    if (i >= appState.strips.length - 1) return;
    const next = appState.strips.slice();
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    appState.strips = next;
  }
  function remove(i: number) {
    if (appState.strips.length <= 1) return;
    const next = appState.strips.slice();
    next.splice(i, 1);
    appState.strips = next;
  }
  function add() {
    const last = appState.strips[appState.strips.length - 1];
    const seed = last ? { ...last } : { species: 'maple', width: 50 };
    appState.strips = [...appState.strips, seed];
  }
  function duplicateLast() {
    const last = appState.strips[appState.strips.length - 1];
    if (!last) return;
    appState.strips = [...appState.strips, { ...last }];
  }

  function setWidth(i: number, w: number) {
    if (!Number.isFinite(w) || w < 5) return;
    const next = appState.strips.slice();
    next[i] = { ...next[i], width: Math.min(w, 200) };
    appState.strips = next;
  }
  function setSpecies(i: number, sp: string) {
    const next = appState.strips.slice();
    next[i] = { ...next[i], species: sp };
    appState.strips = next;
  }
</script>

<div id="strip-controls" class="ctrl-panel">
  <label>starting strips</label>

  <label style="margin-top:6px;">height: <span class="angle-val">{appState.stripHeight}mm</span></label>
  <input
    type="range" min="10" max="120" step="1"
    bind:value={appState.stripHeight}
  />

  <label style="margin-top:6px;">length: <span class="angle-val">{appState.stripLength}mm</span></label>
  <input
    type="range" min="100" max="800" step="10"
    bind:value={appState.stripLength}
  />

  <label style="margin-top:8px;">strips (left → right)</label>
  <div class="strip-list">
    {#each appState.strips as strip, i (i)}
      <div class="strip-row">
        <span class="swatch" style="background: {SPECIES_HEX[strip.species]}"></span>
        <select value={strip.species} onchange={(e) => setSpecies(i, (e.target as HTMLSelectElement).value)}>
          {#each SPECIES_LIST as sp}
            <option value={sp}>{sp}</option>
          {/each}
        </select>
        <input
          type="number" min="5" max="200" step="1"
          value={strip.width}
          onchange={(e) => setWidth(i, parseInt((e.target as HTMLInputElement).value, 10))}
        />
        <button type="button" title="move up" disabled={i === 0} onclick={() => moveUp(i)}>↑</button>
        <button type="button" title="move down" disabled={i === appState.strips.length - 1} onclick={() => moveDown(i)}>↓</button>
        <button type="button" title="remove" disabled={appState.strips.length <= 1} onclick={() => remove(i)}>×</button>
      </div>
    {/each}
  </div>

  <div class="action-row">
    <button type="button" onclick={add}>+ add</button>
    <button type="button" onclick={duplicateLast}>duplicate last</button>
  </div>

  <div class="preset-row">
    <label style="margin:0;">preset:</label>
    <select bind:value={presetSelection} onchange={onPresetChange}>
      <option value="">(choose…)</option>
      <option value="ab8">A/B ×8 (maple/walnut)</option>
      <option value="abc4">A/B/C ×4 (maple/walnut/cherry)</option>
      <option value="bookmatch">bookmatch maple/walnut</option>
      <option value="single">single maple slab</option>
      <option value="rainbow">rainbow (all 5)</option>
    </select>
  </div>
</div>
