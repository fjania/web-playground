/**
 * Shared 3D viewport scaffolding for the focused operation harnesses.
 *
 * One entry point — `setupViewport(tileEl, panelGroup, options)` —
 * takes a tile with a `[data-slot="render"]` slot and a panel Group
 * containing the scene's meshes. It wires up a WebGLRenderer with a
 * perspective camera auto-fitted to the panel, TrackballControls
 * with full 3-DoF orbit freedom, an XYZ axis gizmo in the upper-right
 * corner, and a home button to reset the view. Returns a handle with
 * a `dispose()` that tears everything down.
 *
 * Keeping this module free of feature-specific logic means each
 * focused harness (3d-cut.html for Cut, 3d-arrange.html for
 * Arrange, …) can reuse the whole 3D stack — and the main canvas
 * inherits every interaction improvement whenever #31's
 * selection-driven rebinding lands.
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
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { disposePanelGroup } from './meshBuilder';

export interface ViewportHandle {
  dispose: () => void;
}

export interface ViewportOptions {
  /**
   * Kept for API parity with the main canvas; the focused harnesses
   * treat every viewport the same way, so options are currently
   * cosmetic.
   */
  mode?: '3d-final' | '3d-active';
  /**
   * Which world axis maps to the screen-vertical direction (with that
   * axis's +side pointing DOWN on screen). Default `'z'` matches the
   * 2D summary-tile convention (+X right, +Z down) used by Cut,
   * Arrange, and Trim.
   *
   * ComposeStrips uses `'x'`: strip length (world Z) runs horizontally
   * and the stack (world +X) builds downward — so the 3D output and
   * the Operation tile read as the same panel viewed the same way,
   * and the Input inventory list's top-to-bottom species order lines
   * up with the 3D panel top-to-bottom.
   */
  vertical?: 'z' | 'x';
}

export function setupViewport(
  tileEl: HTMLElement,
  panelGroup: Group,
  options: ViewportOptions = {},
): ViewportHandle {
  const vertical: 'z' | 'x' = options.vertical ?? 'z';
  const slot = tileEl.querySelector<HTMLElement>('[data-slot="render"]');
  if (!slot) throw new Error('tile missing render slot');
  slot.innerHTML = '';

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  slot.appendChild(renderer.domElement);

  // Home button overlay — sibling of the canvas, absolutely positioned
  // in the upper-right corner. Snaps the camera back to the initial
  // top-down fit view so the user can recover orientation after
  // heavy orbiting.
  const homeButton = buildHomeButton();
  slot.appendChild(homeButton);

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

  // Camera orientation matches the 2D summary's top-down convention.
  //
  //   vertical='z' (default):  screen-horizontal = world X,
  //                            screen-vertical   = world Z (+Z down).
  //                            camera.up = (0, 0, -1). Used by Cut,
  //                            Arrange, Trim.
  //
  //   vertical='x':            screen-horizontal = world Z,
  //                            screen-vertical   = world X (+X down).
  //                            camera.up = (-1, 0, 0). Used by
  //                            ComposeStrips so the 3D panel reads
  //                            top-to-bottom like the Input
  //                            inventory list and the Operation
  //                            tile's rotated layout.
  //
  // In both cases, the tilt angle is 20° off straight-down along the
  // screen-vertical axis, so the panel reads as a slightly-tilted
  // 3/4 view with the Y thickness showing as a side lip. The tilt
  // moves the camera toward the -side of the screen-vertical axis,
  // so the +side (which is at the bottom of screen) is closer and
  // visually nearer.
  const tilt = 0.35; // radians ≈ 20°
  const fovDeg = 45;
  const fovRad = (fovDeg * Math.PI) / 180;
  const halfFovV = fovRad / 2;

  // Project the panel's world extents onto the camera's screen axes.
  const horizontalExtent = vertical === 'z' ? size.x : size.z;
  const verticalSizeAxis = vertical === 'z' ? size.z : size.x;
  const verticalExtent = size.y * Math.sin(tilt) + verticalSizeAxis * Math.cos(tilt);

  function computeFitDistance(aspect: number): number {
    const halfFovH = Math.atan(aspect * Math.tan(halfFovV));
    const distV = extentToDist(verticalExtent, halfFovV);
    const distH = extentToDist(horizontalExtent, halfFovH);
    return Math.max(distV, distH) * 1.18; // ~18% padding (9% per side)
  }
  function extentToDist(extent: number, halfFov: number): number {
    return extent / 2 / Math.tan(halfFov);
  }

  const initialAspect = slot.clientWidth / slot.clientHeight || 1;
  const camera = new PerspectiveCamera(fovDeg, initialAspect, 0.5, diag * 10);
  const initialUp: [number, number, number] =
    vertical === 'z' ? [0, 0, -1] : [-1, 0, 0];
  camera.up.set(initialUp[0], initialUp[1], initialUp[2]);
  camera.lookAt(centre);
  positionCameraAtDistance(computeFitDistance(initialAspect));

  function positionCameraAtDistance(d: number): void {
    if (vertical === 'z') {
      camera.position.set(
        centre.x,
        centre.y + d * Math.cos(tilt),
        centre.z - d * Math.sin(tilt),
      );
    } else {
      camera.position.set(
        centre.x - d * Math.sin(tilt),
        centre.y + d * Math.cos(tilt),
        centre.z,
      );
    }
    camera.lookAt(centre);
  }

  // TrackballControls instead of OrbitControls so the user can freely
  // rotate around every axis — including roll about the view direction
  // (which OrbitControls prevents by keeping camera.up fixed). Full
  // 360° around X, Y, and Z.
  const controls = new TrackballControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.rotateSpeed = 3.0;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;
  controls.noRotate = false;
  controls.noZoom = false;
  controls.noPan = false;
  controls.staticMoving = false;
  controls.dynamicDampingFactor = 0.15;
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  controls.update();

  // Once the user orbits / dollies, stop auto-fitting on resize so
  // we don't snap their chosen view.
  let userHasInteracted = false;
  controls.addEventListener('start', () => {
    userHasInteracted = true;
  });

  // Wire the home button: reset orbit to the initial top-down fit.
  homeButton.addEventListener('click', () => {
    camera.up.set(initialUp[0], initialUp[1], initialUp[2]);
    const aspect = slot.clientWidth / slot.clientHeight || 1;
    positionCameraAtDistance(computeFitDistance(aspect));
    controls.target.copy(centre);
    controls.update();
    userHasInteracted = false;
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
    controls.handleResize();

    if (!userHasInteracted) {
      positionCameraAtDistance(computeFitDistance(aspect));
      controls.update();
    }
  }

  // ---- Axis gizmo overlay ----
  //
  // Secondary scene with three colour-coded axis lines + letter
  // sprites. Rendered in a small corner viewport after the main
  // scene so it floats on top. The gizmo camera shares the main
  // camera's quaternion so the axes track the user's orbit exactly.
  const gizmoScene = new Scene();
  gizmoScene.add(buildAxisGizmo());
  const gizmoCamera = new OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 100);
  const GIZMO_CAMERA_DISTANCE = 3;
  const GIZMO_PX = 72;
  const GIZMO_MARGIN_RIGHT = 8;
  // Leave room above for the home button (22px button + 8 top + 8 gap).
  const GIZMO_MARGIN_TOP = 38;

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

    // Gizmo pass — match the main camera's rotation; render in a
    // small corner viewport with depth cleared so it sits on top
    // regardless of main-scene geometry depth. autoClearColor is
    // suppressed so the gizmo floats without a backing rectangle.
    gizmoCamera.quaternion.copy(camera.quaternion);
    gizmoCamera.position
      .set(0, 0, GIZMO_CAMERA_DISTANCE)
      .applyQuaternion(gizmoCamera.quaternion);
    gizmoCamera.updateMatrixWorld();
    const gx = w - GIZMO_PX - GIZMO_MARGIN_RIGHT;
    const gy = h - GIZMO_PX - GIZMO_MARGIN_TOP;
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
      if (homeButton.parentElement) {
        homeButton.parentElement.removeChild(homeButton);
      }
    },
  };
}

/**
 * Home button — resets the 3D viewport to the initial top-down fit.
 * Absolutely positioned at the upper-right corner of the render slot.
 */
function buildHomeButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Reset view to top-down');
  btn.title = 'Reset view to top-down';
  Object.assign(btn.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '22px',
    height: '22px',
    padding: '0',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: '3px',
    background: 'rgba(255,255,255,0.1)',
    color: '#f0ece6',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    transition: 'background 120ms ease',
    zIndex: '2',
  } as unknown as CSSStyleDeclaration);
  btn.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M3 12 L12 3 L21 12"/>` +
    `<path d="M5 10 V20 H9 V14 H15 V20 H19 V10"/>` +
    `</svg>`;
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(255,255,255,0.2)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(255,255,255,0.1)';
  });
  return btn;
}

/**
 * XYZ orientation gizmo — red X, green Y, blue Z axis lines with
 * sprite labels at each tip. The returned Group lives in its own
 * scene so it renders independently of the main camera.
 */
function buildAxisGizmo(): Group {
  const g = new Group();

  const AXIS_LEN = 1;
  const positions = new Float32Array([
    0, 0, 0, AXIS_LEN, 0, 0, // +X
    0, 0, 0, 0, AXIS_LEN, 0, // +Y
    0, 0, 0, 0, 0, AXIS_LEN, // +Z
  ]);
  const colors = new Float32Array([
    1, 0.25, 0.25, 1, 0.25, 0.25, // red X
    0.25, 0.8, 0.3, 0.25, 0.8, 0.3, // green Y
    0.35, 0.55, 1, 0.35, 0.55, 1, // blue Z
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
