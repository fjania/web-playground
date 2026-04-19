/**
 * End-grain v2.3b bootstrap — wires pipeline output into the tile grid.
 *
 * Mental model for the three tiles (Input → Operation → Output):
 *
 *   Tile 1 — INPUT.     The panel being operated on. For the default
 *                       timeline this is compose-0's output.
 *
 *   Tile 2 — OPERATION. The operation being performed (and its
 *                       parameters), not its output. Renders via
 *                       operations.ts — e.g. a Cut draws cut-plane
 *                       lines overlaid on the input panel plus a
 *                       params label.
 *
 *   Tile 3 — OUTPUT.    3D viewport of the result. For the bootstrap
 *                       this is the final arrange's panel; once the
 *                       timeline panel UI (#31) lands, this will
 *                       reflect only the currently-selected
 *                       operation's output.
 *
 * The 3-tile view is an editor for a SINGLE selected operation. The
 * timeline (debug inspector + eventually #31) is the navigator that
 * lists all features and lets the user pick which one to focus on.
 *
 * Today the selected operation is hardcoded to cut-0 (the only Cut
 * in the default timeline). Selection-driven rebinding arrives with
 * #31. This bootstrap establishes the mental model and the I/X/O
 * layout; authoring issues (#27–#36) will add edit affordances to
 * the operation tile.
 *
 * Tile modes (unchanged from earlier commits):
 *   '2d-summary'  — static SVG view (input / operation diagrams)
 *   '3d-active'   — live Three.js viewport (promoted tile)
 *   '3d-final'    — live Three.js viewport (always-on output tile)
 *
 * WebGL budget: ≤ 2 concurrent viewports — enforced architecturally.
 */

import { Group } from 'three';

import { initManifold } from '../domain/manifold';
import { defaultTimeline } from './state/defaultTimeline';
import { createIdCounter } from './state/ids';
import { runPipeline } from './state/pipeline';
import {
  buildGroupFromSnapshot,
  buildPanelGroup,
} from './scene/meshBuilder';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import { summarize } from './render/summary';
import { renderCutOperation } from './render/operations';
import { mountInspector } from './ui/debugInspector';
import type { Panel } from './domain/Panel';
import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
  PanelSnapshot,
} from './state/types';

await initManifold();

// ---- Pipeline ----
const timeline = defaultTimeline(createIdCounter());

// Optional: override the cut's angles via `?rip=30&bevel=60` in the
// URL. Useful for visually verifying the pipeline + operation-view
// behaviour at non-default angles (mitred identity, bevelled cuts).
// No effect on the default load.
const params = new URLSearchParams(window.location.search);
const cutOverride = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
if (cutOverride) {
  const ripOverride = params.get('rip');
  if (ripOverride !== null) {
    const v = Number(ripOverride);
    if (Number.isFinite(v)) cutOverride.rip = v;
  }
  const bevelOverride = params.get('bevel');
  if (bevelOverride !== null) {
    const v = Number(bevelOverride);
    if (Number.isFinite(v)) cutOverride.bevel = v;
  }
  const pitchOverride = params.get('pitch');
  if (pitchOverride !== null) {
    const v = Number(pitchOverride);
    if (Number.isFinite(v) && v > 0) {
      cutOverride.pitch = v;
      cutOverride.spacingMode = 'pitch';
    }
  }
  const slicesOverride = params.get('slices');
  if (slicesOverride !== null) {
    const v = Number(slicesOverride);
    if (Number.isFinite(v) && v > 0) {
      cutOverride.slices = Math.floor(v);
      cutOverride.spacingMode = 'slices';
    }
  }
  const modeOverride = params.get('mode');
  if (modeOverride === 'pitch' || modeOverride === 'slices') {
    cutOverride.spacingMode = modeOverride;
  }
}

const output = runPipeline(timeline, { preserveLive: true });
const livePanels = output.livePanels ?? {};
const liveCutSlices = output.liveCutSlices ?? {};

const finalArrangeId = findLastArrangeId(timeline);
if (!finalArrangeId) throw new Error('no arrange in timeline');
const finalPanel = livePanels[finalArrangeId];
if (!finalPanel) throw new Error('pipeline did not preserve final arrange panel');

// ---- Input + Operation tiles (2D) ----
const composeResult = output.results['compose-0'] as ComposeStripsResult;
const cutResult = output.results['cut-0'] as CutResult;
const cutFeature = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
renderInputTile(composeResult);
renderOperationTile(composeResult, cutResult, cutFeature);

// ---- Debug inspector (read-only panel) ----
mountInspector({ timeline, output });

// ---- Output tile: 3D viewport of the SELECTED operation's output ----
// For the current bootstrap the selected operation is cut-0, so the
// output is cut-0's slices. Rendered from LIVE Panel meshes so the
// actual manifold geometry (including bevel-angled end faces) shows
// up correctly — snapshot-based rendering only knows the top face
// polygon and would extrude it straight up, giving a wrong mesh at
// bevel ≠ 90°.
//
// The snapshot `cutResult` is still passed to `buildCutOutputGroup`
// alongside the live slices, because layout decisions (gap size,
// offcut detection) are computed from the snapshot's plain-data
// views. The tile's DOM still uses data-stage="arrange-0" for
// back-compat with the tile-promotion logic; that gets reworked
// when #31 lands selection-driven rebinding.
const outputTileEl = requireTile(finalArrangeId);
const liveCutSlicesForSelected = liveCutSlices['cut-0'] ?? [];
const cutOutputGroup = buildCutOutputGroup(cutResult, liveCutSlicesForSelected);
const finalViewport = setupViewport(outputTileEl, cutOutputGroup, { mode: '3d-final' });
updateOutputMeta(outputTileEl, cutResult);

// ---- Tile-mode state + click handlers ----
interface ActiveViewport {
  tileEl: HTMLElement;
  dispose: () => void;
  featureId: string;
}
let activePromoted: ActiveViewport | null = null;

document.querySelectorAll<HTMLElement>('.tile').forEach((tile) => {
  const stageId = tile.dataset.stage;
  if (!stageId) return;
  if (stageId === finalArrangeId) {
    tile.dataset.mode = '3d-final';
    return;
  }
  tile.dataset.mode = '2d-summary';
  tile.addEventListener('click', () => handleTileClick(stageId, tile));
});

function handleTileClick(stageId: string, tileEl: HTMLElement): void {
  // Only tiles with a live panel can be promoted to 3D.
  const panel = livePanels[stageId];
  if (!panel) return;

  if (tileEl.dataset.mode === '3d-active') {
    // Demote back to 2D summary.
    activePromoted?.dispose();
    activePromoted = null;
    tileEl.dataset.mode = '2d-summary';
    restoreSummary(stageId, tileEl);
    return;
  }

  // Promote. If another tile is already 3d-active, demote it first
  // so the WebGL-viewport budget stays ≤ 2 (final + this one).
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

// ---- Helpers ----

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

/**
 * Input tile: top-down view of the panel being operated on. For the
 * current bootstrap, that's the compose result.
 */
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

/**
 * Operation tile: renders the Cut as an operation diagram — the
 * input panel's top-down view with cut-plane lines overlaid and
 * offcut regions lightly shaded. The subtitle carries the key
 * params (rip, pitch, bevel); the meta slot carries the derived
 * slice count so the viewer can see what N pieces this operation
 * will produce when applied.
 */
function renderOperationTile(
  inputResult: ComposeStripsResult,
  cutResult: CutResult,
  cut: (Feature & { kind: 'cut' }) | undefined,
): void {
  const tile = requireTile('cut-0');
  const slot = tile.querySelector<HTMLElement>('[data-slot="render"]');
  const subtitle = tile.querySelector<HTMLElement>('.subtitle');
  const meta = tile.querySelector<HTMLElement>('[data-slot="meta"]');

  if (!cut) {
    if (slot) slot.innerHTML = '<div class="placeholder">cut feature missing</div>';
    return;
  }

  if (slot) {
    slot.innerHTML = renderCutOperation(inputResult.panel, cutResult);
  }
  if (subtitle) {
    const density =
      cut.spacingMode === 'slices'
        ? `${cut.slices} slices`
        : `pitch ${cut.pitch}`;
    subtitle.textContent = `cut-0 · rip ${cut.rip}° · ${density} · bevel ${cut.bevel}°`;
  }
  if (meta) {
    meta.textContent =
      cutResult.offcuts.length > 0
        ? `→ ${cutResult.slices.length} inner slices (${cutResult.offcuts.length} offcuts discarded)`
        : `→ ${cutResult.slices.length} slices (no offcuts — cuts span the full panel)`;
  }
}

/**
 * Re-render a tile's 2D view after demoting from 3D. Dispatches by
 * the tile's role (input panel / cut operation / etc) rather than
 * just stage id, so the right 2D rendering gets restored.
 */
function restoreSummary(stageId: string, tileEl: HTMLElement): void {
  const slot = tileEl.querySelector<HTMLElement>('[data-slot="render"]');
  if (!slot) return;
  if (stageId === 'compose-0') {
    slot.innerHTML = summarize(composeResult.panel);
  } else if (stageId === 'cut-0') {
    slot.innerHTML = renderCutOperation(composeResult.panel, cutResult);
  } else {
    const result = output.results[stageId];
    if (result && 'panel' in result) {
      slot.innerHTML = summarize((result as ArrangeResult).panel);
    }
  }
}

/**
 * Build the Output-tile 3D scene for a Cut-selected view.
 *
 * This reproduces the Operation tile's layout — the tall panel with
 * diagonal cut bands, each piece in its baked position — and then
 * inserts a gap along the panel's long axis (Z) so the pieces
 * separate without a diagonal staircase.
 *
 * Slice meshes come from LIVE Panels (via buildPanelGroup), so the
 * actual manifold geometry renders correctly even when the cut has
 * a non-vertical bevel. The snapshot-based builder (used for the
 * offcuts, where live Panels aren't surfaced today) extrudes the
 * topFace straight along Y — that only matches truth at bevel=90°.
 * The layout math still uses the snapshot because it's the plain
 * data structure with bbox and topFace already computed.
 *
 * Why Z-only gap and not normal-to-face: the cut-normal at any rip
 * ≠ 0 has both X and Z components, so a gap along it drags each
 * piece sideways in X on top of its naturally-offset baked X
 * position. The combined X drift per step produces a staircase that
 * doesn't match the Operation view's single-column layout. Pushing
 * along Z alone keeps every piece within the panel's native X
 * column; pieces stack vertically with the cut-plane band
 * boundaries, matching the Operation view's layout.
 *
 * Gap: the Y thickness of the panel (≈ the "height" of each segment).
 *
 * Offcuts are translucent so they read as discarded.
 */
function buildCutOutputGroup(cut: CutResult, liveSlices: Panel[]): Group {
  const group = new Group();

  // Pieces in cut order (along the cut-normal, which is also monotonic
  // along Z for any rip where cos(rip) > 0, so cut-order = Z-order).
  type PieceKind = 'slice' | 'offcut';
  type Piece = {
    snap: PanelSnapshot;
    kind: PieceKind;
    live?: Panel; // present for slices under preserveLive
  };
  const pieces: Piece[] = [];
  if (cut.offcuts[0]) pieces.push({ snap: cut.offcuts[0], kind: 'offcut' });
  cut.slices.forEach((s, i) => {
    pieces.push({ snap: s, kind: 'slice', live: liveSlices[i] });
  });
  if (cut.offcuts[1]) pieces.push({ snap: cut.offcuts[1], kind: 'offcut' });
  if (pieces.length === 0) return group;

  // Gap = panel Y thickness.
  let gap = 0;
  for (const p of pieces) {
    const v = p.snap.volumes[0];
    if (v) { gap = v.bbox.max[1] - v.bbox.min[1]; break; }
  }

  const centerIdx = (pieces.length - 1) / 2;

  pieces.forEach((piece, i) => {
    // Live Panel when available (slices under preserveLive) — the
    // manifold mesh captures bevel-angled end faces faithfully.
    // Fall back to snapshot extrusion for offcuts (which aren't
    // surfaced live) and for the headless / no-preserveLive path.
    const meshGroup = piece.live
      ? buildPanelGroup(piece.live)
      : buildGroupFromSnapshot(piece.snap);
    // Push along +Z only. No X motion is introduced — each piece
    // stays in the panel's natural X column, same as the Operation
    // tile.
    meshGroup.position.z = (i - centerIdx) * gap;

    meshGroup.userData.kind = piece.kind;
    if (piece.kind === 'slice') {
      meshGroup.userData.sliceIdx = i - (cut.offcuts[0] ? 1 : 0);
    }

    if (piece.kind === 'offcut') {
      meshGroup.traverse((obj) => {
        const anyObj = obj as any;
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

/** Meta line on the Output tile — describes what the Cut produced. */
function updateOutputMeta(tileEl: HTMLElement, cut: CutResult): void {
  const meta = tileEl.querySelector<HTMLElement>('[data-slot="meta"]');
  if (!meta) return;
  const totalVolumes = cut.slices.reduce((n, s) => n + s.volumes.length, 0);
  meta.textContent =
    cut.offcuts.length > 0
      ? `${cut.slices.length} slices · ${totalVolumes} segments · ${cut.offcuts.length} offcuts discarded`
      : `${cut.slices.length} slices · ${totalVolumes} segments`;
}


// Mark final viewport explicitly so lint does not complain about the unused handle.
void finalViewport;
