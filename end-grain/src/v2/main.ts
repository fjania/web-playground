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

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  LineBasicMaterial,
  LineSegments,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { initManifold } from '../domain/manifold';
import { defaultTimeline } from './state/defaultTimeline';
import { createIdCounter } from './state/ids';
import { runPipeline } from './state/pipeline';
import {
  buildGroupFromSnapshot,
  buildPanelGroup,
  disposePanelGroup,
} from './scene/meshBuilder';
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
    if (Number.isFinite(v) && v > 0) cutOverride.pitch = v;
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
    subtitle.textContent = `cut-0 · rip ${cut.rip}° · pitch ${cut.pitch} · bevel ${cut.bevel}°`;
  }
  if (meta) {
    meta.textContent =
      `→ ${cutResult.slices.length} inner slices (${cutResult.offcuts.length} offcuts discarded)`;
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
    `${cut.slices.length} slices · ${totalVolumes} segments · ${cut.offcuts.length} offcuts discarded`;
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
  panelGroup: Group,
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
  // Let the user orbit all the way around the panel — no polar- or
  // azimuth-angle fencing. Three.js defaults the polar range to
  // [0, π] which stops the camera at straight-up / straight-down
  // and prevents viewing the panel from beneath; widening both
  // bounds to ±∞ gives a true sphere of viewpoints. Pan and zoom
  // likewise stay fully unlocked so the user can frame any angle.
  controls.minPolarAngle = -Infinity;
  controls.maxPolarAngle = Infinity;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = true;
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

  // ---- Axis gizmo overlay (upper-right of viewport) ----
  //
  // A secondary scene containing three colour-coded axis lines +
  // sprite labels (X red, Y green, Z blue). Rendered in its own
  // small viewport after the main scene so it floats over the
  // corner, unaffected by the main camera's position. The gizmo
  // camera shares the main camera's rotation so the axes reflect
  // the user's current orbit orientation exactly.
  const gizmoScene = new Scene();
  gizmoScene.add(buildAxisGizmo());
  const gizmoCamera = new OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 100);
  const GIZMO_CAMERA_DISTANCE = 3;
  const GIZMO_PX = 72;
  const GIZMO_MARGIN = 10;

  let alive = true;
  function tick(): void {
    if (!alive) return;
    controls.update();
    const w = slot!.clientWidth;
    const h = slot!.clientHeight;
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);

    // Gizmo pass — match the main camera's rotation, then render
    // in a small corner viewport with depth cleared so it sits on
    // top regardless of main-scene geometry depth. autoClearColor
    // is suppressed so the gizmo floats over the existing scene
    // without painting a backing rectangle.
    gizmoCamera.quaternion.copy(camera.quaternion);
    gizmoCamera.position
      .set(0, 0, GIZMO_CAMERA_DISTANCE)
      .applyQuaternion(gizmoCamera.quaternion);
    gizmoCamera.updateMatrixWorld();
    const gx = w - GIZMO_PX - GIZMO_MARGIN;
    const gy = h - GIZMO_PX - GIZMO_MARGIN;
    renderer.setViewport(gx, gy, GIZMO_PX, GIZMO_PX);
    renderer.setScissor(gx, gy, GIZMO_PX, GIZMO_PX);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    const prevAutoClearColor = renderer.autoClearColor;
    renderer.autoClearColor = false;
    renderer.render(gizmoScene, gizmoCamera);
    renderer.autoClearColor = prevAutoClearColor;
    renderer.setScissorTest(false);

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

/**
 * Build an orientation gizmo — three colour-coded axis lines (red X,
 * green Y, blue Z) with sprite labels at each tip. The returned
 * Group lives in its own scene rendered in the viewport corner; it
 * shares nothing with the main panel scene.
 *
 * Units: the axes are 1 unit long; the gizmo scene's camera viewBox
 * is ±1.5, leaving margin around the labels.
 */
function buildAxisGizmo(): Group {
  const g = new Group();

  const AXIS_LEN = 1;
  // Three line segments, all starting at origin.
  const positions = new Float32Array([
    0, 0, 0, AXIS_LEN, 0, 0, // +X
    0, 0, 0, 0, AXIS_LEN, 0, // +Y
    0, 0, 0, 0, 0, AXIS_LEN, // +Z
  ]);
  const colors = new Float32Array([
    1, 0.25, 0.25,  1, 0.25, 0.25, // red X
    0.25, 0.8, 0.3,  0.25, 0.8, 0.3, // green Y
    0.35, 0.55, 1,  0.35, 0.55, 1, // blue Z
  ]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const mat = new LineBasicMaterial({
    vertexColors: true,
    linewidth: 2,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments(geo, mat);
  lines.renderOrder = 999;
  g.add(lines);

  // Tip labels — sprites so they always face the gizmo camera.
  const labels: Array<[string, [number, number, number], string]> = [
    ['X', [AXIS_LEN + 0.22, 0, 0], '#e04040'],
    ['Y', [0, AXIS_LEN + 0.22, 0], '#3ea84a'],
    ['Z', [0, 0, AXIS_LEN + 0.22], '#4b7de0'],
  ];
  for (const [text, pos, color] of labels) {
    const sprite = buildLabelSprite(text, color);
    sprite.position.set(pos[0], pos[1], pos[2]);
    sprite.renderOrder = 1000;
    g.add(sprite);
  }

  return g;
}

function buildLabelSprite(text: string, colour: string): Sprite {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colour;
  ctx.font = 'bold 44px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(0.45, 0.45, 1);
  return sprite;
}
