/**
 * End-grain v2.3b bootstrap — wires pipeline output into the tile grid.
 *
 * Commit (a): placeholder-only. Future commits will:
 *   - (b) initialise a Three.js renderer for the arrange-0 tile and
 *     draw the live final panel;
 *   - (c) render 2D SVG summaries into the compose / cut tiles;
 *   - (d) add tile-mode switching (click a 2D tile to promote it to
 *     a second 3D viewport; re-click to demote).
 *
 * Currently: logs a confirmation so the page load chain is
 * observable. No DOM mutations, no pipeline calls.
 */

import { initManifold } from '../domain/manifold';

await initManifold();

// eslint-disable-next-line no-console
console.log('[end-grain v2.3b] bootstrap loaded; placeholders only');
