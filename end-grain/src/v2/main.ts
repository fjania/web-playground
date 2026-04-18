/**
 * End-grain v2.3b bootstrap — wires pipeline output into the tile grid.
 *
 * Commit (b): final-output tile is now a live 3D viewport. Compose
 * and Cut tiles remain placeholders; they're wired up in commit (c).
 *
 * Scope of this module:
 *  - Init one Three.js renderer + scene + camera + OrbitControls
 *    + lights, attached to the #tile-arrange-0 render slot.
 *  - Run the default timeline through the pipeline with
 *    `preserveLive: true` so we keep the final arrange's Panel
 *    handles for mesh building.
 *  - Build a mesh group from the final panel via meshBuilder.
 *  - Size camera to the panel's bbox and start the render loop.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
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
import { buildPanelGroup } from './scene/meshBuilder';

await initManifold();

const arrangeTile = document.querySelector<HTMLElement>('[data-stage="arrange-0"]');
if (!arrangeTile) throw new Error('3d-v2.html: missing arrange-0 tile');
const renderSlot = arrangeTile.querySelector<HTMLElement>('[data-slot="render"]');
const metaSlot = arrangeTile.querySelector<HTMLElement>('[data-slot="meta"]');
if (!renderSlot || !metaSlot) throw new Error('3d-v2.html: arrange-0 tile missing slots');

// ---- Pipeline run with live Panel preservation ----
const timeline = defaultTimeline(createIdCounter());
const output = runPipeline(timeline, { preserveLive: true });
const finalArrangeId = findLastArrangeId(timeline);
const finalPanel = finalArrangeId ? output.livePanels?.[finalArrangeId] : undefined;
if (!finalPanel) throw new Error('pipeline did not preserve a final live panel');

// ---- Three.js viewport ----
renderSlot.innerHTML = '';
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderSlot.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x262422);

const key = new DirectionalLight(0xfff5e6, 1.6);
key.position.set(300, 400, 200);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);
scene.add(
  new DirectionalLight(0xc8d8e8, 0.6).translateX(-200).translateY(100).translateZ(-100),
);
scene.add(new DirectionalLight(0xd4c8b8, 0.5).translateY(-300));
scene.add(new AmbientLight(0x5a5450, 1.0));

// Build the panel mesh group and centre the camera on it.
const panelGroup = buildPanelGroup(finalPanel);
scene.add(panelGroup);

const bbox = new Box3().setFromObject(panelGroup);
const size = new Vector3();
const centre = new Vector3();
bbox.getSize(size);
bbox.getCenter(centre);
const diag = size.length();

// Camera framing. End-grain boards are stick-shaped (long in Z), and
// the interesting face is the top (XZ plane). Position the camera
// above-and-forward so the top face dominates the frame.
//
// Distance: diagonal × a small multiplier, so all axes fit with
// room to breathe even in a narrow-tall tile aspect.
const camDist = diag * 1.3;
const camera = new PerspectiveCamera(45, 1, 0.5, diag * 10);
camera.position
  .copy(centre)
  .add(new Vector3(camDist * 0.45, camDist * 0.75, camDist * 0.55));
camera.lookAt(centre);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(centre);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// Resize observer keeps the renderer matched to the tile's render slot.
const ro = new ResizeObserver(() => fitRendererToSlot());
ro.observe(renderSlot);
fitRendererToSlot();

function fitRendererToSlot(): void {
  const w = renderSlot!.clientWidth;
  const h = renderSlot!.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---- Render loop ----
function tick(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- Meta line ----
const b = finalPanel.boundingBox();
const sx = (b.max.x - b.min.x).toFixed(0);
const sy = (b.max.y - b.min.y).toFixed(0);
const sz = (b.max.z - b.min.z).toFixed(0);
metaSlot.textContent = `${finalPanel.segments.length} segments · bbox ${sx}×${sy}×${sz} mm`;

// ---- Helpers ----

import type { Feature } from './state/types';

function findLastArrangeId(features: Feature[]): string | null {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.kind === 'arrange') return f.id;
  }
  return null;
}
