import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mount } from 'svelte';
import { initManifold } from './domain';
import {
  createAxesOverlay,
  hitSpecies,
  meshMaterialCount,
  meshSurfaceArea,
  meshVolume,
  renderPanel,
  renderPanelDim,
  renderTiles,
  sizePlaneViz,
  Tile,
  tileAt,
} from './scene';
import { appState, hoverState, Pipeline } from './state';
import type { CutPassResult } from './state';
import { attachAppStateEffect } from './state/effects.svelte';
import App from './ui/App.svelte';
import './ui/styles.css';

// ─── Renderer + scene + lights ───────────────────────────────────

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x1c1917);

const key = new DirectionalLight(0xfff5e6, 1.6);
key.position.set(300, 400, 200);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 50;
key.shadow.camera.far = 1200;
key.shadow.camera.left = -500;
key.shadow.camera.right = 500;
key.shadow.camera.top = 500;
key.shadow.camera.bottom = -500;
scene.add(key);
scene.add(new DirectionalLight(0xc8d8e8, 0.8).translateX(-200).translateY(100).translateZ(-100));
scene.add(new DirectionalLight(0xd4c8b8, 0.7).translateY(-300));
scene.add(new DirectionalLight(0xb8c0c8, 0.4).translateX(-100).translateY(200).translateZ(-300));
scene.add(new AmbientLight(0x4a4440, 1.2));

// ─── Camera + controls ────────────────────────────────────────────

const camera = new PerspectiveCamera(45, 1, 1, 10000);
camera.position.set(1000, 600, 800);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

function frameCameraToBox(box: Box3, padding = 1.3): void {
  if (box.isEmpty()) return;
  const center = new Vector3();
  box.getCenter(center);
  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (maxDim / 2 / Math.tan(fov / 2)) * padding;
  camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
  controls.target.copy(center);
  controls.update();
}

function setCameraView(name: 'top' | 'front'): void {
  const target = controls.target.clone();
  const dist = Math.max(camera.position.distanceTo(target), 100);
  if (name === 'top') {
    camera.position.copy(target).add(new Vector3(0, dist, 0));
    camera.up.set(0, 0, -1);
  } else {
    camera.position.copy(target).add(new Vector3(dist, 0, 0));
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(target);
  controls.update();
}

// ─── Scene groups + tiles ────────────────────────────────────────

const panelGroup = new Group();
scene.add(panelGroup);

// One (cut, join) group pair per pass. PR 6 generalizes this to a list.
const cutTopGroup = new Group();
const cutBotGroup = new Group();
scene.add(cutTopGroup);
scene.add(cutBotGroup);

const planeViz = new Mesh(
  new PlaneGeometry(1, 1),
  new MeshBasicMaterial({
    color: 0xc0392b,
    transparent: true,
    opacity: 0.07,
    side: DoubleSide,
    depthWrite: false,
  }),
);
scene.add(planeViz);

const joinGroup = new Group();
scene.add(joinGroup);

function tileRect(col: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const c1 = Math.floor(W / 3);
  const c2 = Math.floor(2 * W / 3);
  if (col === 0) return { x: 0, y: 0, w: c1, h: H };
  if (col === 1) return { x: c1, y: 0, w: c2 - c1, h: H };
  return { x: c2, y: 0, w: W - c2, h: H };
}

const panelTile = new Tile({
  id: 'panel',
  bg: 0x1c1917,
  root: panelGroup,
  rect: () => tileRect(0),
});
const cutTile = new Tile({
  id: 'cut-0',
  bg: 0x1a1816,
  root: cutTopGroup,
  overlays: [cutBotGroup, planeViz],
  pickableGroups: [cutTopGroup, cutBotGroup],
  rect: () => tileRect(1),
});
const joinTile = new Tile({
  id: 'join-0',
  bg: 0x1c1917,
  root: joinGroup,
  rect: () => tileRect(2),
});
const tiles = [panelTile, cutTile, joinTile];

const axesOverlay = createAxesOverlay();

// ─── Pipeline + rebuild ──────────────────────────────────────────

const pipeline = new Pipeline();
let manifoldReady = false;

function renderCutPass(result: CutPassResult): void {
  cutTopGroup.clear();
  cutBotGroup.clear();
  const { pass, cutNormal, slices, offcuts, arranged } = result;
  const count = slices.length;
  const SLICE_SPACING = Math.max(pass.pitch * 1.5, 80);
  const center = (count - 1) / 2;

  slices.forEach((slice, i) => {
    const g = new Group();
    renderPanel(slice, g);
    g.position.copy(cutNormal.clone().multiplyScalar((i - center) * SLICE_SPACING));
    cutTopGroup.add(g);
  });

  const offcutOffset = (count / 2 + 1) * SLICE_SPACING;
  if (offcuts[0] && offcuts[0].size > 0) {
    const g = new Group();
    renderPanelDim(offcuts[0], g);
    g.position.copy(cutNormal.clone().multiplyScalar(-offcutOffset));
    (g.userData as any).isOffcut = true;
    g.visible = pass.showOffcuts;
    cutTopGroup.add(g);
  }
  if (offcuts[1] && offcuts[1].size > 0) {
    const g = new Group();
    renderPanelDim(offcuts[1], g);
    g.position.copy(cutNormal.clone().multiplyScalar(offcutOffset));
    (g.userData as any).isOffcut = true;
    g.visible = pass.showOffcuts;
    cutTopGroup.add(g);
  }

  planeViz.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), cutNormal);
  sizePlaneViz(planeViz, result.input);

  joinGroup.clear();
  if (arranged) renderPanel(arranged, joinGroup);
}

function rebuildAll(): void {
  if (!manifoldReady) return;
  pipeline.rebuild(appState);
  if (pipeline.startingPanel) {
    panelGroup.clear();
    renderPanel(pipeline.startingPanel, panelGroup);
  }
  pipeline.results.forEach((r) => renderCutPass(r));
}

// ─── Hover / raycasting ──────────────────────────────────────────

const raycaster = new Raycaster();
const mouse = new Vector2();
let hoveredMesh: Mesh | null = null;
let hoveredEmissive: Color[] | null = null;

function clearHoverHighlight(): void {
  if (!hoveredMesh) return;
  const mats = Array.isArray(hoveredMesh.material) ? hoveredMesh.material : [hoveredMesh.material];
  mats.forEach((m: any, i) => {
    if (hoveredEmissive?.[i] && m.emissive) m.emissive.copy(hoveredEmissive[i]);
  });
  hoveredMesh = null;
  hoveredEmissive = null;
}

renderer.domElement.addEventListener('mousemove', (e) => {
  const tile = tileAt(tiles, e.clientX, e.clientY);
  if (!tile) {
    hoverState.info = null;
    clearHoverHighlight();
    return;
  }
  const { nx, ny } = tile.ndc(e.clientX, e.clientY);
  mouse.set(nx, ny);
  raycaster.setFromCamera(mouse, camera);

  const meshes: Mesh[] = [];
  tile.pickableGroups.forEach((g: any) =>
    g.traverse((m: any) => {
      if (m.isMesh) meshes.push(m);
    }),
  );
  const hit = raycaster.intersectObjects(meshes, false)[0];
  updateHover(hit);
});

function updateHover(hit: Intersection | undefined): void {
  if (!hit) {
    clearHoverHighlight();
    hoverState.info = null;
    return;
  }
  const mesh = hit.object as Mesh;
  if (mesh !== hoveredMesh) {
    clearHoverHighlight();
    hoveredMesh = mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    hoveredEmissive = mats.map((m: any) => (m.emissive ? m.emissive.clone() : new Color(0)));
    mats.forEach((m: any) => {
      if (m.emissive) m.emissive.set(0x333333);
    });
  }

  const geo = mesh.geometry;
  const tris = geo.index ? geo.index.count / 3 : 0;
  const bb = new Box3().setFromObject(mesh);
  const size = new Vector3();
  bb.getSize(size);
  const fn = hit.face ? hit.face.normal : null;

  let faceArea = 0;
  if (fn) {
    const ax = Math.abs(fn.x);
    const ay = Math.abs(fn.y);
    const az = Math.abs(fn.z);
    if (ax >= ay && ax >= az) faceArea = size.y * size.z;
    else if (ay >= ax && ay >= az) faceArea = size.x * size.z;
    else faceArea = size.x * size.y;
  }

  hoverState.info = {
    species: hitSpecies(hit),
    volMm3: meshVolume(geo),
    areaMm2: meshSurfaceArea(geo),
    materials: meshMaterialCount(mesh),
    normal: fn ? { x: fn.x, y: fn.y, z: fn.z } : null,
    faceArea,
    sizeMm: { x: size.x, y: size.y, z: size.z },
    tris,
  };
}

// ─── Render loop ─────────────────────────────────────────────────

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderTiles(tiles, { renderer, scene, camera, axes: axesOverlay });
}

window.addEventListener('resize', () =>
  renderer.setSize(window.innerWidth, window.innerHeight),
);

// ─── Mount Svelte app + wire reactive rebuild ─────────────────────

const appTarget = document.getElementById('svelte-root')!;
mount(App, { target: appTarget, props: { setView: setCameraView } });

animate();

async function boot(): Promise<void> {
  console.log('Loading manifold-3d WASM...');
  await initManifold();
  manifoldReady = true;
  console.log('Manifold ready.');

  rebuildAll();

  const frame = new Box3();
  frame.expandByObject(panelGroup);
  frameCameraToBox(frame, 1.4);

  // After manifold is ready, subscribe to state changes. The effect fires
  // once immediately (harmless — rebuildAll is idempotent), and then on
  // every subsequent mutation of strips/stripHeight/stripLength/passes[].
  attachAppStateEffect(rebuildAll);
}
boot();
