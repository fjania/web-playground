import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { AxesOverlay } from './axes';
import type { Tile } from './Tile';

export interface RenderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  axes?: AxesOverlay;
  /** Inset (in CSS pixels) for the per-tile axes gizmo. */
  axesSize?: number;
}

/**
 * Look up which tile (if any) a CSS-pixel coordinate lands in. Tiles are
 * tested in order so place the starting-panel first etc. if you layer any
 * overlapping regions (normal tiles don't overlap).
 */
export function tileAt(tiles: Tile[], clientX: number, clientY: number): Tile | undefined {
  return tiles.find((t) => t.contains(clientX, clientY));
}

/**
 * Render one frame of a tiled viewport layout. For each tile:
 *   - Toggle visibility so only its root + overlays render.
 *   - Set the scissor + viewport to the tile's CSS-pixel rect (converted
 *     to WebGL bottom-up coords).
 *   - Render the shared scene through the shared camera.
 *   - Optionally render the axes gizmo overlay in the tile's bottom-left.
 */
export function renderTiles(tiles: Tile[], ctx: RenderContext): void {
  const { renderer, scene, camera, axes, axesSize = 80 } = ctx;
  const H = renderer.domElement.clientHeight;

  renderer.setScissorTest(true);
  if (axes) axes.alignTo(camera);

  for (const tile of tiles) {
    // Make only this tile's geometry visible during its pass.
    for (const other of tiles) other.setVisible(other === tile);

    const { x, y, w, h } = tile.rect();
    // Convert top-origin CSS y to bottom-origin GL y.
    const glY = H - (y + h);

    renderer.setViewport(x, glY, w, h);
    renderer.setScissor(x, glY, w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setClearColor(tile.bg, 1);
    renderer.clear();
    renderer.render(scene, camera);

    if (axes) {
      const ax = x + 8;
      const ay = glY + 8;
      renderer.setViewport(ax, ay, axesSize, axesSize);
      renderer.setScissor(ax, ay, axesSize, axesSize);
      renderer.clearDepth();
      renderer.render(axes.scene, axes.camera);
    }
  }

  renderer.setScissorTest(false);
}
