/**
 * Trim controls — Svelte 5 adapter.
 *
 * Preserves the imperative mount(el, state, options)→handle API of the
 * original trim-controls.ts while delegating the DOM to
 * TrimControls.svelte. See cut-controls.ts for the same pattern.
 */

import { mount, unmount } from 'svelte';
import TrimControls from './TrimControls.svelte';
import { createTrimControlsHost } from './trim-controls-state.svelte';

export type { TrimControlsState } from './TrimControls.svelte';
import type { TrimControlsState } from './TrimControls.svelte';

export interface TrimControlsOptions {
  onChange: (next: TrimControlsState) => void;
}

export interface TrimControlsHandle {
  update: (next: TrimControlsState) => void;
  dispose: () => void;
}

export function mountTrimControls(
  el: HTMLElement,
  initial: TrimControlsState,
  options: TrimControlsOptions,
): TrimControlsHandle {
  const host = createTrimControlsHost(initial, options.onChange);
  el.innerHTML = '';
  const app = mount(TrimControls, { target: el, props: host.props });

  return {
    update(next: TrimControlsState): void {
      host.set(next);
    },
    dispose(): void {
      unmount(app);
      el.innerHTML = '';
    },
  };
}
