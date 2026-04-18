/**
 * End-grain v2.4 debug inspector.
 *
 * Pure read-only view over the current Feature timeline and the
 * most recent PipelineOutput. Mounted into the right-side
 * `<aside id="inspector">` of 3d-v2.html.
 *
 * Scope (issue #22):
 *   - Timeline section: one row per Feature (kind, id, params, status).
 *   - Trace section: one row per trace entry in execution order.
 *   - Per-feature result summary (bbox, applied edit/spacer counts,
 *     source attribution).
 *   - JSON copy surface per feature + whole-timeline JSON button.
 *
 * No writes to state. Re-rendering is manual (call refresh()); there
 * are no reactive runes here because authoring UI hasn't arrived yet.
 *
 * This commit (a): layout + toggle only. Timeline and trace sections
 * remain placeholders until the next commits wire them up.
 */

import type { Feature } from '../state/types';
import type { PipelineOutput } from '../state/pipeline';

export interface InspectorMountInput {
  timeline: Feature[];
  output: PipelineOutput;
}

export interface InspectorHandle {
  refresh: (input: InspectorMountInput) => void;
}

export function mountInspector(initial: InspectorMountInput): InspectorHandle {
  const root = document.getElementById('inspector');
  if (!root) throw new Error('inspector: #inspector root not found in DOM');

  // ---- Collapse / expand ----
  const toggleBtn = root.querySelector<HTMLButtonElement>('button[data-role="toggle"]');
  toggleBtn?.addEventListener('click', () => {
    const collapsed = root.dataset.collapsed === 'true';
    root.dataset.collapsed = collapsed ? 'false' : 'true';
  });

  // ---- Body refresh API ----
  let current = initial;
  const render = (): void => {
    renderTimeline(root, current.timeline);
    renderTrace(root, current.output);
  };
  render();

  return {
    refresh(input: InspectorMountInput): void {
      current = input;
      render();
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering — placeholder implementations; filled in by subsequent commits.
// ---------------------------------------------------------------------------

function renderTimeline(root: HTMLElement, timeline: Feature[]): void {
  const section = root.querySelector<HTMLElement>('[data-slot="timeline"]');
  if (!section) return;
  // Commit (a) just confirms the section exists; rows land in (b).
  const pending = section.querySelector<HTMLElement>('.placeholder');
  if (pending) pending.textContent = `${timeline.length} features (rendering pending)`;
}

function renderTrace(root: HTMLElement, output: PipelineOutput): void {
  const section = root.querySelector<HTMLElement>('[data-slot="trace"]');
  if (!section) return;
  const pending = section.querySelector<HTMLElement>('.placeholder');
  if (pending) pending.textContent = `${output.trace.length} entries (rendering pending)`;
}
