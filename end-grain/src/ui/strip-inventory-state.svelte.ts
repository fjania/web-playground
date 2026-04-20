/**
 * Reactive host for StripInventory.svelte when mounted imperatively.
 */

import type { InventoryState } from './StripInventory.svelte';

export interface StripInventoryHost {
  props: {
    state: InventoryState;
    allocateStripId: () => string;
    onChange: (next: InventoryState) => void;
  };
  set: (next: InventoryState) => void;
}

export function createStripInventoryHost(
  initial: InventoryState,
  allocateStripId: () => string,
  onChange: (next: InventoryState) => void,
): StripInventoryHost {
  const props = $state({
    state: cloneState(initial),
    allocateStripId,
    onChange: (next: InventoryState) => {
      // Keep props.state in sync with the committed value so the
      // component re-renders from authoritative data after add/remove.
      props.state = cloneState(next);
      onChange(next);
    },
  });
  return {
    props,
    set(next: InventoryState): void {
      props.state = cloneState(next);
    },
  };
}

function cloneState(s: InventoryState): InventoryState {
  return {
    inventory: s.inventory.map((x) => ({ ...x })),
    order: [...s.order],
    stripHeight: s.stripHeight,
    stripLength: s.stripLength,
  };
}
