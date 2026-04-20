/**
 * Arrange edit list — Svelte 5 adapter.
 *
 * Preserves the imperative mount(el, state, options)→handle API while
 * delegating the DOM to ArrangeEditList.svelte. Used by the workbench
 * canvas to author per-Arrange PlaceEdits + SpacerInserts.
 */

import { mount, unmount } from 'svelte';
import ArrangeEditList from './ArrangeEditList.svelte';
import { createArrangeEditListHost } from './arrange-edit-list-state.svelte';

export type {
  ArrangeEditListState,
  ArrangeEditListChange,
} from './ArrangeEditList.svelte';
import type {
  ArrangeEditListState,
  ArrangeEditListChange,
} from './ArrangeEditList.svelte';

export interface ArrangeEditListOptions {
  allocateId: (prefix: 'edit' | 'spacer') => string;
  onChange: (next: ArrangeEditListChange) => void;
}

export interface ArrangeEditListHandle {
  update: (next: ArrangeEditListState) => void;
  dispose: () => void;
}

export function mountArrangeEditList(
  el: HTMLElement,
  initial: ArrangeEditListState,
  options: ArrangeEditListOptions,
): ArrangeEditListHandle {
  const host = createArrangeEditListHost(
    initial,
    options.allocateId,
    options.onChange,
  );
  el.innerHTML = '';
  const app = mount(ArrangeEditList, { target: el, props: host.props });

  return {
    update(next: ArrangeEditListState): void {
      host.set(next);
    },
    dispose(): void {
      unmount(app);
      el.innerHTML = '';
    },
  };
}
