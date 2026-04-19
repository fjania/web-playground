/**
 * Focused harness entry point for the Arrange operation.
 *
 * Reuses the default timeline's compose + cut + arrange triple but
 * pares the input panel down to a legible N-slice count (default 4)
 * and reads URL params to inject per-slice PlaceEdits and
 * SpacerInserts targeting the arrange. This lets the user exercise
 * Arrange in isolation — observing how edits compose, how spacers
 * grow the output, how the cursor-slide layout reassembles — without
 * the noise of the full timeline UI.
 *
 * URL params supported:
 *
 *   Upstream Cut:
 *     ?slices=4       number of slices to feed in
 *     ?rip=30         rip angle (degrees)
 *     ?bevel=60       bevel angle 45..90 (degrees)
 *
 *   Per-slice edits (targeting arrange-0):
 *     ?flip=1,3       rotate 180° on these indices
 *     ?shift=1:25,3:-10   shift mm per slice (sliceIdx:delta)
 *     ?reorder=0,3,1,2    new order — emits reorder edits for slices
 *                         whose output index differs from sliceIdx
 *
 *   Spacers:
 *     ?spacer=1,3            afterSliceIdx list
 *     ?spacerWidth=8         width in mm
 *     ?spacerSpecies=walnut  species
 *
 *   Example:
 *     ?slices=4&flip=1,3&spacer=1&spacerWidth=10
 */

import { initManifold } from '../domain/manifold';
import { defaultTimeline } from './state/defaultTimeline';
import { createIdCounter, allocateId } from './state/ids';
import { runPipeline } from './state/pipeline';
import { buildPanelGroup } from './scene/meshBuilder';
import { setupViewport } from './scene/viewport';
import { summarize, summarizeSlices } from './render/summary';
import { renderArrangeOperation } from './render/operations';
import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
  FeatureResult,
  PlaceEdit,
  SpacerInsert,
  Species,
} from './state/types';

await initManifold();

// ---- Timeline setup ----

const counter = createIdCounter();
const timeline = defaultTimeline(counter);

// Pare the default 8-slice cut down to 4 — gives the arrange room
// to display per-slice annotations without overlap.
const cut = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
if (cut) {
  cut.spacingMode = 'slices';
  cut.slices = 4;
  cut.pitch = 100;
}

const arrangeId = timeline.find((f) => f.kind === 'arrange')?.id ?? 'arrange-0';

const params = new URLSearchParams(window.location.search);

// --- URL param overrides ---

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

// Flip edits — rotate 180° on each listed slice index.
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

// Shift edits — `sliceIdx:delta` pairs.
const shiftParam = params.get('shift');
if (shiftParam) {
  for (const pair of shiftParam.split(',')) {
    const [idxStr, deltaStr] = pair.split(':');
    const idx = Number(idxStr);
    const delta = Number(deltaStr);
    if (!Number.isFinite(idx) || !Number.isFinite(delta)) continue;
    const edit: PlaceEdit = {
      kind: 'placeEdit',
      id: allocateId(counter, 'edit'),
      target: { arrangeId, sliceIdx: Math.floor(idx) },
      op: { kind: 'shift', delta },
      status: 'ok',
    };
    timeline.push(edit);
  }
}

// Reorder — ?reorder=0,3,1,2 says "slice at position i should be
// source slice order[i]". Emit a reorder edit for each slice whose
// output position differs from its source index.
const reorderParam = params.get('reorder');
if (reorderParam) {
  const order = reorderParam
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  for (let newIdx = 0; newIdx < order.length; newIdx++) {
    const sliceIdx = Math.floor(order[newIdx]);
    if (sliceIdx === newIdx) continue;
    const edit: PlaceEdit = {
      kind: 'placeEdit',
      id: allocateId(counter, 'edit'),
      target: { arrangeId, sliceIdx },
      op: { kind: 'reorder', newIdx },
      status: 'ok',
    };
    timeline.push(edit);
  }
}

// Spacers — ?spacer=1,3 puts a spacer after slices 1 and 3.
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

// ---- Run pipeline ----

const output = runPipeline(timeline, { preserveLive: true });
const livePanels = output.livePanels ?? {};
const cutResult = output.results['cut-0'] as CutResult;
const composeResult = output.results['compose-0'] as ComposeStripsResult;
const arrangeResult = output.results[arrangeId] as ArrangeResult;
const livePanel = livePanels[arrangeId];
if (!livePanel) throw new Error('arrange did not preserve live panel');
void composeResult; // reserved for future use

// ---- Input tile: upstream Cut's slices ----

const inputTile = requireTile('cut-0');
const inputSlot = inputTile.querySelector<HTMLElement>('[data-slot="render"]');
if (inputSlot) {
  if (cutResult.slices.length > 0) {
    inputSlot.innerHTML = summarizeSlices(cutResult.slices, { gap: 15 });
  } else {
    inputSlot.innerHTML = '<div class="placeholder">no slices from upstream cut</div>';
  }
}
setSubtitle(
  inputTile,
  `cut-0 · ${cut ? `rip ${cut.rip}° · bevel ${cut.bevel}° · ${cut.slices} slices` : ''}`,
);
setMeta(inputTile, `${cutResult.slices.length} slices feeding arrange`);

// ---- Operation tile: Arrange operation view ----

const opTile = requireTile('arrange-0-op');
const opSlot = opTile.querySelector<HTMLElement>('[data-slot="render"]');
const edits = timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit');
const spacers = timeline.filter((f): f is SpacerInsert => f.kind === 'spacerInsert');
if (opSlot) {
  opSlot.innerHTML = renderArrangeOperation(cutResult, arrangeResult, edits, spacers);
}
const editSummary = edits.length > 0 ? `${edits.length} edit${edits.length === 1 ? '' : 's'}` : 'no edits';
const spacerSummary =
  spacers.length > 0 ? `${spacers.length} spacer${spacers.length === 1 ? '' : 's'}` : 'no spacers';
setSubtitle(opTile, `${arrangeId} · cursor-slide · ${editSummary} · ${spacerSummary}`);
setMeta(
  opTile,
  arrangeResult.appliedEditCount > 0 || arrangeResult.appliedSpacerCount > 0
    ? `applied ${arrangeResult.appliedEditCount} edit${arrangeResult.appliedEditCount === 1 ? '' : 's'}, ` +
        `${arrangeResult.appliedSpacerCount} spacer${arrangeResult.appliedSpacerCount === 1 ? '' : 's'}`
    : 'identity arrange',
);

// ---- Output tile: 3D viewport of the reassembled panel ----

const outputTile = requireTile('arrange-0');
const panelGroup = buildPanelGroup(livePanel);
setupViewport(outputTile, panelGroup);
const bb = arrangeResult.panel.bbox;
const sx = (bb.max[0] - bb.min[0]).toFixed(0);
const sy = (bb.max[1] - bb.min[1]).toFixed(0);
const sz = (bb.max[2] - bb.min[2]).toFixed(0);
setMeta(outputTile, `${arrangeResult.panel.volumes.length} segments · ${sx}×${sy}×${sz} mm`);

// ---- Trace summary in sidebar ----

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
  if ('panel' in r && (r as ArrangeResult | ComposeStripsResult).panel) {
    const pr = r as ArrangeResult | ComposeStripsResult;
    return `${pr.panel.volumes.length} vols`;
  }
  return '';
}

// Mark the imported summarize so the dead-code check doesn't complain —
// we reserve it for future "input tile as full composed panel" view.
void summarize;
