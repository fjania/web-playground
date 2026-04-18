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
  section.innerHTML = '<h3>Timeline</h3>';
  for (const f of timeline) {
    section.appendChild(makeTimelineRow(f));
  }
}

function makeTimelineRow(f: Feature): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.featureId = f.id;

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = KIND_ICON[f.kind] ?? '•';
  row.appendChild(icon);

  const body = document.createElement('div');
  const id = document.createElement('span');
  id.className = 'id';
  id.textContent = f.id;
  body.appendChild(id);

  const params = document.createElement('span');
  params.className = 'params';
  params.textContent = paramsSummary(f);
  body.appendChild(params);
  row.appendChild(body);

  const badge = document.createElement('span');
  badge.className = `badge ${f.status}`;
  badge.textContent = f.status;
  row.appendChild(badge);

  return row;
}

const KIND_ICON: Record<Feature['kind'], string> = {
  composeStrips: '▤',
  cut: '⫽',
  arrange: '▦',
  placeEdit: '✎',
  preset: '⚙',
  spacerInsert: '┃',
};

function paramsSummary(f: Feature): string {
  switch (f.kind) {
    case 'composeStrips': {
      const total = f.strips.reduce((s, st) => s + st.width, 0);
      return `${f.strips.length} strips · ${total}×${f.stripHeight}×${f.stripLength}`;
    }
    case 'cut':
      return `rip ${f.rip}° · bevel ${f.bevel}° · pitch ${f.pitch}`;
    case 'arrange':
      return f.layout;
    case 'placeEdit': {
      const op = f.op;
      const opStr =
        op.kind === 'rotate'
          ? `rotate ${op.degrees}°`
          : op.kind === 'shift'
            ? `shift ${op.delta}`
            : `reorder → ${op.newIdx}`;
      return `${f.target.arrangeId}[${f.target.sliceIdx}] · ${opStr}`;
    }
    case 'preset':
      return `${f.preset} → ${f.arrangeId}`;
    case 'spacerInsert':
      return `${f.arrangeId} after ${f.afterSliceIdx} · ${f.species} ${f.width}mm`;
  }
}

function renderTrace(root: HTMLElement, output: PipelineOutput): void {
  const section = root.querySelector<HTMLElement>('[data-slot="trace"]');
  if (!section) return;
  const pending = section.querySelector<HTMLElement>('.placeholder');
  if (pending) pending.textContent = `${output.trace.length} entries (rendering pending)`;
}
