/**
 * End-grain v2.3a — 2D top-down SVG summary renderer.
 *
 * Pure function: `summarize(snapshot)` → SvgString. No DOM access,
 * no THREE.js. Runs headless under Vitest. This is the renderer
 * every non-active stage tile uses in the 3D-rendering-budget scheme
 * (#21): active focus + final output tiles use Three.js; every other
 * tile is a top-down SVG produced here.
 *
 * The input is a PanelSnapshot — plain data, JSON-safe. v2.2's
 * pipeline bakes PlaceEdits and SpacerInserts into the output, so
 * the renderer has nothing to re-apply; it just walks volumes and
 * emits one `<rect>` per volume using species-keyed fill colours.
 *
 * Coordinate convention: the board's top face is the XZ plane at
 * y = bbox.max[1]. We project onto SVG user space with a 90° axis
 * swap so the panel's length axis (world Z) runs HORIZONTALLY and
 * the width / stack axis (world X) runs VERTICALLY — matching the
 * Compose preview's convention:
 *   svgX = worldZ   (length — "runs away from the maker")
 *   svgY = worldX   (width — strip-stacking direction)
 * The SVG `viewBox` is set to the panel's Z × X extent (swapped
 * from the world bbox). No scale factor is applied — consumers
 * size the rendered SVG via CSS or outer width/height attributes.
 *
 * Known limitation: for rip != 0 cuts, each volume is a parallelogram
 * whose AABB over-approximates the true top-face footprint. Rendering
 * `<rect>` per volume in that case produces overlapping rectangles.
 * The 3D viewport (#21) renders actual meshes so this doesn't affect
 * the final output; the 2D summary's role is "enough to recognise
 * the pattern," not production fidelity. If accurate 2D polygons for
 * angled cuts become a requirement (e.g. for a print/export flow),
 * extend PanelSnapshot.volumes[] with per-volume topFace polygons
 * computed from mesh vertices in Panel.toSnapshot().
 */

import type { PanelSnapshot, Species } from '../state/types';

export type SvgString = string;

/**
 * Per-species fill colour, rendered as literal hex in the SVG. CSS
 * can restyle via `[data-species="..."]` selectors without changing
 * the default fill.
 */
export const SPECIES_COLOURS: Record<Species, string> = {
  maple: '#f5deb3',
  walnut: '#5d4037',
  cherry: '#a0522d',
  padauk: '#b1381a',
  purpleheart: '#6a4c8c',
};

const STROKE = '#00000022';
const STROKE_WIDTH = 0.5;

/**
 * Render a collection of slice snapshots (the output of a Cut) as a
 * single SVG with small Z-gaps between slices so the viewer sees
 * them as distinct pieces. The stacked-along-Z layout is the same
 * orientation as `summarize()` — +X right, +Z down — so the Cut
 * tile and the downstream Arrange tile stay visually comparable.
 *
 * With `gap = 0` this produces output equivalent to summarizing
 * the concat of all slices in their baked positions (i.e., the
 * identity-Arrange output). A non-zero gap shifts each slice along
 * +Z by `sliceIdx * gap` so the separations become visible.
 */
export function summarizeSlices(
  slices: PanelSnapshot[],
  options: { gap?: number } = {},
): SvgString {
  const gap = options.gap ?? 10;
  if (slices.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>`;
  }

  // Shift each slice's volumes by (sliceIdx * gap) along +Z and
  // accumulate the composite bbox.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  const shiftedVolumes: PanelSnapshot['volumes'] = [];
  slices.forEach((slice, i) => {
    const dz = i * gap;
    for (const v of slice.volumes) {
      const shifted = {
        species: v.species,
        bbox: {
          min: [v.bbox.min[0], v.bbox.min[1], v.bbox.min[2] + dz] as [number, number, number],
          max: [v.bbox.max[0], v.bbox.max[1], v.bbox.max[2] + dz] as [number, number, number],
        },
        contributingStripIds: [...v.contributingStripIds],
        contributingSliceIds: [...v.contributingSliceIds],
        topFace: v.topFace.map((p) => ({ x: p.x, z: p.z + dz })),
        bottomFace: v.bottomFace.map((p) => ({ x: p.x, z: p.z + dz })),
      };
      shiftedVolumes.push(shifted);
      if (shifted.bbox.min[0] < minX) minX = shifted.bbox.min[0];
      if (shifted.bbox.max[0] > maxX) maxX = shifted.bbox.max[0];
      if (shifted.bbox.min[2] < minZ) minZ = shifted.bbox.min[2];
      if (shifted.bbox.max[2] > maxZ) maxZ = shifted.bbox.max[2];
    }
  });

  return summarize({
    bbox: {
      min: [minX, 0, minZ],
      max: [maxX, 0, maxZ],
    },
    volumes: shiftedVolumes,
  });
}

export function summarize(snapshot: PanelSnapshot): SvgString {
  const { min, max } = snapshot.bbox;
  const minX = min[0];
  const minZ = min[2];
  const extentX = Math.max(0, max[0] - min[0]);
  const extentZ = Math.max(0, max[2] - min[2]);

  // Axis swap: world Z → SVG X, world X → SVG Y. ViewBox therefore
  // uses (minZ, minX, extentZ, extentX).
  const header =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${fmt(minZ)} ${fmt(minX)} ${fmt(extentZ)} ${fmt(extentX)}" ` +
    `preserveAspectRatio="xMidYMid meet">`;

  const shapes = snapshot.volumes.map(volumeShape).join('');
  return `${header}${shapes}</svg>`;
}

/**
 * Emit a `<polygon>` from the volume's topFace when present, so
 * angled / rotated geometry renders as its true top-down footprint.
 * Falls back to `<rect>` from the bbox if topFace is missing or
 * degenerate (< 3 points) — defensive; should not happen for any
 * valid pipeline-produced volume.
 */
function volumeShape(v: PanelSnapshot['volumes'][number]): string {
  const fill = SPECIES_COLOURS[v.species];
  const stroke = `stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"`;
  const species = `data-species="${v.species}"`;
  // Axis swap: world (x, z) → SVG (z, x).
  if (v.topFace && v.topFace.length >= 3) {
    const pts = v.topFace.map((p) => `${fmt(p.z)},${fmt(p.x)}`).join(' ');
    return `<polygon points="${pts}" fill="${fill}" ${stroke} ${species}/>`;
  }
  // Fallback — should be unreachable for pipeline output.
  const x = v.bbox.min[0];
  const z = v.bbox.min[2];
  const w = v.bbox.max[0] - v.bbox.min[0];
  const h = v.bbox.max[2] - v.bbox.min[2];
  return (
    `<rect x="${fmt(z)}" y="${fmt(x)}" ` +
    `width="${fmt(h)}" height="${fmt(w)}" ` +
    `fill="${fill}" ${stroke} ${species}/>`
  );
}

/**
 * Format a number for SVG output. Strip trailing zeros, clamp to
 * millimetre precision (3 decimals). Deterministic → snapshot tests
 * don't see spurious string churn from floating-point noise.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  // Avoid "-0"
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}
