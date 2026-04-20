/**
 * Cut controls — Svelte 5 adapter.
 *
 * Keeps the original imperative `mount(el, state, options) → handle`
 * API so every existing call site (harness + workbench) stays
 * unchanged, while the underlying DOM is managed by
 * `CutControls.svelte`. The adapter:
 *
 *   1. Creates a reactive state holder via `$state` (in the sibling
 *      `cut-controls-state.svelte.ts` module so runes are allowed).
 *   2. Mounts `CutControls.svelte` against that state.
 *   3. Exposes `update(next)` that writes into the reactive state,
 *      and `dispose()` that unmounts the component and empties the
 *      host element.
 *
 * Once every call site is ported to compose `CutControls.svelte`
 * directly (Step 5 / 6), this file can be deleted.
 */

import { mount, unmount } from 'svelte';
import CutControls from './CutControls.svelte';
import { createCutControlsHost } from './cut-controls-state.svelte';

export type { CutControlsState } from './CutControls.svelte';
import type { CutControlsState } from './CutControls.svelte';

export interface CutControlsOptions {
  onChange: (next: CutControlsState) => void;
}

export interface CutControlsHandle {
  update: (next: CutControlsState) => void;
  dispose: () => void;
}

export function mountCutControls(
  el: HTMLElement,
  initial: CutControlsState,
  options: CutControlsOptions,
): CutControlsHandle {
  const host = createCutControlsHost(initial, options.onChange);
  el.innerHTML = '';
  const app = mount(CutControls, { target: el, props: host.props });

  return {
    update(next: CutControlsState): void {
      host.set(next);
    },
    dispose(): void {
      unmount(app);
      el.innerHTML = '';
    },
  };
}
