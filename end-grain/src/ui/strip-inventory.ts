/**
 * Strip inventory — Svelte 5 adapter.
 *
 * Preserves the imperative mount(el, state, options)→handle API while
 * delegating the DOM to StripInventory.svelte. See cut-controls.ts
 * for the adapter pattern.
 */

import { mount, unmount } from 'svelte';
import StripInventory, {
  MIN_STRIPS as _MIN_STRIPS,
  MAX_STRIPS as _MAX_STRIPS,
} from './StripInventory.svelte';
import { createStripInventoryHost } from './strip-inventory-state.svelte';

export type { InventoryState } from './StripInventory.svelte';
import type { InventoryState } from './StripInventory.svelte';

export const MIN_STRIPS = _MIN_STRIPS;
export const MAX_STRIPS = _MAX_STRIPS;

export interface InventoryMountOptions {
  allocateStripId: () => string;
  onChange: (next: InventoryState) => void;
}

export interface InventoryHandle {
  update: (next: InventoryState) => void;
  dispose: () => void;
}

export function mountStripInventory(
  el: HTMLElement,
  initial: InventoryState,
  options: InventoryMountOptions,
): InventoryHandle {
  const host = createStripInventoryHost(
    initial,
    options.allocateStripId,
    options.onChange,
  );
  el.innerHTML = '';
  const app = mount(StripInventory, { target: el, props: host.props });

  return {
    update(next: InventoryState): void {
      host.set(next);
    },
    dispose(): void {
      unmount(app);
      el.innerHTML = '';
    },
  };
}
