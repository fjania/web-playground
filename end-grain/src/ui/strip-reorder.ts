/**
 * Strip reorder — Svelte 5 adapter.
 *
 * Preserves the imperative mount(el, state, options)→handle API while
 * delegating the DOM + drag logic to StripReorder.svelte. See
 * cut-controls.ts for the adapter pattern.
 */

import { mount, unmount } from 'svelte';
import StripReorder from './StripReorder.svelte';
import { createStripReorderHost } from './strip-reorder-state.svelte';

export type { ReorderState } from './StripReorder.svelte';
import type { ReorderState } from './StripReorder.svelte';

export interface ReorderMountOptions {
  onChange: (nextOrder: string[]) => void;
}

export interface ReorderHandle {
  update: (next: ReorderState) => void;
  dispose: () => void;
}

export function mountStripReorder(
  el: HTMLElement,
  initial: ReorderState,
  options: ReorderMountOptions,
): ReorderHandle {
  const host = createStripReorderHost(initial, options.onChange);
  el.innerHTML = '';
  const app = mount(StripReorder, { target: el, props: host.props });

  return {
    update(next: ReorderState): void {
      host.set(next);
    },
    dispose(): void {
      unmount(app);
      el.innerHTML = '';
    },
  };
}
