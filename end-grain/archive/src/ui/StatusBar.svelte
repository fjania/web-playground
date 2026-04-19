<script lang="ts">
  import { hoverState } from '../state';
  import { fmtArea, fmtVol } from '../scene';

  const normalStr = $derived.by(() => {
    const n = hoverState.info?.normal;
    if (!n) return '—';
    return `(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})`;
  });
</script>

<div id="statusbar">
  {#if hoverState.info}
    {@const h = hoverState.info}
    <span class="label">species</span> <span class="val">{h.species}</span>
    <span class="label">vol</span> <span class="val">{fmtVol(h.volMm3)}</span>
    <span class="label">area</span> <span class="val">{fmtArea(h.areaMm2)}</span>
    <span class="label">materials</span> <span class="val">{h.materials}</span>
    <span class="label">normal</span> <span class="val">{normalStr}</span>
    <span class="label">face area</span> <span class="val">{fmtArea(h.faceArea)}</span>
    <span class="label">bounds</span>
    <span class="val">{h.sizeMm.x.toFixed(0)}×{h.sizeMm.y.toFixed(0)}×{h.sizeMm.z.toFixed(0)}</span>
    <span class="label">tris</span> <span class="val">{h.tris}</span>
  {:else}
    <span class="dim">hover a piece to inspect</span>
  {/if}
</div>
