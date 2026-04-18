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
 * y = bbox.max[1]. We project directly onto SVG user space:
 *   svgX = worldX
 *   svgY = worldZ
 * with the SVG `viewBox` set to the panel's X × Z extent. No scale
 * factor is applied — consumers size the rendered SVG via CSS or
 * outer width/height attributes.
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

export function summarize(snapshot: PanelSnapshot): SvgString {
  const { min, max } = snapshot.bbox;
  const minX = min[0];
  const minZ = min[2];
  const extentX = Math.max(0, max[0] - min[0]);
  const extentZ = Math.max(0, max[2] - min[2]);

  const header =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${fmt(minX)} ${fmt(minZ)} ${fmt(extentX)} ${fmt(extentZ)}" ` +
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
  if (v.topFace && v.topFace.length >= 3) {
    const pts = v.topFace.map((p) => `${fmt(p.x)},${fmt(p.z)}`).join(' ');
    return `<polygon points="${pts}" fill="${fill}" ${stroke} ${species}/>`;
  }
  // Fallback — should be unreachable for pipeline output.
  const x = v.bbox.min[0];
  const z = v.bbox.min[2];
  const w = v.bbox.max[0] - v.bbox.min[0];
  const h = v.bbox.max[2] - v.bbox.min[2];
  return (
    `<rect x="${fmt(x)}" y="${fmt(z)}" ` +
    `width="${fmt(w)}" height="${fmt(h)}" ` +
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
