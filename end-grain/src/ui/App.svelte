<script lang="ts">
  import { appState } from '../state';
  import StripComposer from './StripComposer.svelte';
  import CutControls from './CutControls.svelte';
  import StatusBar from './StatusBar.svelte';
  import QuickCameraButtons from './QuickCameraButtons.svelte';

  type Props = { setView: (name: 'top' | 'front') => void };
  let { setView }: Props = $props();

  // Tile quick-buttons are positioned by column index. Column 0 is the
  // starting-panel tile; subsequent columns are one per pass. When passes
  // grow beyond the 3-column layout we'll revisit the layout math.
  const quickBtnTiles = $derived([
    { id: 'panel', col: 0 },
    ...appState.passes.map((p, i) => ({ id: p.id, col: i + 1 })),
  ]);
</script>

<div id="info">
  <strong>End Grain — Cut + Combine</strong><br />
  left: starting panel · middle: cut · right: joined
</div>

<!-- Column dividers matching the 3-column layout. -->
<div class="divider" style="top:0; left:33.333%; width:1px; height:100%;"></div>
<div class="divider" style="top:0; left:66.667%; width:1px; height:100%;"></div>

<!-- Tile labels. -->
<div class="step-label" style="top:8px; left:calc(16.667% - 40px);">starting panel</div>
<div class="step-label" style="top:8px; left:calc(50% - 30px);">step 1: cut A</div>
<div class="step-label" style="top:8px; left:calc(83.333% - 30px);">step 2: join 1</div>

<StripComposer />

{#each appState.passes as pass, i (pass.id)}
  <CutControls {pass} col={i + 1} label={i === 0 ? 'cut A' : `cut ${String.fromCharCode(65 + i)}`} />
{/each}

<QuickCameraButtons tiles={quickBtnTiles} {setView} />

<StatusBar />
