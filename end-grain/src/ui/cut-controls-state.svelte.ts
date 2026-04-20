/**
 * Reactive host for CutControls.svelte when mounted imperatively from
 * a plain .ts caller (harness / workbench). Runes live here because
 * `$state` is only valid inside .svelte / .svelte.ts modules.
 *
 * The host exposes:
 *   - `props` — an object with `state` and `onChange`, safe to pass as
 *     `mount(CutControls, { props })`. Writes to `state` (via `set`)
 *     flow through to the mounted component reactively.
 *   - `set(next)` — replace the state reactively (used by the
 *     adapter's `update()`).
 */

import type { CutControlsState } from './CutControls.svelte';

export interface CutControlsHost {
  props: {
    state: CutControlsState;
    onChange: (next: CutControlsState) => void;
  };
  set: (next: CutControlsState) => void;
}

export function createCutControlsHost(
  initial: CutControlsState,
  onChange: (next: CutControlsState) => void,
): CutControlsHost {
  const props = $state({
    state: cloneState(initial),
    onChange: (next: CutControlsState) => {
      props.state = cloneState(next);
      onChange(next);
    },
  });
  return {
    props,
    set(next: CutControlsState): void {
      props.state = cloneState(next);
    },
  };
}

function cloneState(s: CutControlsState): CutControlsState {
  return {
    rip: s.rip,
    bevel: s.bevel,
    spacingMode: s.spacingMode,
    pitch: s.pitch,
    slices: s.slices,
    showOffcuts: s.showOffcuts,
  };
}
