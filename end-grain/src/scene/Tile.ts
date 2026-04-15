import type { Group, Object3D } from 'three';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileInit {
  /** Stable id (used for DOM overlays + debug). */
  id: string;
  /** CSS-pixel background color for the tile. */
  bg: number;
  /** The root Group this tile displays (scene geometry). */
  root: Group;
  /**
   * Scene objects (plane viz, highlights) that should only be visible when
   * this tile is the one being rendered. Visibility is toggled alongside the
   * root during each render pass.
   */
  overlays?: Object3D[];
  /**
   * Whether this tile can be raycast for hover + click selection. Defaults
   * to true. Set false for join/preview tiles that shouldn't grab clicks.
   */
  pickable?: boolean;
  /**
   * Groups to raycast against for hover/click. If omitted, the raycaster
   * uses `[root, ...overlays]`. Useful when some overlays (plane viz,
   * highlights) are meshes that shouldn't respond to picking.
   */
  pickableGroups?: Object3D[];
  /**
   * Compute the tile's viewport rect in CSS pixels. Evaluated every frame so
   * the tile reflows on window resize and reads from the current layout.
   */
  rect: () => Rect;
}

/**
 * A Tile is one of the renderer's scissored viewports. It owns a Group
 * (visible only while rendering this tile), an optional set of overlays,
 * and a function that returns its current CSS-pixel rect.
 *
 * Tiles are generic — they don't know which "pass" they belong to. The
 * controller (main app) wires each tile to an upstream Panel.
 */
export class Tile {
  readonly id: string;
  readonly bg: number;
  readonly root: Group;
  readonly overlays: Object3D[];
  readonly pickable: boolean;
  readonly pickableGroups: Object3D[];
  readonly #rect: () => Rect;

  constructor(init: TileInit) {
    this.id = init.id;
    this.bg = init.bg;
    this.root = init.root;
    this.overlays = init.overlays ?? [];
    this.pickable = init.pickable ?? true;
    this.pickableGroups = init.pickableGroups ?? [init.root, ...(init.overlays ?? [])];
    this.#rect = init.rect;
  }

  rect(): Rect {
    return this.#rect();
  }

  /** Toggle visibility of the root + all overlays. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    for (const o of this.overlays) o.visible = visible;
  }

  /** Does a CSS-pixel coordinate land inside this tile? */
  contains(clientX: number, clientY: number): boolean {
    const r = this.rect();
    return (
      clientX >= r.x &&
      clientX < r.x + r.w &&
      clientY >= r.y &&
      clientY < r.y + r.h
    );
  }

  /**
   * Convert a CSS-pixel coordinate inside the tile into normalized device
   * coords (−1..+1). Note: the tile's viewport y in CSS is measured from the
   * top of the page, not the bottom of the canvas.
   */
  ndc(clientX: number, clientY: number): { nx: number; ny: number } {
    const r = this.rect();
    const nx = ((clientX - r.x) / r.w) * 2 - 1;
    const ny = -((clientY - r.y) / r.h) * 2 + 1;
    return { nx, ny };
  }
}
