/**
 * Cut harness — wires the Cut feature's I/X/O tiles with an interactive
 * CutControls component mounted inside the Operation tile.
 *
 * URL params (`?rip=`, `?bevel=`, `?pitch=`, `?slices=`, `?mode=`)
 * still seed initial state — refresh returns to the URL-seeded
 * values — but after load, all editing happens through the controls
 * in the Operation tile. Same component ships into the workbench
 * canvas so harness and canvas don't diverge.
 *
 * Tile modes (unchanged from earlier commits):
 *   '2d-summary'  — static SVG view (input / operation diagrams)
 *   '3d-active'   — live Three.js viewport (promoted tile)
 *   '3d-final'    — live Three.js viewport (always-on output tile)
 *
 * WebGL budget: ≤ 2 concurrent viewports, enforced architecturally.
 */

import { Group } from 'three';

import { initManifold } from './domain/manifold';
import { defaultTimeline } from './state/defaultTimeline';
import { createIdCounter } from './state/ids';
import { runPipeline, type PipelineOutput } from './state/pipeline';
import {
  buildGroupFromSnapshot,
  buildPanelGroup,
} from './scene/meshBuilder';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import { summarize } from './render/summary';
import { renderCutOperation } from './render/operations';
import { mountInspector } from './ui/debugInspector';
import {
  mountCutControls,
  type CutControlsHandle,
  type CutControlsState,
} from './ui/cut-controls';
import type { Panel } from './domain/Panel';
import type {
  ArrangeResult,
  ComposeStripsResult,
  Cut,
  CutResult,
  Feature,
  PanelSnapshot,
} from './state/types';

await initManifold();

// ---- Timeline setup -------------------------------------------------

const timeline = defaultTimeline(createIdCounter());

// Find the Cut feature and apply URL-param seeds.
const cut = timeline.find((f): f is Cut => f.kind === 'cut');
if (!cut) throw new Error('default timeline missing a Cut feature');

applyCutUrlSeeds(cut);

const finalArrangeId = findLastArrangeId(timeline);
if (!finalArrangeId) throw new Error('no arrange in timeline');

// ---- Mount CutControls in the Operation tile ------------------------

const operationTileEl = requireTile('cut-0');
const opRenderSlot = operationTileEl.querySelector<HTMLElement>('[data-slot="render"]');
if (!opRenderSlot) throw new Error('cut-0 tile missing render slot');

// The Operation tile now has two sub-regions:
//   - controls (top, fixed height) → CutControls
//   - preview  (below, flex) → the existing SVG cut-operation diagram
// A small wrapper div manages the layout so we keep the outer slot's
// grey background + border-radius unchanged.
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

const cutControls: CutControlsHandle = mountCutControls(
  opControlsSlot,
  cutToControlsState(cut),
  {
    onChange(next) {
      applyControlsState(cut, next);
      rerun();
    },
  },
);

// ---- Pipeline + render state ---------------------------------------

let output: PipelineOutput;
let finalViewport: ViewportHandle | null = null;

interface ActiveViewport {
  tileEl: HTMLElement;
  dispose: () => void;
  featureId: string;
}
let activePromoted: ActiveViewport | null = null;

rerun();

// ---- Tile-click-to-promote wiring (runs once) ----------------------

document.querySelectorAll<HTMLElement>('.tile').forEach((tile) => {
  const stageId = tile.dataset.stage;
  if (!stageId) return;
  if (stageId === finalArrangeId) {
    tile.dataset.mode = '3d-final';
    return;
  }
  tile.dataset.mode = '2d-summary';
  tile.addEventListener('click', (e) => {
    // Ignore clicks that originate inside the controls region so
    // slider / button interactions don't toggle the tile.
    if ((e.target as Element).closest('.cut-controls')) return;
    handleTileClick(stageId, tile);
  });
});

function handleTileClick(stageId: string, tileEl: HTMLElement): void {
  const panel = output.livePanels?.[stageId];
  if (!panel) return;

  if (tileEl.dataset.mode === '3d-active') {
    activePromoted?.dispose();
    activePromoted = null;
    tileEl.dataset.mode = '2d-summary';
    restoreSummary(stageId, tileEl);
    return;
  }

  if (activePromoted) {
    activePromoted.dispose();
    activePromoted.tileEl.dataset.mode = '2d-summary';
    restoreSummary(activePromoted.featureId, activePromoted.tileEl);
    activePromoted = null;
  }

  const viewport = setupViewport(tileEl, buildPanelGroup(panel), { mode: '3d-active' });
  tileEl.dataset.mode = '3d-active';
  activePromoted = {
    tileEl,
    dispose: viewport.dispose,
    featureId: stageId,
  };
}

// ---- Rerun: pipeline + tile renders ---------------------------------

function rerun(): void {
  // Dispose live viewports before running so the previous live Panels
  // can be freed cleanly.
  activePromoted?.dispose();
  activePromoted = null;
  finalViewport?.dispose();
  finalViewport = null;

  output = runPipeline(timeline, { preserveLive: true });
  const livePanels = output.livePanels ?? {};
  const liveCutSlices = output.liveCutSlices ?? {};

  const finalPanel = livePanels[finalArrangeId];
  if (!finalPanel) throw new Error('pipeline did not preserve final arrange panel');

  const composeResult = output.results['compose-0'] as ComposeStripsResult;
  const cutResult = output.results['cut-0'] as CutResult;
  renderInputTile(composeResult);
  renderOperationPreview(composeResult, cutResult, cut);
  updateOperationSubtitle(cut, cutResult);

  mountInspector({ timeline, output });

  const outputTileEl = requireTile(finalArrangeId);
  // The "final" tile shows the CUT output (slices) per original design —
  // selection-driven rebinding to other ops arrives with the workbench.
  const liveCutSlicesForSelected = liveCutSlices['cut-0'] ?? [];
  const cutOutputGroup = buildCutOutputGroup(cutResult, liveCutSlicesForSelected);
  finalViewport = setupViewport(outputTileEl, cutOutputGroup, { mode: '3d-final' });
  updateOutputMeta(outputTileEl, cutResult);
  // Reset to 3d-final in case a rerun follows a promote/demote cycle.
  outputTileEl.dataset.mode = '3d-final';

  // Any previously-promoted non-final tile returns to 2D summary —
  // the old activePromoted was disposed above, so we just need to
  // refresh the summary in whatever tile was promoted.
  document.querySelectorAll<HTMLElement>('.tile').forEach((tile) => {
    const stageId = tile.dataset.stage;
    if (!stageId || stageId === finalArrangeId) return;
    if (tile.dataset.mode !== '3d-active') {
      restoreSummary(stageId, tile);
    }
  });
}

// ---- URL seeds ------------------------------------------------------

function applyCutUrlSeeds(c: Cut): void {
  const params = new URLSearchParams(window.location.search);
  const rip = params.get('rip');
  if (rip !== null) {
    const v = Number(rip);
    if (Number.isFinite(v)) c.rip = v;
  }
  const bevel = params.get('bevel');
  if (bevel !== null) {
    const v = Number(bevel);
    if (Number.isFinite(v)) c.bevel = v;
  }
  const pitch = params.get('pitch');
  if (pitch !== null) {
    const v = Number(pitch);
    if (Number.isFinite(v) && v > 0) {
      c.pitch = v;
      c.spacingMode = 'pitch';
    }
  }
  const slices = params.get('slices');
  if (slices !== null) {
    const v = Number(slices);
    if (Number.isFinite(v) && v > 0) {
      c.slices = Math.floor(v);
      c.spacingMode = 'slices';
    }
  }
  const mode = params.get('mode');
  if (mode === 'pitch' || mode === 'slices') c.spacingMode = mode;
}

function cutToControlsState(c: Cut): CutControlsState {
  return {
    rip: c.rip,
    bevel: c.bevel,
    spacingMode: c.spacingMode,
    pitch: c.pitch,
    slices: c.slices,
    showOffcuts: c.showOffcuts,
  };
}

function applyControlsState(c: Cut, next: CutControlsState): void {
  c.rip = next.rip;
  c.bevel = next.bevel;
  c.spacingMode = next.spacingMode;
  c.pitch = next.pitch;
  c.slices = next.slices;
  c.showOffcuts = next.showOffcuts;
}

// ---- Tile renders ---------------------------------------------------

function findLastArrangeId(features: Feature[]): string | null {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.kind === 'arrange') return f.id;
  }
  return null;
}

function requireTile(stageId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-stage="${stageId}"]`);
  if (!el) throw new Error(`tile for stage ${stageId} missing`);
  return el;
}

function renderInputTile(result: ComposeStripsResult): void {
  const tile = requireTile('compose-0');
  const slot = tile.querySelector<HTMLElement>('[data-slot="render"]');
  if (slot) slot.innerHTML = summarize(result.panel);
  const meta = tile.querySelector<HTMLElement>('[data-slot="meta"]');
  if (meta) {
    const xExt = (result.panel.bbox.max[0] - result.panel.bbox.min[0]).toFixed(0);
    const zExt = (result.panel.bbox.max[2] - result.panel.bbox.min[2]).toFixed(0);
    meta.textContent = `${result.panel.volumes.length} strips · ${xExt}×${zExt} mm`;
  }
}

function renderOperationPreview(
  inputResult: ComposeStripsResult,
  cutResult: CutResult,
  c: Cut,
): void {
  if (!c) return;
  opPreviewSlot.innerHTML = renderCutOperation(inputResult.panel, cutResult);
}

function updateOperationSubtitle(c: Cut, cutResult: CutResult): void {
  const tile = requireTile('cut-0');
  const subtitle = tile.querySelector<HTMLElement>('.subtitle');
  const meta = tile.querySelector<HTMLElement>('[data-slot="meta"]');
  if (subtitle) {
    const density =
      c.spacingMode === 'slices'
        ? `${c.slices} slices`
        : `pitch ${c.pitch}`;
    subtitle.textContent = `cut-0 · rip ${c.rip}° · ${density} · bevel ${c.bevel}°`;
  }
  if (meta) {
    meta.textContent =
      cutResult.offcuts.length > 0
        ? `→ ${cutResult.slices.length} inner slices (${cutResult.offcuts.length} offcuts discarded)`
        : `→ ${cutResult.slices.length} slices (no offcuts — cuts span the full panel)`;
  }
}

function restoreSummary(stageId: string, tileEl: HTMLElement): void {
  if (stageId === 'compose-0') {
    const slot = tileEl.querySelector<HTMLElement>('[data-slot="render"]');
    const composeResult = output.results['compose-0'] as ComposeStripsResult;
    if (slot && composeResult) slot.innerHTML = summarize(composeResult.panel);
    return;
  }
  if (stageId === 'cut-0') {
    // The cut-0 tile has the compound controls+preview layout; the
    // preview slot is the one that holds the operation diagram.
    const composeResult = output.results['compose-0'] as ComposeStripsResult;
    const cutResult = output.results['cut-0'] as CutResult;
    if (composeResult && cutResult) {
      opPreviewSlot.innerHTML = renderCutOperation(composeResult.panel, cutResult);
    }
    return;
  }
  const slot = tileEl.querySelector<HTMLElement>('[data-slot="render"]');
  if (!slot) return;
  const result = output.results[stageId];
  if (result && 'panel' in result) {
    slot.innerHTML = summarize((result as ArrangeResult).panel);
  }
}

// ---- 3D Cut-output group builder -----------------------------------

function buildCutOutputGroup(cutResult: CutResult, liveSlices: Panel[]): Group {
  const group = new Group();

  type PieceKind = 'slice' | 'offcut';
  type Piece = {
    snap: PanelSnapshot;
    kind: PieceKind;
    live?: Panel;
  };
  const pieces: Piece[] = [];
  if (cutResult.offcuts[0]) pieces.push({ snap: cutResult.offcuts[0], kind: 'offcut' });
  cutResult.slices.forEach((s, i) => {
    pieces.push({ snap: s, kind: 'slice', live: liveSlices[i] });
  });
  if (cutResult.offcuts[1]) pieces.push({ snap: cutResult.offcuts[1], kind: 'offcut' });
  if (pieces.length === 0) return group;

  let gap = 0;
  for (const p of pieces) {
    const v = p.snap.volumes[0];
    if (v) { gap = v.bbox.max[1] - v.bbox.min[1]; break; }
  }

  const centerIdx = (pieces.length - 1) / 2;

  pieces.forEach((piece, i) => {
    const meshGroup = piece.live
      ? buildPanelGroup(piece.live)
      : buildGroupFromSnapshot(piece.snap);
    meshGroup.position.z = (i - centerIdx) * gap;

    meshGroup.userData.kind = piece.kind;
    if (piece.kind === 'slice') {
      meshGroup.userData.sliceIdx = i - (cutResult.offcuts[0] ? 1 : 0);
    }

    if (piece.kind === 'offcut') {
      meshGroup.traverse((obj) => {
        const anyObj = obj as unknown as {
          isMesh?: boolean;
          isLineSegments?: boolean;
          material?: {
            transparent: boolean;
            opacity: number;
            depthWrite?: boolean;
          };
        };
        if (anyObj.isMesh && anyObj.material) {
          anyObj.material.transparent = true;
          anyObj.material.opacity = 0.2;
          anyObj.material.depthWrite = false;
        }
        if (anyObj.isLineSegments && anyObj.material) {
          anyObj.material.transparent = true;
          anyObj.material.opacity = 0.15;
        }
      });
    }

    group.add(meshGroup);
  });

  return group;
}

function updateOutputMeta(tileEl: HTMLElement, cutResult: CutResult): void {
  const meta = tileEl.querySelector<HTMLElement>('[data-slot="meta"]');
  if (!meta) return;
  const totalVolumes = cutResult.slices.reduce((n, s) => n + s.volumes.length, 0);
  meta.textContent =
    cutResult.offcuts.length > 0
      ? `${cutResult.slices.length} slices · ${totalVolumes} segments · ${cutResult.offcuts.length} offcuts discarded`
      : `${cutResult.slices.length} slices · ${totalVolumes} segments`;
}

// Silence the "unused" lint; the handle is held for the page's lifetime.
void cutControls;
