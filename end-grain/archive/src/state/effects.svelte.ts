import { appState } from './app.svelte';

/**
 * Subscribe `onChange` to any change in the top-level app state or any
 * field of any pass. Returns a teardown function that stops the effect.
 *
 * This lives in a `.svelte.ts` file so the rune is in scope; the returned
 * value is a plain teardown that regular `.ts` callers can use.
 */
export function attachAppStateEffect(onChange: () => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      // Read every field we care about so runes track them.
      appState.strips;
      appState.stripHeight;
      appState.stripLength;
      appState.passes.length; // track insertions/removals
      for (const p of appState.passes) {
        p.id;
        if (p.kind === 'cut') {
          p.rip;
          p.bevel;
          p.pitch;
          p.mode;
          p.pattern;
          p.shift;
          p.showOffcuts;
        }
      }
      onChange();
    });
  });
}
