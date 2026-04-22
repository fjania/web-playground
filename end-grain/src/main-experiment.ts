/**
 * Side-quest harness — four pieces (rectangle, parallelogram, wedge,
 * doorstop) scattered into a single 3D scene at random orientation
 * and position. Each piece starts as a 500 × 50 × 50 mm bar of ten
 * 50 mm cubes alternating between its own pair of species, then gets
 * cut via the main pipeline's Manifold plane-clipping path.
 */

import { Box3, Group, Matrix4, Quaternion, Vector3 } from 'three';

import { initManifold } from './domain/manifold';
import { Panel } from './domain/Panel';
import { buildPanelGroup } from './scene/meshBuilder';
import { setupViewport, type ViewportHandle } from './scene/viewport';
import type { Species, StripDef } from './state/types';

const STRIP_COUNT = 10;
const STRIP_WIDTH = 50;
const BLOCK_HEIGHT = 50;
const BLOCK_DEPTH = 50;

/** Minimum clearance between any two pieces' AABBs, in mm. */
const PLACEMENT_MARGIN = 30;
/** Half-extent of the random placement volume, per axis, in mm. */
const SCENE_HALF = { x: 320, y: 160, z: 220 };
/** Rejection-sampling budget per piece before giving up. */
const MAX_PLACE_ATTEMPTS = 1200;

interface PieceDef {
  name: string;
  pair: [Species, Species];
  build: (prefix: string, pair: [Species, Species]) => Panel;
}

function makeAlternatingStrips(
  prefix: string,
  pair: [Species, Species],
): StripDef[] {
  const strips: StripDef[] = [];
  for (let i = 0; i < STRIP_COUNT; i++) {
    strips.push({
      stripId: `${prefix}-${i}`,
      species: pair[i % 2],
      width: STRIP_WIDTH,
    });
  }
  return strips;
}

function buildRectangle(prefix: string, pair: [Species, Species]): Panel {
  return Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
}

/**
 * Parallelogram: two 45° cuts in the XZ plane remove opposite corner
 * triangles at the short ends so the top-down outline becomes a
 * parallelogram. Both cuts keep the `below` half.
 */
function buildParallelogram(prefix: string, pair: [Species, Species]): Panel {
  const base = Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
  const INV_SQRT2 = 1 / Math.SQRT2;
  const offset = 225 * INV_SQRT2;
  const leftCut = base.cut([-INV_SQRT2, 0, INV_SQRT2], offset);
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut([INV_SQRT2, 0, -INV_SQRT2], offset);
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Wedge: two angled cuts in the YZ plane collapse the 50×50 end
 * face into a triangle with apex at (y=+25, z=0) and flat base
 * along y=-25 from z=-25 to z=+25.
 */
function buildWedge(prefix: string, pair: [Species, Species]): Panel {
  const base = Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
  const INV_SQRT5 = 1 / Math.sqrt(5);
  const offset = 5 * Math.sqrt(5);
  const leftCut = base.cut([0, INV_SQRT5, -2 * INV_SQRT5], offset);
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut([0, INV_SQRT5, 2 * INV_SQRT5], offset);
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Doorstop: both long edges of the top-down XZ rectangle taper evenly
 * inward to a point at X=+250, producing a tall isosceles triangle
 * when viewed from above. Base (Z from -25 to +25) stays at X=-250.
 * Y extent is unchanged, so the piece looks like a 500×50 rectangle
 * from the side.
 *
 * Cut planes (vertical, extruded along Y):
 *   1. through (-250, ·, +25) → (+250, ·, 0), normal (1, 0, 20)/√401
 *   2. through (-250, ·, -25) → (+250, ·, 0), normal (1, 0, -20)/√401
 * Both share offset 250/√401, and both keep the `below` half.
 */
function buildDoorstop(prefix: string, pair: [Species, Species]): Panel {
  const base = Panel.fromStrips(
    makeAlternatingStrips(prefix, pair),
    BLOCK_HEIGHT,
    BLOCK_DEPTH,
  );
  const INV_SQRT401 = 1 / Math.sqrt(401);
  const offset = 250 * INV_SQRT401;
  const topCut = base.cut([INV_SQRT401, 0, 20 * INV_SQRT401], offset);
  base.dispose();
  topCut.above.dispose();
  const bottomCut = topCut.below.cut(
    [INV_SQRT401, 0, -20 * INV_SQRT401],
    offset,
  );
  topCut.below.dispose();
  bottomCut.above.dispose();
  return bottomCut.below;
}

const PIECES: PieceDef[] = [
  { name: 'rect', pair: ['maple', 'walnut'], build: buildRectangle },
  { name: 'parallelogram', pair: ['cherry', 'walnut'], build: buildParallelogram },
  { name: 'wedge', pair: ['padauk', 'maple'], build: buildWedge },
  { name: 'doorstop', pair: ['purpleheart', 'cherry'], build: buildDoorstop },
];

/**
 * Shoemake uniform random rotation: samples three uniforms and
 * assembles a quaternion distributed uniformly on SO(3). Necessary
 * because naive Euler-angle randomization biases toward the poles.
 */
function randomRotationMatrix(): Matrix4 {
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();
  const q = new Quaternion(
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
  );
  return new Matrix4().makeRotationFromQuaternion(q);
}

/**
 * Rotate `panel` by a random orientation, then rejection-sample
 * translations until the expanded AABB clears every previously
 * placed box. Returns the placed Panel and its raw AABB so the
 * caller can track the occupied region for subsequent pieces.
 */
function placePanel(
  panel: Panel,
  existing: Box3[],
): { placed: Panel; box: Box3 } | null {
  const rotated = panel.transform(randomRotationMatrix());
  const localBox = rotated.boundingBox();
  const offset = new Vector3();
  for (let i = 0; i < MAX_PLACE_ATTEMPTS; i++) {
    offset.set(
      (Math.random() - 0.5) * 2 * SCENE_HALF.x,
      (Math.random() - 0.5) * 2 * SCENE_HALF.y,
      (Math.random() - 0.5) * 2 * SCENE_HALF.z,
    );
    const candidate = localBox
      .clone()
      .translate(offset)
      .expandByScalar(PLACEMENT_MARGIN);
    if (!existing.some((e) => candidate.intersectsBox(e))) {
      const placed = rotated.translate(offset.x, offset.y, offset.z);
      rotated.dispose();
      return { placed, box: placed.boundingBox() };
    }
  }
  rotated.dispose();
  return null;
}

/** Build a single scatter attempt. Returns null if any piece fails to place. */
function tryBuildScene(): { root: Group; placedPanels: Panel[] } | null {
  const root = new Group();
  const existing: Box3[] = [];
  const placedPanels: Panel[] = [];
  for (const piece of PIECES) {
    const built = piece.build(piece.name, piece.pair);
    const result = placePanel(built, existing);
    built.dispose();
    if (!result) {
      placedPanels.forEach((p) => p.dispose());
      return null;
    }
    existing.push(result.box);
    root.add(buildPanelGroup(result.placed));
    placedPanels.push(result.placed);
  }
  return { root, placedPanels };
}

/**
 * Retry the whole scatter on failure. Placement failure comes from an
 * unlucky rotation combination, not a fundamentally infeasible layout
 * — fresh rotations almost always fit the same scene bounds.
 */
const MAX_SCENE_ATTEMPTS = 6;
function buildScene(): { root: Group; placedCount: number } {
  for (let i = 0; i < MAX_SCENE_ATTEMPTS; i++) {
    const scene = tryBuildScene();
    if (scene) {
      scene.placedPanels.forEach((p) => p.dispose());
      return { root: scene.root, placedCount: scene.placedPanels.length };
    }
  }
  console.warn('[3d-experiment] scene placement never fit all pieces');
  return { root: new Group(), placedCount: 0 };
}

const ISO_VIEW = {
  direction: [-0.55, -0.5, -0.67] as [number, number, number],
  up: [0, 1, 0] as [number, number, number],
};

async function boot(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>('[data-slot="status"]');
  const tileEl = document.querySelector<HTMLElement>('[data-tile="scene"]');
  const reshuffleBtn = document.querySelector<HTMLButtonElement>(
    '[data-slot="reshuffle"]',
  );
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };
  if (!tileEl) throw new Error('missing scene tile');

  try {
    setStatus('loading Manifold WASM…');
    await initManifold();

    let handle: ViewportHandle | null = null;

    const render = () => {
      handle?.dispose();
      const { root, placedCount } = buildScene();
      handle = setupViewport(tileEl, root, { initialCameraState: ISO_VIEW });
      setStatus(
        `${placedCount}/${PIECES.length} pieces · drag to orbit · scroll to zoom · reshuffle for a new layout`,
      );
    };

    render();
    reshuffleBtn?.addEventListener('click', render);
  } catch (err) {
    console.error('[3d-experiment] boot failed', err);
    setStatus(
      `boot failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

boot();
