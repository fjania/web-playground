/**
 * Side-quest harness — three blocks rendered side-by-side in 3D to
 * compare the interaction feel of (a) a plain rectangle, (b) a
 * parallelogram, and (c) a triangular wedge. Each block starts as a
 * 500 × 50 × 50 mm bar of ten 50 mm alternating-species cubes, then
 * gets cut via the same Manifold plane-clipping path the main app
 * uses for production cuts.
 */

import { initManifold } from './domain/manifold';
import { Panel } from './domain/Panel';
import { buildPanelGroup } from './scene/meshBuilder';
import { setupViewport } from './scene/viewport';
import type { StripDef, Species } from './state/types';

const STRIP_COUNT = 10;
const STRIP_WIDTH = 50;
const BLOCK_HEIGHT = 50;
const BLOCK_DEPTH = 50;

/** Ten alternating maple/walnut cubes that compose a 500×50×50 bar. */
function makeAlternatingStrips(prefix: string): StripDef[] {
  const strips: StripDef[] = [];
  for (let i = 0; i < STRIP_COUNT; i++) {
    const species: Species = i % 2 === 0 ? 'maple' : 'walnut';
    strips.push({ stripId: `${prefix}-${i}`, species, width: STRIP_WIDTH });
  }
  return strips;
}

function buildRectangle(): Panel {
  return Panel.fromStrips(makeAlternatingStrips('rect'), BLOCK_HEIGHT, BLOCK_DEPTH);
}

/**
 * Parallelogram: two 45° cuts in the XZ plane remove opposite corner
 * triangles at the short ends so the top-down outline becomes a
 * parallelogram.
 *
 * - Left cut: plane through (-250, ·, -25) and (-200, ·, +25). Normal
 *   (-1, 0, 1)/√2 points toward the upper-left triangle that gets
 *   dropped.
 * - Right cut: plane through (+250, ·, +25) and (+200, ·, -25). Normal
 *   (1, 0, -1)/√2 points toward the lower-right triangle.
 *
 * Both cuts keep the `below` half — the parallelogram bulk.
 */
function buildParallelogram(): Panel {
  const base = Panel.fromStrips(makeAlternatingStrips('para'), BLOCK_HEIGHT, BLOCK_DEPTH);
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
 * Wedge: two angled cuts in the YZ plane collapse the 50×50 end face
 * into a triangle with apex at (y=+25, z=0) and flat base along
 * y=-25 from z=-25 to z=+25.
 *
 * - Left cut: plane through (·, +25, 0) and (·, -25, -25). Normal
 *   (0, 1, -2)/√5, offset 5√5. Keep below to discard the z<0 wedge
 *   outside the triangle.
 * - Right cut: mirror with normal (0, 1, +2)/√5.
 */
function buildWedge(): Panel {
  const base = Panel.fromStrips(makeAlternatingStrips('wedge'), BLOCK_HEIGHT, BLOCK_DEPTH);
  const INV_SQRT5 = 1 / Math.sqrt(5);
  const offset = 5 * Math.sqrt(5); // = 25 / √5
  const leftCut = base.cut([0, INV_SQRT5, -2 * INV_SQRT5], offset);
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut([0, INV_SQRT5, 2 * INV_SQRT5], offset);
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Near-isometric camera direction (camera → target, unit length).
 * Camera sits roughly at (+1, +1, +1); equal projection of the three
 * primary faces makes the wedge's triangular end face and the
 * parallelogram's slanted end equally visible. Up = +Y.
 */
const ISO_VIEW = {
  direction: [-0.55, -0.5, -0.67] as [number, number, number],
  up: [0, 1, 0] as [number, number, number],
};

function mountBlock(tileEl: HTMLElement, panel: Panel): void {
  const group = buildPanelGroup(panel);
  setupViewport(tileEl, group, { initialCameraState: ISO_VIEW });
}

async function boot(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>('[data-slot="status"]');
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };

  try {
    setStatus('loading Manifold WASM…');
    await initManifold();

    const tiles: Array<[string, () => Panel]> = [
      ['rect', buildRectangle],
      ['parallelogram', buildParallelogram],
      ['wedge', buildWedge],
    ];

    for (const [name, make] of tiles) {
      const tileEl = document.querySelector<HTMLElement>(`[data-tile="${name}"]`);
      if (!tileEl) throw new Error(`missing tile element for ${name}`);
      const panel = make();
      mountBlock(tileEl, panel);
    }

    setStatus('ready · drag to orbit · scroll to zoom · home button resets view');
  } catch (err) {
    console.error('[3d-experiment] boot failed', err);
    setStatus(`boot failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

boot();
