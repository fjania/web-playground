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

import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
  FeatureResult,
  PresetResult,
} from '../state/types';
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
  section.innerHTML = '<h3>Pipeline trace</h3>';
  for (const featureId of output.trace) {
    const result = output.results[featureId];
    if (!result) continue;
    section.appendChild(makeTraceRow(featureId, result));
  }
}

function makeTraceRow(featureId: string, result: FeatureResult): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row trace';
  row.dataset.featureId = featureId;
  row.dataset.expanded = 'false';

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = resultIcon(featureId);
  row.appendChild(icon);

  const body = document.createElement('div');
  const id = document.createElement('span');
  id.className = 'id';
  id.textContent = featureId;
  body.appendChild(id);
  const summary = document.createElement('span');
  summary.className = 'params';
  summary.textContent = resultSummary(result);
  body.appendChild(summary);
  row.appendChild(body);

  const duration = document.createElement('span');
  duration.className = 'duration';
  duration.textContent = '—';
  duration.title = 'durationMs not yet tracked in runPipeline';
  row.appendChild(duration);

  const badge = document.createElement('span');
  badge.className = `badge ${result.status}`;
  badge.textContent = result.status;
  row.appendChild(badge);

  row.addEventListener('click', () => toggleTraceDetail(row, result));

  return row;
}

function toggleTraceDetail(row: HTMLElement, result: FeatureResult): void {
  const expanded = row.dataset.expanded === 'true';
  const existing = row.querySelector<HTMLElement>('.result-detail');
  if (expanded) {
    row.dataset.expanded = 'false';
    existing?.remove();
    return;
  }
  row.dataset.expanded = 'true';
  const detail = document.createElement('pre');
  detail.className = 'result-detail';
  detail.textContent = resultDetail(result);
  row.appendChild(detail);
}

function resultIcon(featureId: string): string {
  // Feature kind is implicit in the id prefix for all v2 ids.
  if (featureId.startsWith('compose')) return KIND_ICON.composeStrips;
  if (featureId.startsWith('cut')) return KIND_ICON.cut;
  if (featureId.startsWith('arrange')) return KIND_ICON.arrange;
  if (featureId.startsWith('edit')) return KIND_ICON.placeEdit;
  if (featureId.startsWith('preset')) return KIND_ICON.preset;
  if (featureId.startsWith('spacer')) return KIND_ICON.spacerInsert;
  return '•';
}

/** One-line summary of what this result produced, shown in the row. */
function resultSummary(result: FeatureResult): string {
  if ('panel' in result) {
    const r = result as ComposeStripsResult | ArrangeResult;
    const b = r.panel.bbox;
    const sx = (b.max[0] - b.min[0]).toFixed(0);
    const sy = (b.max[1] - b.min[1]).toFixed(0);
    const sz = (b.max[2] - b.min[2]).toFixed(0);
    const vols = r.panel.volumes.length;
    if ('appliedEditCount' in r) {
      return `${vols} vols · ${sx}×${sy}×${sz} · ${r.appliedEditCount} edits · ${r.appliedSpacerCount} spacers`;
    }
    return `${vols} vols · ${sx}×${sy}×${sz}`;
  }
  if ('slices' in result) {
    const r = result as CutResult;
    return `${r.slices.length} slices · ${r.offcuts.length} offcuts`;
  }
  if ('expandedPlaceEdits' in result || 'expandedSpacers' in result) {
    const r = result as PresetResult;
    if ('expandedPlaceEdits' in r) return `→ ${r.expandedPlaceEdits.length} edits`;
    return `→ ${r.expandedSpacers.length} spacers`;
  }
  return '';
}

/** Multi-line detailed view shown on click. */
function resultDetail(result: FeatureResult): string {
  const lines: string[] = [];
  if (result.statusReason) lines.push(`reason: ${result.statusReason}`);
  if ('panel' in result) {
    const r = result as ComposeStripsResult | ArrangeResult;
    lines.push(`bbox: [${fmtBox(r.panel.bbox.min)}] → [${fmtBox(r.panel.bbox.max)}]`);
    lines.push(`volumes: ${r.panel.volumes.length}`);
    const speciesCounts = countBy(r.panel.volumes, (v) => v.species);
    lines.push(
      `species: ${Object.entries(speciesCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
    if ('appliedEditCount' in r) {
      lines.push(`applied edits: ${r.appliedEditCount}`);
      if (r.appliedEditSources.length > 0) {
        lines.push(`  sources: ${r.appliedEditSources.join(', ')}`);
      }
      lines.push(`applied spacers: ${r.appliedSpacerCount}`);
      if (r.appliedSpacerSources.length > 0) {
        lines.push(`  sources: ${r.appliedSpacerSources.join(', ')}`);
      }
    }
  }
  if ('slices' in result) {
    const r = result as CutResult;
    lines.push(`slices: ${r.slices.length}`);
    lines.push(`offcuts: ${r.offcuts.length}`);
    const provSample = r.sliceProvenance[0];
    if (provSample) {
      lines.push(
        `slice[0] provenance: [${provSample.contributingStripIds.join(', ')}]`,
      );
    }
  }
  if ('expandedPlaceEdits' in result) {
    const r = result as PresetResult & { expandedPlaceEdits: unknown[] };
    lines.push(`expandedPlaceEdits: ${r.expandedPlaceEdits.length}`);
  }
  if ('expandedSpacers' in result) {
    const r = result as PresetResult & { expandedSpacers: unknown[] };
    lines.push(`expandedSpacers: ${r.expandedSpacers.length}`);
  }
  if (lines.length === 0) lines.push('(no additional detail)');
  return lines.join('\n');
}

function fmtBox(v: [number, number, number]): string {
  return v.map((n) => n.toFixed(1)).join(', ');
}

function countBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) {
    const k = key(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
