<script lang="ts">
  type Props = {
    tiles: { id: string; col: number }[];
    setView: (name: 'top' | 'front') => void;
  };
  let { tiles, setView }: Props = $props();
</script>

{#each tiles as tile (tile.id)}
  <div
    class="view-quick-btns"
    style="bottom: 60px; left: calc({tile.col * 33.333}% + 96px);"
    data-tile={tile.id}
  >
    <button type="button" onclick={() => setView('top')}>top</button>
    <button type="button" onclick={() => setView('front')}>front</button>
  </div>
{/each}
