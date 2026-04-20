/**
 * Reactive host for StripReorder.svelte when mounted imperatively.
 */

import type { ReorderState } from './StripReorder.svelte';

export interface StripReorderHost {
  props: {
    value: ReorderState;
    onChange: (nextOrder: string[]) => void;
  };
  set: (next: ReorderState) => void;
}

export function createStripReorderHost(
  initial: ReorderState,
  onChange: (nextOrder: string[]) => void,
): StripReorderHost {
  const props = $state({
    value: cloneState(initial),
    onChange: (nextOrder: string[]) => {
      // Keep props.value in sync with the committed order.
      props.value = { ...props.value, order: [...nextOrder] };
      onChange(nextOrder);
    },
  });
  return {
    props,
    set(next: ReorderState): void {
      props.value = cloneState(next);
    },
  };
}

function cloneState(s: ReorderState): ReorderState {
  return {
    inventory: s.inventory.map((x) => ({ ...x })),
    order: [...s.order],
    stripLength: s.stripLength,
  };
}
