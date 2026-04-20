/**
 * Reactive host for ArrangeEditList.svelte when mounted imperatively.
 */

import type { ArrangeEditListState, ArrangeEditListChange } from './ArrangeEditList.svelte';
import type { PlaceEdit, SpacerInsert } from '../state/types';

export interface ArrangeEditListHost {
  props: {
    state: ArrangeEditListState;
    allocateId: (prefix: 'edit' | 'spacer') => string;
    onChange: (next: ArrangeEditListChange) => void;
  };
  set: (next: ArrangeEditListState) => void;
}

export function createArrangeEditListHost(
  initial: ArrangeEditListState,
  allocateId: (prefix: 'edit' | 'spacer') => string,
  onChange: (next: ArrangeEditListChange) => void,
): ArrangeEditListHost {
  const props = $state({
    state: cloneState(initial),
    allocateId,
    onChange: (next: ArrangeEditListChange) => {
      // Reflect change back into props.state so the component re-renders
      // from authoritative data (no stale rows after add/remove).
      props.state = {
        ...props.state,
        edits: next.edits.map(cloneEdit),
        spacers: next.spacers.map((s) => ({ ...s })),
      };
      onChange(next);
    },
  });
  return {
    props,
    set(next: ArrangeEditListState): void {
      props.state = cloneState(next);
    },
  };
}

function cloneEdit(e: PlaceEdit): PlaceEdit {
  return {
    kind: 'placeEdit',
    id: e.id,
    target: { ...e.target },
    op: { ...e.op } as PlaceEdit['op'],
    status: e.status,
    ...(e.statusReason ? { statusReason: e.statusReason } : {}),
  };
}

function cloneState(s: ArrangeEditListState): ArrangeEditListState {
  return {
    arrangeId: s.arrangeId,
    edits: s.edits.map(cloneEdit),
    spacers: s.spacers.map((x: SpacerInsert) => ({ ...x })),
    sliceCount: s.sliceCount,
  };
}
