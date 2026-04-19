/**
 * Default timeline factory — the starting state of a fresh design.
 *
 * Per v2.1-design.html §4 and issue #19:
 *   - 2 alternating strips (maple, walnut), 50 mm wide each
 *   - stripHeight 50 mm, stripLength 400 mm
 *   - Cut: rip 0°, bevel 90°, pitch 50 mm, offcuts hidden
 *   - Arrange: cursor-slide layout
 *   - Every feature status: 'ok'
 *
 * Uses the shared IdCounter so all ids come from the same monotonic
 * source. Callers that instantiate a fresh design should create a
 * counter, call `defaultTimeline(counter)`, and store both on AppState.
 */

import { allocateId, type IdCounter } from './ids';
import type {
  Arrange,
  ComposeStrips,
  Cut,
  Feature,
  StripDef,
} from './types';

export function defaultTimeline(counter: IdCounter): Feature[] {
  const strips: StripDef[] = [
    { stripId: allocateId(counter, 'strip'), species: 'maple', width: 50 },
    { stripId: allocateId(counter, 'strip'), species: 'walnut', width: 50 },
  ];

  const compose: ComposeStrips = {
    kind: 'composeStrips',
    id: 'compose-0',
    strips,
    stripHeight: 50,
    stripLength: 400,
    status: 'ok',
  };

  // Bump the 'compose' counter so downstream code that allocates a
  // ComposeStrips id sees the seat as taken. (There is only ever one
  // ComposeStrips per design — this is defensive, not load-bearing.)
  allocateId(counter, 'compose');

  const cut: Cut = {
    kind: 'cut',
    id: allocateId(counter, 'cut'),
    rip: 0,
    bevel: 90,
    spacingMode: 'pitch',
    pitch: 50,
    // Slices carries the value the user would see if they switched
    // to slices mode on the default panel (safeExtent=400, so
    // 400/50 = 8). Makes mode-switches preserve the intent.
    slices: 8,
    showOffcuts: false,
    status: 'ok',
  };

  const arrange: Arrange = {
    kind: 'arrange',
    id: allocateId(counter, 'arrange'),
    layout: 'cursor-slide',
    status: 'ok',
  };

  return [compose, cut, arrange];
}
