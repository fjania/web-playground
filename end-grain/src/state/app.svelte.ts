import type { AppState, CutPass } from './types';
import type { StripDef } from '../domain/types';

let passCounter = 0;
function nextPassId(kind: string): string {
  return `${kind}-${passCounter++}`;
}

export function makeCutPass(overrides: Partial<CutPass> = {}): CutPass {
  return {
    kind: 'cut',
    id: nextPassId('cut'),
    rip: 0,
    bevel: 90,
    pitch: 50,
    showOffcuts: true,
    mode: 'pattern',
    pattern: 'flipAlternate',
    shift: 25,
    ...overrides,
  };
}

function defaultStrips(): StripDef[] {
  const out: StripDef[] = [];
  for (let i = 0; i < 16; i++) {
    out.push({ species: i % 2 === 0 ? 'maple' : 'walnut', width: 50 });
  }
  return out;
}

/**
 * The shared application state, expressed with Svelte 5 runes so every
 * component that reads it auto-subscribes. Mutating any nested field
 * triggers dependent $effects — the pipeline subscribes once here and
 * rebuilds its Panel graph.
 */
export const appState: AppState = $state({
  strips: defaultStrips(),
  stripHeight: 50,
  stripLength: 400,
  passes: [makeCutPass()],
});
