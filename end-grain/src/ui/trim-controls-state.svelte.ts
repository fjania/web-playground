/**
 * Reactive host for TrimControls.svelte when mounted imperatively.
 * See cut-controls-state.svelte.ts for the pattern.
 */

import type { TrimControlsState } from './TrimControls.svelte';

export interface TrimControlsHost {
  props: {
    state: TrimControlsState;
    onChange: (next: TrimControlsState) => void;
  };
  set: (next: TrimControlsState) => void;
}

export function createTrimControlsHost(
  initial: TrimControlsState,
  onChange: (next: TrimControlsState) => void,
): TrimControlsHost {
  const props = $state({
    state: cloneState(initial),
    onChange: (next: TrimControlsState) => {
      props.state = cloneState(next);
      onChange(next);
    },
  });
  return {
    props,
    set(next: TrimControlsState): void {
      props.state = cloneState(next);
    },
  };
}

function cloneState(s: TrimControlsState): TrimControlsState {
  return {
    mode: s.mode,
    bounds: s.bounds ? { ...s.bounds } : undefined,
  };
}
