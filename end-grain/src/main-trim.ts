/**
 * Focused harness entry point for the TrimPanel operation.
 *
 * Reuses the default timeline's compose + cut + arrange triple,
 * optionally applies upstream Cut / Arrange / Preset knobs (so you
 * can set up a panel with meaningful overhangs to trim), then
 * appends a TrimPanel with the harness's mode + bounds params.
 *
 * Snapshot-is-truth: the Operation tile's trim rect is driven by
 * `TrimPanelResult.appliedBounds` (the pipeline's computed /
 * clamped bounds), never by the URL params. Same contract for the
 * Output tile — it builds a 3D mesh from the trimmed live Panel
 * surfaced under `preserveLive`.
 *
 * URL params supported — see 3d-trim.html's sidebar for the
 * full reference.
 */

import { initManifold } from './domain/manifold';
import { defaultTimeline } from './state/defaultTimeline';
import { createIdCounter, allocateId } from './state/ids';
import { runPipeline } from './state/pipeline';
import { buildPanelGroup } from './scene/meshBuilder';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import { summarize } from './render/summary';
import { renderTrimOperation } from './render/operations';
import {
  mountTrimControls,
  type TrimControlsHandle,
  type TrimControlsState,
} from './ui/trim-controls';
import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
  FeatureResult,
  PlaceEdit,
  Preset,
  SpacerInsert,
  Species,
  TrimPanel,
  TrimPanelResult,
} from './state/types';

await initManifold();

// ---- Timeline setup ----

const counter = createIdCounter();
const timeline = defaultTimeline(counter);

// Default slices to 6 so the arrange produces a panel with enough
// width/length to demonstrate meaningful trim behaviour.
const cut = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
if (cut) {
  cut.spacingMode = 'slices';
  cut.slices = 6;
  cut.pitch = 100;
}

const arrangeId = timeline.find((f) => f.kind === 'arrange')?.id ?? 'arrange-0';

const params = new URLSearchParams(window.location.search);

// ---- Upstream Cut overrides ----

if (cut) {
  const rip = numberParam('rip');
  if (rip !== null) cut.rip = rip;
  const bevel = numberParam('bevel');
  if (bevel !== null) cut.bevel = bevel;
  const slices = numberParam('slices');
  if (slices !== null && slices > 0) {
    cut.slices = Math.floor(slices);
    cut.spacingMode = 'slices';
  }
}

// ---- Upstream Arrange overrides (mirror main-arrange.ts) ----

for (const idx of listParam('flip')) {
  const edit: PlaceEdit = {
    kind: 'placeEdit',
    id: allocateId(counter, 'edit'),
    target: { arrangeId, sliceIdx: idx },
    op: { kind: 'rotate', degrees: 180 },
    status: 'ok',
  };
  timeline.push(edit);
}

const spacerWidth = numberParam('spacerWidth') ?? 5;
const spacerSpecies = (params.get('spacerSpecies') ?? 'walnut') as Species;
for (const afterSliceIdx of listParam('spacer')) {
  const spacer: SpacerInsert = {
    kind: 'spacerInsert',
    id: allocateId(counter, 'spacer'),
    arrangeId,
    afterSliceIdx,
    species: spacerSpecies,
    width: spacerWidth,
    status: 'ok',
  };
  timeline.push(spacer);
}

const presetParam = params.get('preset');
if (presetParam) {
  for (const spec of presetParam.split(',')) {
    const [name, ...rest] = spec.trim().split(':');
    const id = allocateId(counter, 'preset');
    const preset = buildPreset(name, rest, id, arrangeId);
    if (preset) timeline.push(preset);
  }
}

function buildPreset(
  name: string,
  args: string[],
  id: string,
  targetArrange: string,
): Preset | null {
  const base = { kind: 'preset' as const, id, arrangeId: targetArrange, status: 'ok' as const };
  switch (name) {
    case 'flipAlternate':
      return { ...base, preset: 'flipAlternate', params: {} };
    case 'mirrorAlternate':
      return { ...base, preset: 'mirrorAlternate', params: {} };
    case 'rotate4way':
      return { ...base, preset: 'rotate4way', params: {} };
    case 'rotateAlternate': {
      const deg = Number(args[0]);
      if (deg !== 90 && deg !== 180 && deg !== 270) return null;
      return { ...base, preset: 'rotateAlternate', params: { degrees: deg } };
    }
    case 'shiftAlternate': {
      const shift = Number(args[0]);
      if (!Number.isFinite(shift)) return null;
      return { ...base, preset: 'shiftAlternate', params: { shift } };
    }
    case 'spacerEveryRow': {
      const width = Number(args[0]);
      if (!Number.isFinite(width) || width <= 0) return null;
      const species = (args[1] ?? 'walnut') as Species;
      return { ...base, preset: 'spacerEveryRow', params: { species, width } };
    }
    default:
      return null;
  }
}

// ---- TrimPanel feature ----

const trimMode = (params.get('mode') ?? 'flush') as TrimPanel['mode'];
const validModes: TrimPanel['mode'][] = ['flush', 'rectangle', 'bbox'];
const mode: TrimPanel['mode'] = validModes.includes(trimMode) ? trimMode : 'flush';

// ?bounds=xMin,xMax,zMin,zMax — use literal "_" or empty string to
// leave a field undefined (falls back to the panel's bbox extent on
// that axis).
let bounds: TrimPanel['bounds'];
const boundsParam = params.get('bounds');
if (boundsParam) {
  const parts = boundsParam.split(',');
  const parse = (s?: string): number | undefined => {
    if (s === undefined || s === '' || s === '_') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  bounds = {
    xMin: parse(parts[0]),
    xMax: parse(parts[1]),
    zMin: parse(parts[2]),
    zMax: parse(parts[3]),
  };
}

const trimId = allocateId(counter, 'trim');
const trim: TrimPanel = {
  kind: 'trimPanel',
  id: trimId,
  mode,
  ...(bounds ? { bounds } : {}),
  status: 'ok',
};
timeline.push(trim);

// ---- Operation tile: mount TrimControls above the 2D preview ----

const opTile = requireTile('trim-0-op');
const opRenderSlot = opTile.querySelector<HTMLElement>('[data-slot="render"]');
if (!opRenderSlot) throw new Error('trim-0-op tile missing render slot');

opRenderSlot.innerHTML = '';
opRenderSlot.style.display = 'flex';
opRenderSlot.style.flexDirection = 'column';
opRenderSlot.style.gap = '0.4rem';
opRenderSlot.style.padding = '0.5rem';

const opControlsSlot = document.createElement('div');
opControlsSlot.style.background = '#fff';
opControlsSlot.style.border = '1px solid #e4e4e0';
opControlsSlot.style.borderRadius = '4px';
opControlsSlot.style.padding = '0.45rem 0.55rem';
opControlsSlot.style.flex = '0 0 auto';
opRenderSlot.appendChild(opControlsSlot);

const opPreviewSlot = document.createElement('div');
opPreviewSlot.style.flex = '1 1 0';
opPreviewSlot.style.minHeight = '0';
opPreviewSlot.style.display = 'flex';
opPreviewSlot.style.alignItems = 'stretch';
opPreviewSlot.style.justifyContent = 'stretch';
opRenderSlot.appendChild(opPreviewSlot);

const trimControls: TrimControlsHandle = mountTrimControls(
  opControlsSlot,
  trimToControlsState(trim),
  {
    onChange(next) {
      applyControlsState(trim, next);
      rerun();
    },
  },
);
void trimControls;

// ---- Pipeline + render state ----

let viewportHandle: ViewportHandle | null = null;

rerun();

function rerun(): void {
  viewportHandle?.dispose();
  viewportHandle = null;

  const output = runPipeline(timeline, { preserveLive: true });
  const livePanels = output.livePanels ?? {};
  const composeResult = output.results['compose-0'] as ComposeStripsResult;
  const cutResult = output.results['cut-0'] as CutResult;
  const arrangeResult = output.results[arrangeId] as ArrangeResult;
  const trimResult = output.results[trimId] as TrimPanelResult;
  const livePanel = livePanels[trimId];
  if (!livePanel) throw new Error('trim did not preserve live panel');
  void composeResult;
  void cutResult;

  // ---- Input tile: the upstream Arrange's reassembled panel ----
  const inputTile = requireTile(arrangeId);
  const inputSlot = inputTile.querySelector<HTMLElement>('[data-slot="render"]');
  if (inputSlot) inputSlot.innerHTML = summarize(arrangeResult.panel);
  setSubtitle(
    inputTile,
    `${arrangeId} · ${arrangeResult.panel.volumes.length} vols · ${cut ? `rip ${cut.rip}° · bevel ${cut.bevel}°` : ''}`,
  );
  const ab = arrangeResult.panel.bbox;
  const ax = (ab.max[0] - ab.min[0]).toFixed(0);
  const ay = (ab.max[1] - ab.min[1]).toFixed(0);
  const az = (ab.max[2] - ab.min[2]).toFixed(0);
  setMeta(inputTile, `upstream panel ${ax}×${ay}×${az} mm`);

  // ---- Operation preview ----
  opPreviewSlot.innerHTML = renderTrimOperation(arrangeResult.panel, trimResult);
  setSubtitle(
    opTile,
    `${trimId} · mode=${trim.mode}${trimResult.status !== 'ok' ? ' · ' + trimResult.status : ''}`,
  );
  const areaPercent =
    arrangeResult.panel.volumes.length > 0
      ? ((trimResult.trimmedArea / ((ab.max[0] - ab.min[0]) * (ab.max[2] - ab.min[2]))) * 100).toFixed(1)
      : '0';
  setMeta(
    opTile,
    trimResult.trimmedArea > 0
      ? `trimmed ${trimResult.trimmedArea.toFixed(0)} mm² (${areaPercent}% of footprint)`
      : 'identity trim — no material removed',
  );

  // ---- Output tile: 3D ----
  const outputTile = requireTile(trimId);
  const panelGroup = buildPanelGroup(livePanel);
  viewportHandle = setupViewport(outputTile, panelGroup);
  const tb = trimResult.panel.bbox;
  const tx = (tb.max[0] - tb.min[0]).toFixed(0);
  const ty = (tb.max[1] - tb.min[1]).toFixed(0);
  const tz = (tb.max[2] - tb.min[2]).toFixed(0);
  setMeta(outputTile, `trimmed panel ${tx}×${ty}×${tz} mm · ${trimResult.panel.volumes.length} segments`);

  // ---- Sidebar ----
  const boundsSlot = document.querySelector<HTMLElement>('[data-slot="applied-bounds"]');
  if (boundsSlot) {
    const b = trimResult.appliedBounds;
    boundsSlot.textContent =
      `mode       ${trim.mode}\n` +
      `xMin       ${b.xMin.toFixed(2)}\n` +
      `xMax       ${b.xMax.toFixed(2)}\n` +
      `zMin       ${b.zMin.toFixed(2)}\n` +
      `zMax       ${b.zMax.toFixed(2)}\n` +
      `width      ${(b.xMax - b.xMin).toFixed(2)} mm\n` +
      `length     ${(b.zMax - b.zMin).toFixed(2)} mm\n` +
      `trimmed    ${trimResult.trimmedArea.toFixed(2)} mm²` +
      (trimResult.statusReason ? `\n\n${trimResult.status}: ${trimResult.statusReason}` : '');
  }
  const traceSlot = document.querySelector<HTMLElement>('[data-slot="trace"]');
  if (traceSlot) {
    const lines = output.trace.map((id) => {
      const r = output.results[id];
      const status = r?.status ?? '?';
      const extras = briefResult(r);
      return `${id} · ${status}${extras ? ' · ' + extras : ''}`;
    });
    traceSlot.textContent = lines.join('\n');
  }
}

function trimToControlsState(t: TrimPanel): TrimControlsState {
  return {
    mode: t.mode,
    bounds: t.bounds ? { ...t.bounds } : undefined,
  };
}

function applyControlsState(t: TrimPanel, next: TrimControlsState): void {
  t.mode = next.mode;
  if (next.bounds === undefined) {
    delete t.bounds;
  } else {
    t.bounds = { ...next.bounds };
  }
}

// ---- helpers ----

function requireTile(stageId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-stage="${stageId}"]`);
  if (!el) throw new Error(`missing tile data-stage=${stageId}`);
  return el;
}

function setMeta(tile: HTMLElement, text: string): void {
  const slot = tile.querySelector<HTMLElement>('[data-slot="meta"]');
  if (slot) slot.textContent = text;
}

function setSubtitle(tile: HTMLElement, text: string): void {
  const subtitle = tile.querySelector<HTMLElement>('.subtitle');
  if (subtitle) subtitle.textContent = text;
}

function numberParam(key: string): number | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function listParam(key: string): number[] {
  const raw = params.get(key);
  if (raw === null) return [];
  return raw
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n));
}

function briefResult(r: FeatureResult | undefined): string {
  if (!r) return '';
  if ('slices' in r && Array.isArray((r as CutResult).slices)) {
    const cr = r as CutResult;
    return `${cr.slices.length} slices · ${cr.offcuts.length} offcuts`;
  }
  if ('appliedBounds' in r) {
    const tr = r as TrimPanelResult;
    const b = tr.appliedBounds;
    const w = (b.xMax - b.xMin).toFixed(0);
    const l = (b.zMax - b.zMin).toFixed(0);
    return `trimmed to ${w}×${l} mm`;
  }
  if ('panel' in r && (r as ArrangeResult | ComposeStripsResult).panel) {
    const pr = r as ArrangeResult | ComposeStripsResult;
    return `${pr.panel.volumes.length} vols`;
  }
  return '';
}
