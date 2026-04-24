/**
 * Canonical Strip builders used across the harness and tests. Extracted
 * from main-experiment so tests can import these without pulling in
 * DOM-dependent scene modules (materials.ts builds canvas textures at
 * import time).
 *
 * Each builder produces a bench-ready strip in the default "long axis
 * along +X, center at origin" orientation. Placement / dropping onto
 * the bench is the caller's responsibility.
 */

import { Strip } from './Strip';
import type { Species } from '../state/types';

export const BLOCK_COUNT = 10;
export const BLOCK_SIZE = { width: 50, height: 50, depth: 50 };

export function buildRectangle(
  pieceId: string,
  pair: [Species, Species],
): Strip {
  return Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
}

/**
 * Two 45° rips in the XZ plane chop opposite short-end corners so the
 * top-down outline becomes a parallelogram.
 */
export function buildParallelogram(
  pieceId: string,
  pair: [Species, Species],
): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT2 = 1 / Math.SQRT2;
  const offset = 225 * INV_SQRT2;
  const leftCut = base.cut({ normal: [-INV_SQRT2, 0, INV_SQRT2], offset });
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut({
    normal: [INV_SQRT2, 0, -INV_SQRT2],
    offset,
  });
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Two YZ-plane rips collapse the 50×50 cross-section into a triangle
 * — apex at (y=+25, z=0), base along y=-25 from z=-25 to z=+25.
 */
export function buildWedge(pieceId: string, pair: [Species, Species]): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT5 = 1 / Math.sqrt(5);
  const offset = 5 * Math.sqrt(5);
  const leftCut = base.cut({
    normal: [0, INV_SQRT5, -2 * INV_SQRT5],
    offset,
  });
  base.dispose();
  leftCut.above.dispose();
  const rightCut = leftCut.below.cut({
    normal: [0, INV_SQRT5, 2 * INV_SQRT5],
    offset,
  });
  leftCut.below.dispose();
  rightCut.above.dispose();
  return rightCut.below;
}

/**
 * Two XZ-plane rips taper both long edges inward to a point at x=+250,
 * producing a tall isosceles triangle when viewed top-down.
 */
export function buildDoorstop(pieceId: string, pair: [Species, Species]): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT401 = 1 / Math.sqrt(401);
  const offset = 250 * INV_SQRT401;
  const topCut = base.cut({
    normal: [INV_SQRT401, 0, 20 * INV_SQRT401],
    offset,
  });
  base.dispose();
  topCut.above.dispose();
  const bottomCut = topCut.below.cut({
    normal: [INV_SQRT401, 0, -20 * INV_SQRT401],
    offset,
  });
  topCut.below.dispose();
  bottomCut.above.dispose();
  return bottomCut.below;
}

/**
 * A single 45° rip along the full length chops off the +Y / +Z corner
 * of the 50×50 cross-section.
 */
export function buildBevel(pieceId: string, pair: [Species, Species]): Strip {
  const base = Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, BLOCK_SIZE);
  const INV_SQRT2 = 1 / Math.SQRT2;
  const cut = base.cut({
    normal: [0, INV_SQRT2, INV_SQRT2],
    offset: 25 * INV_SQRT2,
  });
  base.dispose();
  cut.above.dispose();
  return cut.below;
}

/**
 * Same rectangular bar as `buildRectangle` but with a 100 mm cross-
 * section depth (Z) instead of 50 mm — a wider "board" of the same length.
 */
export function buildWide(pieceId: string, pair: [Species, Species]): Strip {
  return Strip.fromAlternatingBlocks(pieceId, pair, BLOCK_COUNT, {
    width: BLOCK_SIZE.width,
    height: BLOCK_SIZE.height,
    depth: 100,
  });
}
