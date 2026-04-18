/**
 * End-grain v2.3b bootstrap — wires pipeline output into the tile grid.
 *
 * Commit (d): tile modes + click-to-swap + WebGL budget.
 *
 * Tile modes:
 *   '2d-summary'  — static SVG via summarize(PanelSnapshot)
 *   '3d-active'   — live Three.js viewport (promoted non-final tile)
 *   '3d-final'    — live Three.js viewport (always-on for the final arrange)
 *
 * WebGL budget: final-output tile stays 3D always; at most one
 * non-final tile can be promoted to 3d-active at a time. Maximum
 * 2 concurrent WebGL viewports.
 *
 * Promotable tiles are those whose feature has a live Panel in
 * `output.livePanels`. In the default timeline that's compose-0
 * plus the final arrange-0. Cut tiles can't promote (no live
 * panel for individual slices in this version).
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { initManifold } from '../domain/manifold';
import { defaultTimeline } from './state/defaultTimeline';
import { createIdCounter } from './state/ids';
import { runPipeline } from './state/pipeline';
import { buildPanelGroup, disposePanelGroup } from './scene/meshBuilder';
import { summarize, summarizeSlices } from './render/summary';
import { mountInspector } from './ui/debugInspector';
import type { Panel } from './domain/Panel';
import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
} from './state/types';

await initManifold();

// ---- Pipeline ----
const timeline = defaultTimeline(createIdCounter());

// Optional: override the cut's rip angle via `?rip=30` in the URL.
// Useful for verifying the v2.2 cursor-slide / concat-in-place
// algorithm visually — mitred identity should reassemble flush in
// the 3D final tile. No effect on the default load.
const params = new URLSearchParams(window.location.search);
const ripOverride = params.get('rip');
if (ripOverride !== null) {
  const rip = Number(ripOverride);
  if (Number.isFinite(rip)) {
    const cut = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
    if (cut) cut.rip = rip;
  }
}

const output = runPipeline(timeline, { preserveLive: true });
const livePanels = output.livePanels ?? {};

const finalArrangeId = findLastArrangeId(timeline);
if (!finalArrangeId) throw new Error('no arrange in timeline');
const finalPanel = livePanels[finalArrangeId];
if (!finalPanel) throw new Error('pipeline did not preserve final arrange panel');

// ---- 2D summary tiles (compose + cut) ----
const composeResult = output.results['compose-0'] as ComposeStripsResult;
const cutResult = output.results['cut-0'] as CutResult;
renderComposeTile(composeResult);
const cutFeature = timeline.find((f): f is Feature & { kind: 'cut' } => f.kind === 'cut');
renderCutTile(cutResult, cutFeature);

// ---- Debug inspector (read-only panel) ----
mountInspector({ timeline, output });

// ---- Final output: 3D viewport, always on ----
const finalTileEl = requireTile(finalArrangeId);
const finalViewport = setupViewport(finalTileEl, finalPanel, { mode: '3d-final' });
updateMeta(finalTileEl, finalPanel, 'final');

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

  const viewport = setupViewport(tileEl, panel, { mode: '3d-active' });
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

function renderComposeTile(result: ComposeStripsResult): void {
  const tile = requireTile('compose-0');
  const slot = tile.querySelector<HTMLElement>('[data-slot="render"]');
  if (slot) slot.innerHTML = summarize(result.panel);
  updateMetaFromSnapshot(tile, result.panel, 'compose');
}

function renderCutTile(
  result: CutResult,
  cut: (Feature & { kind: 'cut' }) | undefined,
): void {
  const tile = requireTile('cut-0');
  const slot = tile.querySelector<HTMLElement>('[data-slot="render"]');
  const subtitle = tile.querySelector<HTMLElement>('.subtitle');
  const meta = tile.querySelector<HTMLElement>('[data-slot="meta"]');

  // Render ALL slices as an "exploded" stack with small Z-gaps
  // between them. The downstream Arrange(identity) pushes these
  // same slices flush together, so the relationship is visually
  // obvious: Cut A is the panel pulled apart; Final output is
  // those slices put back together.
  if (slot && result.slices.length > 0) {
    slot.innerHTML = summarizeSlices(result.slices, { gap: 15 });
  }
  if (subtitle) {
    subtitle.textContent = `cut-0 · ${result.slices.length} slices, exploded`;
  }
  if (meta) {
    if (result.slices.length > 0 && cut) {
      meta.textContent = `${result.slices.length} slices · pitch ${cut.pitch} mm · rip ${cut.rip}°`;
    } else {
      meta.textContent = 'no slices';
    }
  }
}

/** Re-render a tile's 2D summary after demoting from 3D. */
function restoreSummary(stageId: string, tileEl: HTMLElement): void {
  const slot = tileEl.querySelector<HTMLElement>('[data-slot="render"]');
  if (!slot) return;
  if (stageId === 'compose-0') {
    slot.innerHTML = summarize(composeResult.panel);
  } else if (stageId === 'cut-0' && cutResult.slices.length > 0) {
    slot.innerHTML = summarizeSlices(cutResult.slices, { gap: 15 });
  } else {
    // For any other stage (future arrange-N), summarize its result's panel.
    const result = output.results[stageId];
    if (result && 'panel' in result) {
      slot.innerHTML = summarize((result as ArrangeResult).panel);
    }
  }
}

function updateMeta(tileEl: HTMLElement, panel: Panel, label: string): void {
  const meta = tileEl.querySelector<HTMLElement>('[data-slot="meta"]');
  if (!meta) return;
  const b = panel.boundingBox();
  const x = (b.max.x - b.min.x).toFixed(0);
  const y = (b.max.y - b.min.y).toFixed(0);
  const z = (b.max.z - b.min.z).toFixed(0);
  if (label === 'final') {
    meta.textContent = `${panel.segments.length} segments · bbox ${x}×${y}×${z} mm`;
  }
}

function updateMetaFromSnapshot(
  tileEl: HTMLElement,
  panel: ComposeStripsResult['panel'],
  label: string,
): void {
  const meta = tileEl.querySelector<HTMLElement>('[data-slot="meta"]');
  if (!meta) return;
  const xExt = (panel.bbox.max[0] - panel.bbox.min[0]).toFixed(0);
  const zExt = (panel.bbox.max[2] - panel.bbox.min[2]).toFixed(0);
  if (label === 'compose') {
    meta.textContent = `${panel.volumes.length} strips · ${xExt}×${zExt} mm`;
  }
}

// ---- Viewport setup (shared between 3d-final and 3d-active) ----

interface ViewportHandle {
  dispose: () => void;
}

interface ViewportOptions {
  mode: '3d-final' | '3d-active';
}

function setupViewport(
  tileEl: HTMLElement,
  panel: Panel,
  _options: ViewportOptions,
): ViewportHandle {
  const slot = tileEl.querySelector<HTMLElement>('[data-slot="render"]');
  if (!slot) throw new Error('tile missing render slot');
  slot.innerHTML = '';

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  slot.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x262422);

  const key = new DirectionalLight(0xfff5e6, 1.6);
  key.position.set(300, 400, 200);
  key.castShadow = true;
  scene.add(key);
  scene.add(
    new DirectionalLight(0xc8d8e8, 0.6)
      .translateX(-200)
      .translateY(100)
      .translateZ(-100),
  );
  scene.add(new DirectionalLight(0xd4c8b8, 0.5).translateY(-300));
  scene.add(new AmbientLight(0x5a5450, 1.0));

  const panelGroup: Group = buildPanelGroup(panel);
  scene.add(panelGroup);

  const bbox = new Box3().setFromObject(panelGroup);
  const size = new Vector3();
  const centre = new Vector3();
  bbox.getSize(size);
  bbox.getCenter(centre);
  const diag = size.length();

  // Camera orientation matches the 2D summary's top-down convention:
  // +X horizontal (right), +Z going down on screen. A viewer can look
  // at a Cut A tile, find that same slice in the 3D viewport, and
  // trace both in the same orientation.
  //
  // camera.up = (0, 0, -1) makes world -Z the screen-up direction,
  // which maps world +Z to screen-down (matching the SVG convention).
  // Tilt = 20° off straight-down so the board's Y-thickness shows as
  // a side lip rather than the panel reading as a flat rect.
  const tilt = 0.35; // radians ≈ 20°
  const fovDeg = 45;
  const fovRad = (fovDeg * Math.PI) / 180;
  const halfFovV = fovRad / 2;

  // Project the panel's world extents onto the camera's screen axes:
  // - screen-horizontal = world X
  // - screen-vertical = world (Y * sin(tilt) + Z * cos(tilt))
  //   (the on-screen projection of the panel when viewed through the
  //   tilted camera; derived from the camera's effective up vector.)
  const horizontalExtent = size.x;
  const verticalExtent = size.y * Math.sin(tilt) + size.z * Math.cos(tilt);

  /**
   * Compute the camera distance that fits `horizontalExtent`
   * horizontally and `verticalExtent` vertically at the given
   * viewport aspect, with a small padding multiplier so the panel
   * doesn't touch the tile edges.
   */
  function computeFitDistance(aspect: number): number {
    const halfFovH = Math.atan(aspect * Math.tan(halfFovV));
    const distV = horizontalExtentToDist(verticalExtent, halfFovV);
    const distH = horizontalExtentToDist(horizontalExtent, halfFovH);
    return Math.max(distV, distH) * 1.18; // ~18% padding (9% per side)
  }
  function horizontalExtentToDist(extent: number, halfFov: number): number {
    return extent / 2 / Math.tan(halfFov);
  }

  const initialAspect = slot.clientWidth / slot.clientHeight || 1;
  const camera = new PerspectiveCamera(fovDeg, initialAspect, 0.5, diag * 10);
  camera.up.set(0, 0, -1);
  camera.lookAt(centre);
  positionCameraAtDistance(computeFitDistance(initialAspect));

  function positionCameraAtDistance(d: number): void {
    camera.position.set(
      centre.x,
      centre.y + d * Math.cos(tilt),
      centre.z - d * Math.sin(tilt),
    );
    camera.lookAt(centre);
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  // Once the user orbits / dollies, stop auto-fitting on resize so
  // we don't snap their chosen view. Fires on any user interaction
  // (mousedown, wheel, touchstart).
  let userHasInteracted = false;
  controls.addEventListener('start', () => {
    userHasInteracted = true;
  });

  const ro = new ResizeObserver(() => fit());
  ro.observe(slot);
  fit();

  function fit(): void {
    const w = slot!.clientWidth;
    const h = slot!.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // Re-fit camera distance on resize so a narrower tile (e.g. after
    // the inspector panel opens) doesn't crop the panel. Skip once the
    // user has orbited so we don't snap their chosen view.
    if (!userHasInteracted) {
      positionCameraAtDistance(computeFitDistance(aspect));
      controls.update();
    }
  }

  let alive = true;
  function tick(): void {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    dispose(): void {
      alive = false;
      ro.disconnect();
      controls.dispose();
      disposePanelGroup(panelGroup);
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    },
  };
}

// Mark final viewport explicitly so lint doesn't complain about the unused handle.
void finalViewport;
