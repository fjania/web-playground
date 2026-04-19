<script lang="ts">
  import { appState } from '../state';
  import { makeCutPass } from '../state/app.svelte';
  import StripComposer from './StripComposer.svelte';
  import CutControls from './CutControls.svelte';
  import StatusBar from './StatusBar.svelte';
  import QuickCameraButtons from './QuickCameraButtons.svelte';

  type Props = { setView: (name: 'top' | 'front') => void };
  let { setView }: Props = $props();

  // Column layout math: 1 starting-panel column + 2 columns per pass.
  // Each column is 100/totalCols %. columnRightPercent(col) returns the
  // CSS right-offset (from the right edge of the window) of the column's
  // right edge, in percent — used to position control panels flush with
  // the right side of their tile column.
  const totalCols = $derived(1 + 2 * appState.passes.length);
  function colRightPercent(col: number): number {
    // column col spans [col/n, (col+1)/n]; right offset = 100 - (col+1)/n.
    return 100 - ((col + 1) * 100) / totalCols;
  }
  function colLeftPercent(col: number): number {
    return (col * 100) / totalCols;
  }
  function colCenterPercent(col: number): number {
    return ((col + 0.5) * 100) / totalCols;
  }

  const passLetter = (i: number) => String.fromCharCode(65 + i); // 0→A, 1→B

  // Tiles for the quick-view buttons: panel + one (cut, join) pair per pass.
  const quickBtnTiles = $derived.by(() => {
    const out: { id: string; col: number }[] = [{ id: 'panel', col: 0 }];
    appState.passes.forEach((p, i) => {
      out.push({ id: `cut-${p.id}`, col: 1 + i * 2 });
      out.push({ id: `join-${p.id}`, col: 2 + i * 2 });
    });
    return out;
  });

  function addPass() {
    appState.passes = [...appState.passes, makeCutPass()];
  }
  function removeLastPass() {
    if (appState.passes.length <= 1) return;
    appState.passes = appState.passes.slice(0, -1);
  }
</script>

<div id="info">
  <strong>End Grain — Cut + Combine</strong><br />
  starting panel · per pass: cut + arrangement
</div>

<!-- Column dividers, one per interior column boundary. -->
{#each Array(totalCols - 1) as _, i}
  {@const left = ((i + 1) * 100) / totalCols}
  <div class="divider" style="top:0; left:{left}%; width:1px; height:100%;"></div>
{/each}

<!-- Tile labels. -->
<div class="step-label" style="top:8px; left:calc({colCenterPercent(0)}% - 40px);">
  starting panel
</div>
{#each appState.passes as pass, i (pass.id)}
  <div class="step-label" style="top:8px; left:calc({colCenterPercent(1 + i * 2)}% - 30px);">
    cut {passLetter(i)}
  </div>
  <div class="step-label" style="top:8px; left:calc({colCenterPercent(2 + i * 2)}% - 30px);">
    join {i + 1}
  </div>
{/each}

<StripComposer />

{#each appState.passes as pass, i (pass.id)}
  <CutControls
    {pass}
    style={`top: 10px; right: calc(${colRightPercent(1 + i * 2)}% + 10px);`}
    label={`cut ${passLetter(i)}`}
  />
{/each}

<!-- Add/remove pass controls. Minimal for now; docked at bottom-right
     just above the status bar. -->
<div class="pass-controls">
  <button type="button" onclick={addPass}>+ add pass</button>
  <button type="button" onclick={removeLastPass} disabled={appState.passes.length <= 1}>
    − remove last pass
  </button>
</div>

<QuickCameraButtons tiles={quickBtnTiles} {setView} />

<StatusBar />

<style>
  .pass-controls {
    position: fixed;
    bottom: 38px;
    right: 10px;
    z-index: 10;
    display: flex;
    gap: 6px;
  }
  .pass-controls button {
    padding: 4px 10px;
    background: rgba(28, 25, 23, 0.9);
    color: #a8a29e;
    border: 1px solid #3d3835;
    border-radius: 3px;
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .pass-controls button:hover:not(:disabled) {
    background: #3d3835;
    color: #e4cc8f;
  }
  .pass-controls button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
