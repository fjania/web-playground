<script lang="ts">
  import type { CutPass } from '../state/types';
  import type { PatternName } from '../domain/types';

  type Props = {
    /** Pass object (mutated via Svelte reactivity — the app.svelte.ts state
     *  is runes-backed, so direct mutation propagates). */
    pass: CutPass;
    /** Inline style string for positioning the control panel. Caller
     *  computes CSS `right`/`top` based on tile layout math. */
    style: string;
    /** Short label like "cut A" shown in the first slider label. */
    label: string;
  };
  let { pass, style, label }: Props = $props();

  const PATTERNS: { value: PatternName; label: string }[] = [
    { value: 'identity',        label: 'identity (reassemble)' },
    { value: 'flipAlternate',   label: 'flipAlternate (checker)' },
    { value: 'rotateAlternate', label: 'rotateAlternate' },
    { value: 'shiftAlternate',  label: 'shiftAlternate (running bond)' },
    { value: 'mirrorAlternate', label: 'mirrorAlternate (chevron)' },
  ];

  const showShift = $derived(pass.mode === 'pattern' && pass.pattern === 'shiftAlternate');
</script>

<div class="ctrl-panel cut-controls" {style}>
  <label>{label} — rip: <span class="angle-val">{pass.rip}°</span></label>
  <input type="range" min="-90" max="90" step="1" bind:value={pass.rip} />

  <label style="margin-top:6px;">bevel: <span class="angle-val">{pass.bevel}°</span></label>
  <input type="range" min="45" max="90" step="1" bind:value={pass.bevel} />

  <label style="margin-top:6px;">slice thickness: <span class="angle-val">{pass.pitch}mm</span></label>
  <input type="range" min="5" max="200" step="5" bind:value={pass.pitch} />

  <label style="margin-top:6px; display:flex; align-items:center; gap:6px; text-transform:none; letter-spacing:0;">
    <input type="checkbox" bind:checked={pass.showOffcuts} /> show offcuts
  </label>

  <div style="margin-top:10px; padding-top:8px; border-top:1px solid #3d3835; font-size:9px; color:#a8a29e;">arrangement</div>
  <div class="mode-switch">
    <button
      type="button" class="mode-btn" class:selected={pass.mode === 'pattern'}
      onclick={() => (pass.mode = 'pattern')}
    >pattern</button>
    <button
      type="button" class="mode-btn" class:selected={pass.mode === 'custom'}
      onclick={() => (pass.mode = 'custom')}
    >custom</button>
  </div>

  {#if pass.mode === 'pattern'}
    <div style="margin-top:6px;">
      <select bind:value={pass.pattern}>
        {#each PATTERNS as p}
          <option value={p.value}>{p.label}</option>
        {/each}
      </select>
      {#if showShift}
        <div style="margin-top:6px;">
          <label>shift: <span class="angle-val">{pass.shift}mm</span></label>
          <input type="range" min="-200" max="200" step="5" bind:value={pass.shift} />
        </div>
      {/if}
    </div>
  {:else}
    <div style="margin-top:6px; font-size:9px; color:#78716c;">
      custom mode — click two faces and join (not yet wired in the new shell).
    </div>
  {/if}
</div>
