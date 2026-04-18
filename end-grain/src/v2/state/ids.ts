/**
 * Monotonic ID allocator for v2 state.
 *
 * Rules (per v2.1-design.html §5 and issue #19):
 * - IDs are stable under identity operations (regen doesn't renumber).
 * - IDs are never reused after deletion. If strip-50 is removed and
 *   a new strip allocated, it becomes strip-(N), not strip-50.
 *
 * The allocator is a plain serialisable counter object plus a pure
 * `allocateId` function that bumps it and returns the next id. No
 * module-level mutable state; the counter lives in AppState and is
 * passed around explicitly, so the entire model round-trips through
 * JSON cleanly.
 */

/**
 * Prefixes used in the v2 model. Kept as a type rather than a union
 * of literals so unit tests can allocate arbitrary labels if needed,
 * but feature code should stick to these canonical prefixes.
 */
export type IdPrefix =
  | 'strip'
  | 'compose'
  | 'cut'
  | 'arrange'
  | 'edit'
  | 'preset'
  | 'spacer';

/**
 * Per-prefix counter. The next id for `prefix` will be
 * `${prefix}-${next[prefix] ?? 0}`. After allocation the counter
 * bumps to `next[prefix] + 1`. Missing keys are treated as 0.
 *
 * Serialisable: plain numbers, no functions.
 */
export interface IdCounter {
  next: Partial<Record<string, number>>;
}

export function createIdCounter(): IdCounter {
  return { next: {} };
}

/**
 * Allocate the next id for `prefix` and mutate the counter in place.
 * Returns a string of the form `${prefix}-${n}`.
 *
 * Callers that need functional immutability should clone the counter
 * first; we chose in-place mutation here because IdCounter lives
 * inside AppState and every allocation site already has a write lease
 * on the state.
 */
export function allocateId(counter: IdCounter, prefix: IdPrefix | string): string {
  const n = counter.next[prefix] ?? 0;
  counter.next[prefix] = n + 1;
  return `${prefix}-${n}`;
}

/**
 * Peek the id `allocateId` *would* return next, without bumping the
 * counter. Handy for diagnostics / tests.
 */
export function peekNextId(counter: IdCounter, prefix: IdPrefix | string): string {
  const n = counter.next[prefix] ?? 0;
  return `${prefix}-${n}`;
}
