<script lang="ts">
  import { appState } from '../state';

  type Props = {
    tiles: { id: string; col: number }[];
    setView: (name: 'top' | 'front') => void;
  };
  let { tiles, setView }: Props = $props();

  const totalCols = $derived(1 + 2 * appState.passes.length);
  function colLeftPercent(col: number): number {
    return (col * 100) / totalCols;
  }
</script>

{#each tiles as tile (tile.id)}
  <div
    class="view-quick-btns"
    style="bottom: 60px; left: calc({colLeftPercent(tile.col)}% + 96px);"
    data-tile={tile.id}
  >
    <button type="button" onclick={() => setView('top')}>top</button>
    <button type="button" onclick={() => setView('front')}>front</button>
  </div>
{/each}
