/**
 * Cutting-board workbench — the integrated canvas for M1.
 *
 * Layout: timeline ribbon (left) · hero 3D (top) · pipeline stages
 * (below, scrolling). One 2D preview per stage + controls in the
 * same card; focused stage expands and shows a third panel with an
 * inline 3D viewport.
 *
 * Guarantees:
 *   - At most 2 WebGL viewports active at any time. The hero always
 *     shows the final panel; focused stages add a second viewport
 *     for their own output. If the last op (Trim) is focused, the
 *     "focused" viewport and the hero show the same panel — we
 *     deliberately skip mounting a duplicate, keeping the budget at 1.
 *   - Snapshot-is-truth: every 2D preview is derived from the
 *     pipeline's output snapshots via the shared renderers used by
 *     the harnesses. Every 3D viewport is built from a live Panel
 *     surfaced under `preserveLive`.
 *   - Shared authoring components: Compose uses the same
 *     strip-inventory + strip-reorder modules as the harness; Cut
 *     and Trim use the shared cut-controls / trim-controls; Arrange
 *     uses arrange-edit-list (canvas-only in M1, lifted back into
 *     the harness later).
 *
 * Persistence:
 *   - Autosave to localStorage under key
 *     `end-grain:workbench:${designName}`.
 *   - `?design=<name>` URL param selects which design to load. Missing
 *     = "untitled". Design name is editable via the header input;
 *     rename triggers a move in localStorage and updates the URL
 *     without a full reload.
 */

import { initManifold } from './domain/manifold';
import { allocateId, createIdCounter, type IdCounter, type IdPrefix } from './state/ids';
import { runPipeline, type PipelineOutput } from './state/pipeline';
import { Group } from 'three';
import { buildPanelGroup } from './scene/meshBuilder';
import type { Panel } from './domain/Panel';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import { summarize } from './render/summary';
import {
  renderCutOperation,
  renderArrangeOperation,
  renderTrimOperation,
} from './render/operations';
import {
  mountStripInventory,
  type InventoryHandle,
} from './ui/strip-inventory';
import {
  mountStripReorder,
  type ReorderHandle,
} from './ui/strip-reorder';
import {
  mountCutControls,
  type CutControlsHandle,
} from './ui/cut-controls';
import {
  mountTrimControls,
  type TrimControlsHandle,
} from './ui/trim-controls';
import {
  mountArrangeEditList,
  type ArrangeEditListHandle,
} from './ui/arrange-edit-list';
import type {
  Arrange,
  ArrangeResult,
  ComposeStrips,
  ComposeStripsResult,
  Cut,
  CutResult,
  Feature,
  PlaceEdit,
  SpacerInsert,
  StripDef,
  TrimPanel,
  TrimPanelResult,
} from './state/types';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

await initManifold();

interface WorkbenchState {
  designName: string;
  timeline: Feature[];
  focusedStageId: string | null;
  idCounter: IdCounter;
}

// Hoisted so loadInitialState (run at module-init time) can reference
// them before the persistence section's const-declarations execute.
const SAVE_PREFIX = 'end-grain:workbench:';
interface StoredDesign {
  version: 1;
  timeline: Feature[];
  savedAt: number;
}

const urlParams = new URLSearchParams(window.location.search);
let state: WorkbenchState = loadInitialState(urlParams.get('design'));
syncUrlToDesignName(state.designName);

// DOM slots
const designNameInput = requireSlot('design-name') as HTMLInputElement;
const saveStatusEl = requireSlot('save-status');
const timelineListEl = requireSlot('timeline-list');
const pipelineEl = requireSlot('pipeline');
const heroViewportSlot = requireSlot('hero-viewport');
const heroSubEl = requireSlot('hero-sub');

designNameInput.value = state.designName;
designNameInput.addEventListener('change', () => {
  const next = sanitizeDesignName(designNameInput.value) || 'untitled';
  renameCurrentDesign(next);
});
designNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') designNameInput.blur();
});

// Live viewports
let heroViewport: ViewportHandle | null = null;
let focusedViewport: ViewportHandle | null = null;
let lastOutput: PipelineOutput | null = null;
let saveTimer: number | null = null;

// Per-stage mounted components. Keyed by stage id.
interface StageMount {
  cardEl: HTMLElement;
  controlsHandle?:
    | { kind: 'compose-inventory'; h: InventoryHandle; reorder: ReorderHandle }
    | { kind: 'cut'; h: CutControlsHandle }
    | { kind: 'arrange'; h: ArrangeEditListHandle }
    | { kind: 'trim'; h: TrimControlsHandle };
  previewEl: HTMLElement;
  viewportSlot?: HTMLElement;
}
const stageMounts = new Map<string, StageMount>();

buildInitialDom();
rerun();

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadInitialState(designParam: string | null): WorkbenchState {
  const rawName = designParam ? sanitizeDesignName(designParam) : '';
  const designName = rawName || 'untitled';
  const stored = loadDesign(designName);
  if (stored) {
    return {
      designName,
      timeline: stored.timeline,
      focusedStageId: null,
      idCounter: counterFromTimeline(stored.timeline),
    };
  }
  // Pre-populated default timeline
  const counter = createIdCounter();
  const timeline = defaultWorkbenchTimeline(counter);
  return { designName, timeline, focusedStageId: null, idCounter: counter };
}

function defaultWorkbenchTimeline(counter: IdCounter): Feature[] {
  const strips: StripDef[] = [
    { stripId: allocateId(counter, 'strip'), species: 'maple', width: 50 },
    { stripId: allocateId(counter, 'strip'), species: 'walnut', width: 50 },
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
  allocateId(counter, 'compose'); // seat the compose counter

  const cut: Cut = {
    kind: 'cut',
    id: allocateId(counter, 'cut'),
    rip: 0,
    bevel: 90,
    spacingMode: 'slices',
    pitch: 50,
    slices: 4,
    showOffcuts: false,
    status: 'ok',
  };
  const arrange: Arrange = {
    kind: 'arrange',
    id: allocateId(counter, 'arrange'),
    layout: 'cursor-slide',
    status: 'ok',
  };
  const trim: TrimPanel = {
    kind: 'trimPanel',
    id: allocateId(counter, 'trim' as IdPrefix),
    mode: 'flush',
    status: 'ok',
  };
  return [compose, cut, arrange, trim];
}

function counterFromTimeline(timeline: Feature[]): IdCounter {
  const counter = createIdCounter();
  const record = (prefix: string, id: string) => {
    const m = id.match(/^([a-z]+)-(\d+)$/);
    if (!m) return;
    const [, p, n] = m;
    const num = Number(n);
    counter.next[p] = Math.max(counter.next[p] ?? 0, num + 1);
    void prefix;
  };
  for (const f of timeline) {
    record('', f.id);
    if (f.kind === 'composeStrips') {
      for (const s of f.strips) record('strip', s.stripId);
    }
  }
  return counter;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadDesign(designName: string): StoredDesign | null {
  const raw = localStorage.getItem(SAVE_PREFIX + designName);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDesign;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.timeline)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function scheduleSave(): void {
  setSaveStatus('saving');
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const payload: StoredDesign = {
      version: 1,
      timeline: state.timeline,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_PREFIX + state.designName, JSON.stringify(payload));
    setSaveStatus('saved');
  }, 300);
}

function setSaveStatus(status: 'saving' | 'saved' | 'idle'): void {
  saveStatusEl.classList.remove('saving', 'saved');
  if (status === 'saving') {
    saveStatusEl.classList.add('saving');
    saveStatusEl.textContent = 'saving…';
  } else if (status === 'saved') {
    saveStatusEl.classList.add('saved');
    saveStatusEl.textContent = 'saved';
  } else {
    saveStatusEl.textContent = '';
  }
}

function renameCurrentDesign(nextName: string): void {
  if (nextName === state.designName) return;
  const oldKey = SAVE_PREFIX + state.designName;
  const newKey = SAVE_PREFIX + nextName;
  const existing = localStorage.getItem(oldKey);
  if (existing !== null) {
    localStorage.setItem(newKey, existing);
    localStorage.removeItem(oldKey);
  }
  state.designName = nextName;
  designNameInput.value = nextName;
  syncUrlToDesignName(nextName);
  scheduleSave();
}

function sanitizeDesignName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function syncUrlToDesignName(name: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('design', name);
  window.history.replaceState(null, '', url);
}

// ---------------------------------------------------------------------------
// DOM: timeline + stage cards (built once)
// ---------------------------------------------------------------------------

function buildInitialDom(): void {
  // Build one stage card per main op in the timeline. Order is fixed:
  // Compose → Cut → Arrange → Trim.
  pipelineEl.innerHTML = '';
  stageMounts.clear();

  const mainOps = mainOpFeatures(state.timeline);
  mainOps.forEach((feature, i) => {
    if (i > 0) {
      const flow = document.createElement('div');
      flow.className = 'flow';
      flow.textContent = '↓';
      pipelineEl.appendChild(flow);
    }

    const card = document.createElement('article');
    card.className = 'stage';
    card.dataset.stage = feature.id;
    card.addEventListener('click', (e) => {
      // Ignore clicks from within controls so sliders/inputs don't
      // toggle focus.
      if ((e.target as Element).closest(
        '.cut-controls, .trim-controls, .arrange-edit-list, .strip-inventory, .strip-reorder, input, select, button',
      )) return;
      setFocusedStage(card.dataset.stage === state.focusedStageId ? null : feature.id);
    });

    // Header
    const header = document.createElement('header');
    const h3 = document.createElement('h3');
    h3.textContent = labelFor(feature);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.dataset.slot = 'sub';
    const warnInline = document.createElement('span');
    warnInline.className = 'warn-inline';
    warnInline.dataset.slot = 'warn-inline';
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'focused';
    badge.style.display = 'none';
    badge.dataset.slot = 'badge';
    header.appendChild(h3);
    header.appendChild(sub);
    header.appendChild(warnInline);
    header.appendChild(spacer);
    header.appendChild(badge);
    card.appendChild(header);

    // Body: controls | preview (| 3d when focused)
    const body = document.createElement('div');
    body.className = 'stage-body';

    const controlsPanel = document.createElement('section');
    controlsPanel.className = 'panel controls p-ctrl';
    controlsPanel.innerHTML = `<div class="p-head">Controls</div><div class="p-body"></div>`;
    const controlsBody = controlsPanel.querySelector('.p-body') as HTMLElement;

    const previewPanel = document.createElement('section');
    previewPanel.className = 'panel p-preview';
    previewPanel.innerHTML = `<div class="p-head" data-slot="preview-head">Preview</div><div class="p-body" data-slot="preview-body"></div>`;
    const previewEl = previewPanel.querySelector('[data-slot="preview-body"]') as HTMLElement;

    body.appendChild(controlsPanel);
    body.appendChild(previewPanel);

    card.appendChild(body);
    pipelineEl.appendChild(card);

    // Mount the feature-specific control component
    const mount: StageMount = { cardEl: card, previewEl };
    if (feature.kind === 'composeStrips') {
      mount.controlsHandle = mountComposeControls(controlsBody, feature);
    } else if (feature.kind === 'cut') {
      mount.controlsHandle = mountCutControlsForStage(controlsBody, feature);
    } else if (feature.kind === 'arrange') {
      mount.controlsHandle = mountArrangeControlsForStage(controlsBody, feature);
    } else if (feature.kind === 'trimPanel') {
      mount.controlsHandle = mountTrimControlsForStage(controlsBody, feature);
    }
    stageMounts.set(feature.id, mount);
  });
}

function labelFor(f: Feature): string {
  switch (f.kind) {
    case 'composeStrips': return 'Compose';
    case 'cut': return 'Cut';
    case 'arrange': return 'Arrange';
    case 'trimPanel': return 'Trim';
    default: return f.kind;
  }
}

function mainOpFeatures(timeline: Feature[]): Array<ComposeStrips | Cut | Arrange | TrimPanel> {
  return timeline.filter(
    (f): f is ComposeStrips | Cut | Arrange | TrimPanel =>
      f.kind === 'composeStrips' ||
      f.kind === 'cut' ||
      f.kind === 'arrange' ||
      f.kind === 'trimPanel',
  );
}

// ---------------------------------------------------------------------------
// Per-feature control mounts
// ---------------------------------------------------------------------------

function mountComposeControls(
  el: HTMLElement,
  compose: ComposeStrips,
): StageMount['controlsHandle'] {
  // The Compose stage needs BOTH the inventory editor (species/width
  // rows) AND the drag-to-reorder surface. The inventory goes in the
  // controls pane here; the reorder goes in the preview pane — so
  // this function returns both handles, and the caller wires the
  // reorder mount separately in renderStageContent().
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.gap = '0.3rem';
  el.style.padding = '0.4rem 0.5rem';
  el.style.minHeight = '0';

  const order: string[] = compose.strips.map((s) => s.stripId);
  const invHandle = mountStripInventory(
    el,
    {
      inventory: compose.strips,
      order,
      stripHeight: compose.stripHeight,
      stripLength: compose.stripLength,
    },
    {
      allocateStripId: () => allocateId(state.idCounter, 'strip'),
      onChange: (next) => {
        compose.strips = next.inventory;
        compose.stripHeight = next.stripHeight;
        compose.stripLength = next.stripLength;
        // Keep compose.strips order in sync with next.order (the
        // inventory component owns it).
        const byId = new Map(next.inventory.map((s) => [s.stripId, s]));
        compose.strips = next.order
          .map((id) => byId.get(id))
          .filter((s): s is StripDef => s !== undefined);
        rerun();
      },
    },
  );

  // Reorder handle populated lazily when the preview renders
  return { kind: 'compose-inventory', h: invHandle, reorder: null as unknown as ReorderHandle };
}

function mountCutControlsForStage(
  el: HTMLElement,
  cut: Cut,
): StageMount['controlsHandle'] {
  const handle = mountCutControls(
    el,
    {
      rip: cut.rip,
      bevel: cut.bevel,
      spacingMode: cut.spacingMode,
      pitch: cut.pitch,
      slices: cut.slices,
      showOffcuts: cut.showOffcuts,
    },
    {
      onChange: (next) => {
        cut.rip = next.rip;
        cut.bevel = next.bevel;
        cut.spacingMode = next.spacingMode;
        cut.pitch = next.pitch;
        cut.slices = next.slices;
        cut.showOffcuts = next.showOffcuts;
        rerun();
      },
    },
  );
  return { kind: 'cut', h: handle };
}

function mountArrangeControlsForStage(
  el: HTMLElement,
  arrange: Arrange,
): StageMount['controlsHandle'] {
  const handle = mountArrangeEditList(
    el,
    {
      arrangeId: arrange.id,
      edits: state.timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit' && f.target.arrangeId === arrange.id),
      spacers: state.timeline.filter((f): f is SpacerInsert => f.kind === 'spacerInsert' && f.arrangeId === arrange.id),
      sliceCount: currentSliceCount(),
    },
    {
      allocateId: (prefix) => allocateId(state.idCounter, prefix),
      onChange: (next) => {
        // Replace the PlaceEdits/SpacerInserts for this arrange in
        // the timeline wholesale. Keep every other feature unchanged.
        const filtered = state.timeline.filter(
          (f) =>
            !(f.kind === 'placeEdit' && f.target.arrangeId === arrange.id) &&
            !(f.kind === 'spacerInsert' && f.arrangeId === arrange.id),
        );
        state.timeline = [...filtered, ...next.edits, ...next.spacers];
        rerun();
      },
    },
  );
  return { kind: 'arrange', h: handle };
}

function mountTrimControlsForStage(
  el: HTMLElement,
  trim: TrimPanel,
): StageMount['controlsHandle'] {
  const handle = mountTrimControls(
    el,
    { mode: trim.mode, bounds: trim.bounds ? { ...trim.bounds } : undefined },
    {
      onChange: (next) => {
        trim.mode = next.mode;
        if (next.bounds === undefined) delete trim.bounds;
        else trim.bounds = { ...next.bounds };
        rerun();
      },
    },
  );
  return { kind: 'trim', h: handle };
}

function currentSliceCount(): number {
  // The arrange-edit-list needs to bound slice-idx inputs; read the
  // latest CutResult's slice count if available, else fall back to 0.
  // Called pre-rerun so we peek the last output via a module var.
  return lastOutput?.results ? sliceCountFromOutput(lastOutput) : 0;
}

function sliceCountFromOutput(output: PipelineOutput): number {
  for (const id of output.trace) {
    const r = output.results[id];
    if (r && 'slices' in r && Array.isArray((r as CutResult).slices)) {
      return (r as CutResult).slices.length;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Rerun: pipeline + render
// ---------------------------------------------------------------------------

function rerun(): void {
  const output = runPipeline(state.timeline, { preserveLive: true });
  lastOutput = output;

  renderTimelineRibbon(output);
  renderPipelineStages(output);
  renderHero(output);

  scheduleSave();
}

function setFocusedStage(next: string | null): void {
  if (state.focusedStageId === next) return;
  state.focusedStageId = next;
  // No pipeline change, just re-render the pipeline stages + hero
  // (to manage viewport allocation).
  if (lastOutput) {
    renderPipelineStages(lastOutput);
    renderHero(lastOutput);
    renderTimelineRibbon(lastOutput);
  }
}

// ---------------------------------------------------------------------------
// Timeline ribbon render
// ---------------------------------------------------------------------------

function renderTimelineRibbon(output: PipelineOutput): void {
  timelineListEl.innerHTML = '';

  const mainOps = mainOpFeatures(state.timeline);
  mainOps.forEach((f, i) => {
    if (i > 0) {
      const c = document.createElement('div');
      c.className = 't-connector';
      timelineListEl.appendChild(c);
    }
    const item = document.createElement('div');
    item.className = 't-item';
    const result = output.results[f.id];
    const status = result?.status ?? 'ok';
    if (status === 'warning') item.classList.add('warn');
    if (status === 'error') item.classList.add('err');
    if (state.focusedStageId === f.id) item.classList.add('active');

    const op = document.createElement('span');
    op.className = 'op';
    op.textContent = labelFor(f);
    item.appendChild(op);

    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = subForFeature(f, output);
    item.appendChild(sub);

    item.addEventListener('click', () => {
      setFocusedStage(state.focusedStageId === f.id ? null : f.id);
    });

    timelineListEl.appendChild(item);
  });
}

function subForFeature(f: Feature, output: PipelineOutput): string {
  switch (f.kind) {
    case 'composeStrips': {
      const total = f.strips.reduce((n, s) => n + s.width, 0);
      return `${f.strips.length} strips · ${total} mm`;
    }
    case 'cut': {
      const r = output.results[f.id] as CutResult | undefined;
      const dense = f.spacingMode === 'slices' ? `${f.slices} slices` : `pitch ${f.pitch}`;
      return `${dense} · rip ${f.rip}°` + (r ? ` · ${r.slices.length} out` : '');
    }
    case 'arrange': {
      const r = output.results[f.id] as ArrangeResult | undefined;
      return r ? `${r.appliedEditCount} edits · ${r.appliedSpacerCount} spacers` : '';
    }
    case 'trimPanel': {
      const r = output.results[f.id] as TrimPanelResult | undefined;
      if (!r) return f.mode;
      const w = (r.appliedBounds.xMax - r.appliedBounds.xMin).toFixed(0);
      const l = (r.appliedBounds.zMax - r.appliedBounds.zMin).toFixed(0);
      return `${f.mode} · ${w}×${l}`;
    }
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Pipeline-stage render (per-frame)
// ---------------------------------------------------------------------------

function renderPipelineStages(output: PipelineOutput): void {
  focusedViewport?.dispose();
  focusedViewport = null;

  const mainOps = mainOpFeatures(state.timeline);
  for (const feature of mainOps) {
    const mount = stageMounts.get(feature.id);
    if (!mount) continue;
    updateStageCard(mount, feature, output);
  }
}

function updateStageCard(
  mount: StageMount,
  feature: Feature,
  output: PipelineOutput,
): void {
  const card = mount.cardEl;
  const isFocused = state.focusedStageId === feature.id;
  card.classList.toggle('focused', isFocused);
  const badge = card.querySelector<HTMLElement>('[data-slot="badge"]');
  if (badge) badge.style.display = isFocused ? '' : 'none';

  const sub = card.querySelector<HTMLElement>('[data-slot="sub"]');
  if (sub) sub.textContent = subForFeature(feature, output);

  const warn = card.querySelector<HTMLElement>('[data-slot="warn-inline"]');
  const result = output.results[feature.id];
  if (warn) {
    if (result && result.status !== 'ok' && result.statusReason) {
      warn.textContent = `· ${result.status}: ${result.statusReason}`;
    } else {
      warn.textContent = '';
    }
  }

  // Update controls handles with the latest state.
  syncControlsToFeature(mount, feature, output);

  // Render 2D preview.
  renderStagePreview(mount, feature, output);

  // Manage the 3D viewport panel on this stage.
  manageStage3D(mount, feature, output, isFocused);
}

function syncControlsToFeature(
  mount: StageMount,
  feature: Feature,
  output: PipelineOutput,
): void {
  if (!mount.controlsHandle) return;
  const h = mount.controlsHandle;
  if (h.kind === 'compose-inventory' && feature.kind === 'composeStrips') {
    h.h.update({
      inventory: feature.strips,
      order: feature.strips.map((s) => s.stripId),
      stripHeight: feature.stripHeight,
      stripLength: feature.stripLength,
    });
    if (h.reorder) {
      h.reorder.update({
        inventory: feature.strips,
        order: feature.strips.map((s) => s.stripId),
        stripLength: feature.stripLength,
      });
    }
  } else if (h.kind === 'cut' && feature.kind === 'cut') {
    h.h.update({
      rip: feature.rip,
      bevel: feature.bevel,
      spacingMode: feature.spacingMode,
      pitch: feature.pitch,
      slices: feature.slices,
      showOffcuts: feature.showOffcuts,
    });
  } else if (h.kind === 'arrange' && feature.kind === 'arrange') {
    h.h.update({
      arrangeId: feature.id,
      edits: state.timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit' && f.target.arrangeId === feature.id),
      spacers: state.timeline.filter((f): f is SpacerInsert => f.kind === 'spacerInsert' && f.arrangeId === feature.id),
      sliceCount: sliceCountFromOutput(output),
    });
  } else if (h.kind === 'trim' && feature.kind === 'trimPanel') {
    h.h.update({
      mode: feature.mode,
      bounds: feature.bounds ? { ...feature.bounds } : undefined,
    });
  }
}

function renderStagePreview(
  mount: StageMount,
  feature: Feature,
  output: PipelineOutput,
): void {
  const previewEl = mount.previewEl;
  const composeResult = output.results['compose-0'] as ComposeStripsResult | undefined;
  if (feature.kind === 'composeStrips') {
    // Reorder UI inside the preview pane.
    mount.previewEl.innerHTML = '';
    mount.previewEl.style.padding = '0.45rem';
    mount.previewEl.style.background = '#f6f5f1';
    const h = mount.controlsHandle;
    if (h && h.kind === 'compose-inventory') {
      const order = feature.strips.map((s) => s.stripId);
      if (!h.reorder) {
        h.reorder = mountStripReorder(
          mount.previewEl,
          { inventory: feature.strips, order, stripLength: feature.stripLength },
          {
            onChange: (nextOrder) => {
              const byId = new Map(feature.strips.map((s) => [s.stripId, s]));
              feature.strips = nextOrder
                .map((id) => byId.get(id))
                .filter((s): s is StripDef => s !== undefined);
              rerun();
            },
          },
        );
      } else {
        h.reorder.update({ inventory: feature.strips, order, stripLength: feature.stripLength });
      }
    }
    return;
  }

  if (feature.kind === 'cut' && composeResult) {
    const cr = output.results[feature.id] as CutResult | undefined;
    if (cr) previewEl.innerHTML = renderCutOperation(composeResult.panel, cr);
    return;
  }
  if (feature.kind === 'arrange') {
    const cutResult = firstCutResult(output);
    const ar = output.results[feature.id] as ArrangeResult | undefined;
    if (cutResult && ar) {
      const edits = state.timeline.filter(
        (f): f is PlaceEdit => f.kind === 'placeEdit' && f.target.arrangeId === feature.id,
      );
      const spacers = state.timeline.filter(
        (f): f is SpacerInsert => f.kind === 'spacerInsert' && f.arrangeId === feature.id,
      );
      previewEl.innerHTML = renderArrangeOperation(cutResult, ar, edits, spacers);
    }
    return;
  }
  if (feature.kind === 'trimPanel') {
    const ar = lastArrangeResult(output);
    const tr = output.results[feature.id] as TrimPanelResult | undefined;
    if (ar && tr) previewEl.innerHTML = renderTrimOperation(ar.panel, tr);
    return;
  }
}

function manageStage3D(
  mount: StageMount,
  feature: Feature,
  output: PipelineOutput,
  isFocused: boolean,
): void {
  const card = mount.cardEl;
  const body = card.querySelector<HTMLElement>('.stage-body');
  if (!body) return;
  // Find or remove the 3D panel.
  let panel3d = body.querySelector<HTMLElement>('.panel.p-3d');

  if (!isFocused) {
    if (panel3d) panel3d.remove();
    mount.viewportSlot = undefined;
    return;
  }

  // Focused. Skip mounting if this is the last op (Trim) — hero
  // already renders its output and we don't want a duplicate
  // viewport. Instead just suppress; the hero is the focused view.
  const lastMainOp = lastMainOp_(state.timeline);
  if (lastMainOp && feature.id === lastMainOp.id) {
    if (panel3d) panel3d.remove();
    mount.viewportSlot = undefined;
    return;
  }

  if (!panel3d) {
    panel3d = document.createElement('section');
    panel3d.className = 'panel view-3d p-3d';
    panel3d.innerHTML = `<div class="p-head">3D · post-${labelFor(feature)}</div><div class="p-body"></div>`;
    body.appendChild(panel3d);
  }
  const body3d = panel3d.querySelector<HTMLElement>('.p-body');
  if (!body3d) return;
  mount.viewportSlot = body3d;

  // Mount the focused viewport. Dispose any previously-mounted one
  // before re-mounting.
  focusedViewport?.dispose();
  focusedViewport = null;

  const livePanels = output.livePanels ?? {};
  const liveCutSlices = output.liveCutSlices ?? {};

  if (feature.kind === 'cut') {
    // Cut surfaces its output as an array of slice Panels, not a
    // single livePanel. Assemble them into an exploded stack.
    const slices = liveCutSlices[feature.id] ?? [];
    if (slices.length === 0) return;
    focusedViewport = setupViewport(body3d, buildSlicesGroup(slices));
    return;
  }

  const live = livePanels[feature.id];
  if (!live) return;
  focusedViewport = setupViewport(body3d, buildPanelGroup(live));
}

/**
 * Assemble a Group of exploded slices for the focused Cut stage's
 * 3D viewport. Simple +Z-along-stack layout with a small gap — the
 * Cut harness has a fancier version that tags offcuts; M1 keeps it
 * simple.
 */
function buildSlicesGroup(slices: Panel[]): Group {
  const group = new Group();
  if (slices.length === 0) return group;
  // Gap = panel Y thickness, same heuristic as the Cut harness.
  const firstBB = slices[0].boundingBox();
  const gap = firstBB.max.y - firstBB.min.y;
  const centerIdx = (slices.length - 1) / 2;
  slices.forEach((slice, i) => {
    const g = buildPanelGroup(slice);
    g.position.z = (i - centerIdx) * gap;
    group.add(g);
  });
  return group;
}

function lastMainOp_(timeline: Feature[]): Feature | null {
  const mains = mainOpFeatures(timeline);
  return mains.length > 0 ? mains[mains.length - 1] : null;
}

function lastArrangeResult(output: PipelineOutput): ArrangeResult | null {
  for (let i = output.trace.length - 1; i >= 0; i--) {
    const r = output.results[output.trace[i]];
    if (r && 'appliedEditCount' in r) return r as ArrangeResult;
  }
  return null;
}

function firstCutResult(output: PipelineOutput): CutResult | null {
  for (const id of output.trace) {
    const r = output.results[id];
    if (r && 'slices' in r && Array.isArray((r as CutResult).slices)) {
      return r as CutResult;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hero render — always-on final 3D
// ---------------------------------------------------------------------------

function renderHero(output: PipelineOutput): void {
  heroViewport?.dispose();
  heroViewport = null;
  heroViewportSlot.innerHTML = '';

  const lastOp = lastMainOp_(state.timeline);
  if (!lastOp) return;
  const livePanels = output.livePanels ?? {};
  const live = livePanels[lastOp.id];
  if (!live) {
    // Fall back to the last successful panel if the final op errored.
    for (let i = output.trace.length - 1; i >= 0; i--) {
      const id = output.trace[i];
      if (livePanels[id]) {
        const fb = livePanels[id];
        heroViewport = setupViewport(heroViewportSlot, buildPanelGroup(fb), { vertical: 'x' });
        heroSubEl.textContent = `fallback from ${id}`;
        return;
      }
    }
    heroSubEl.textContent = 'pipeline produced no live panel';
    return;
  }

  // Orientation: the compose harness uses vertical='x' so stacking
  // reads top-to-bottom. For the workbench we keep the standard
  // vertical='z' (X horizontal, Z down) so Cut's top view matches
  // the preview tiles.
  heroViewport = setupViewport(heroViewportSlot, buildPanelGroup(live));
  const bb = live.boundingBox();
  const x = (bb.max.x - bb.min.x).toFixed(0);
  const y = (bb.max.y - bb.min.y).toFixed(0);
  const z = (bb.max.z - bb.min.z).toFixed(0);
  heroSubEl.textContent = `${x}×${y}×${z} mm · after ${labelFor(lastOp)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSlot(slot: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!el) throw new Error(`missing data-slot="${slot}"`);
  return el;
}
