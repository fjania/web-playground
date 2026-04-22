/**
 * Operation-view renderers — each Feature kind that operates on a
 * panel gets a function here that renders the OPERATION itself (its
 * geometry and parameters) as a 2D SVG overlay. Distinct from
 * `summary.ts`, which renders panel SNAPSHOTS (the thing an operation
 * *produces*).
 *
 * Design principle: the pipeline's output is the source of truth.
 * The renderer reads cut-plane positions, offcut shapes, etc. out of
 * the CutResult snapshots — it does NOT re-derive them from the Cut
 * feature's parameters. That keeps the renderer and the pipeline in
 * lockstep: if executeCut's formulas change, the rendered view
 * updates automatically because both are driven by the produced
 * slice/offcut geometry.
 *
 * For Cut we emit TWO orthographic projections placed side-by-side.
 * Axis convention matches `summary.ts`: world Z (length) → SVG X
 * (horizontal), world X (strip width / stacking) → SVG Y (vertical).
 *
 *   TOP  — XZ plan view. Panel outline from the input snapshot,
 *          cut-plane lines drawn between shared vertices of
 *          adjacent slice/offcut topFace polygons, offcut regions
 *          rendered from the offcut snapshots' topFace polygons.
 *          (z, x) → SVG (x, y).
 *
 *   SIDE — YZ elevation, cross-section at x = 0. Horizontal axis =
 *          world Z (length, matches TOP); vertical axis = world Y
 *          (panel thickness). Cut lines at the same Z therefore
 *          land at the same horizontal screen position as in TOP.
 *          Cut-plane lines drawn from (z_shared_top, y_max) to
 *          (z_shared_bottom, y_min). Offcut shading = each offcut's
 *          cross-section at x=0 between its top and bottom edges.
 *
 * Layout: vertical flex — TOP on top (taller), SIDE beneath it
 * (shorter). Both span the tile's full width so their Z axes render
 * at the same scale; cut lines at the same d land at the same
 * horizontal screen position.
 *
 * Operation views for Arrange/PlaceEdit/Preset will be added as the
 * corresponding feature-editing issues land (#27–#36).
 */

import { summarize } from './summary';
import type {
  ArrangeResult,
  CutResult,
  PanelSnapshot,
  PlaceEdit,
  SpacerInsert,
  TrimPanelResult,
} from '../state/types';

type HtmlString = string;
type SvgString = string;
type Point2D = { x: number; z: number };
type Segment2D = [Point2D, Point2D];

const DASHED_STROKE =
  'stroke="#1a1a1a" stroke-width="1.2" ' +
  'stroke-dasharray="8 5" vector-effect="non-scaling-stroke"';
const OFFCUT_FILL = 'fill="#0000000d" stroke="none" pointer-events="none"';
const PANEL_OUTLINE =
  'fill="#fafaf7" stroke="#00000033" stroke-width="0.5" ' +
  'vector-effect="non-scaling-stroke"';

const VERTEX_MATCH_EPS = 1e-3; // mm — vertices closer than this count as shared.
const X_CROSS_EPS = 1e-6;

/**
 * Render a Cut operation as two orthographic projections placed
 * side-by-side. Pulls all geometry out of the CutResult — the
 * snapshot pipeline output — so nothing in here re-derives what
 * the pipeline already computed.
 */
export function renderCutOperation(cutResult: CutResult): HtmlString {
  // Pull the input snapshot from the result — it's the panel the cut
  // ACTUALLY operated on, in the same frame as the produced slices.
  // For orientation=90 cuts that's the post-rotation panel, which
  // means cut lines, slice polygons, and the panel outline all agree.
  const inputPanel = cutResult.inputPanel;
  const top = renderTopView(inputPanel, cutResult);
  const side = renderSideView(inputPanel, cutResult);
  // Axis swap: SVG Y = world X (width), SVG X = world Z (length).
  // TOP takes the width axis (SVG Y); SIDE takes the thickness axis
  // (world Y). They share the same horizontal (length) axis, so we
  // stack them vertically and flex by their vertical extents.
  const Lx = inputPanel.bbox.max[0] - inputPanel.bbox.min[0];
  const Ly = inputPanel.bbox.max[1] - inputPanel.bbox.min[1];
  const topFlex = Lx > 0 ? Lx : 1;
  const sideFlex = Ly > 0 ? Ly : 1;
  return (
    `<div style="display:flex;flex-direction:column;gap:0.5rem;width:100%;height:100%;align-items:stretch;">` +
    `  <div style="flex:${topFlex} 1 0;display:flex;flex-direction:column;gap:0.25rem;min-height:0;">` +
    `    ${projectionLabel('TOP')}` +
    `    <div style="flex:1 1 0;min-height:0;display:flex;align-items:stretch;justify-content:center;">${wrapSvg(top)}</div>` +
    `  </div>` +
    `  <div style="flex:${sideFlex} 1 0;display:flex;flex-direction:column;gap:0.25rem;min-height:0;">` +
    `    ${projectionLabel('SIDE')}` +
    `    <div style="flex:1 1 0;min-height:0;display:flex;align-items:stretch;justify-content:center;">${wrapSvg(side)}</div>` +
    `  </div>` +
    `</div>`
  );
}

function projectionLabel(text: string): string {
  return (
    `<div style="font-size:0.6rem;color:#888;letter-spacing:0.08em;` +
    `text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">` +
    `${text}</div>`
  );
}

/**
 * Stamp inline CSS on the emitted SVG so it fills the flex cell and
 * preserveAspectRatio "meet" letterboxes within the cell. Applied
 * post-hoc so the SVG string stays a plain self-contained shape
 * consumers can use standalone.
 */
function wrapSvg(svg: SvgString): string {
  return svg.replace(
    '<svg ',
    '<svg style="display:block;width:100%;height:100%;" ',
  );
}

/* -------------------------------------------------------------------------- */
/* TOP view                                                                   */
/* -------------------------------------------------------------------------- */

function renderTopView(inputPanel: PanelSnapshot, cutResult: CutResult): SvgString {
  const pieces = piecesInCutOrder(cutResult);

  // Cut-plane lines: each adjacent pair of pieces shares a cut face;
  // on the top face (y = y_max) that shared face projects to a line
  // segment whose endpoints are the two most-distant vertices shared
  // between the pair's topFace polygons.
  // Axis swap: world (x, z) → SVG (z, x).
  const lines: string[] = [];
  for (let i = 0; i < pieces.length - 1; i++) {
    const segment = findSharedCutSegment(pieces[i].snap, pieces[i + 1].snap, 'topFace');
    if (!segment) continue;
    const [a, b] = segment;
    lines.push(
      `<line x1="${fmt(a.z)}" y1="${fmt(a.x)}" ` +
        `x2="${fmt(b.z)}" y2="${fmt(b.x)}" ` +
        `${DASHED_STROKE}/>`,
    );
  }

  // Offcut shading: render each offcut's topFace polygon(s) straight
  // from the snapshot. No bespoke math — the polygons ARE the
  // regions that the pipeline decided to discard.
  const shades: string[] = [];
  for (const p of pieces) {
    if (p.kind !== 'offcut') continue;
    for (const vol of p.snap.volumes) {
      if (vol.topFace.length < 3) continue;
      const pts = vol.topFace.map((q) => `${fmt(q.z)},${fmt(q.x)}`).join(' ');
      shades.push(`<polygon points="${pts}" ${OFFCUT_FILL}/>`);
    }
  }

  const base = summarize(inputPanel);
  return base.replace('</svg>', `${shades.join('')}${lines.join('')}</svg>`);
}

/* -------------------------------------------------------------------------- */
/* SIDE view                                                                  */
/* -------------------------------------------------------------------------- */

function renderSideView(inputPanel: PanelSnapshot, cutResult: CutResult): SvgString {
  const yMin = inputPanel.bbox.min[1];
  const yMax = inputPanel.bbox.max[1];
  const zMin = inputPanel.bbox.min[2];
  const zMax = inputPanel.bbox.max[2];
  const Ly = yMax - yMin;
  const Lz = zMax - zMin;

  const pieces = piecesInCutOrder(cutResult);

  // Vertical-axis convention: we are looking at the panel from
  // +X toward −X (third-angle right elevation). After the axis
  // swap (length horizontal), SIDE sits BELOW the TOP view; world
  // Y_max (top face) maps to the top of the SVG, Y_min (bottom
  // face) to the bottom. A bevel that leans +Z at the top of the
  // panel therefore leans right on the top edge of the SIDE view,
  // matching how a woodworker looking at the near long edge of
  // the board expects the cut geometry to read.
  const syFromY = (y: number): number => yMax - y; // y_max → 0 (top of SVG), y_min → Ly (bottom)

  // Cut-plane lines: the shared face between adjacent pieces is a 3D
  // plane. Its intersection with x = 0 is a line in (y, z); the
  // endpoints come from the shared topFace edge (at y_max) and
  // shared bottomFace edge (at y_min), interpolated at x = 0.
  // SVG mapping: (z, yMax-y) → (svgX, svgY).
  const lines: string[] = [];
  for (let i = 0; i < pieces.length - 1; i++) {
    const topSeg = findSharedCutSegment(pieces[i].snap, pieces[i + 1].snap, 'topFace');
    const botSeg = findSharedCutSegment(pieces[i].snap, pieces[i + 1].snap, 'bottomFace');
    if (!topSeg || !botSeg) continue;
    const zTop = interpolateZAtX(topSeg, 0);
    const zBot = interpolateZAtX(botSeg, 0);
    if (zTop === null || zBot === null) continue;
    lines.push(
      `<line x1="${fmt(zTop)}" y1="${fmt(syFromY(yMax))}" ` +
        `x2="${fmt(zBot)}" y2="${fmt(syFromY(yMin))}" ` +
        `${DASHED_STROKE}/>`,
    );
  }

  // Offcut shading: each offcut's cross-section at x = 0.
  const shades: string[] = [];
  for (const p of pieces) {
    if (p.kind !== 'offcut') continue;
    const topRange = pieceXZeroZRange(p.snap, 'topFace');
    const botRange = pieceXZeroZRange(p.snap, 'bottomFace');
    if (!topRange || !botRange) continue;
    const pts = [
      [topRange.min, syFromY(yMax)],
      [topRange.max, syFromY(yMax)],
      [botRange.max, syFromY(yMin)],
      [botRange.min, syFromY(yMin)],
    ]
      .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
      .join(' ');
    shades.push(`<polygon points="${pts}" ${OFFCUT_FILL}/>`);
  }

  const panelRect =
    `<rect x="${fmt(zMin)}" y="0" ` +
    `width="${fmt(Lz)}" height="${fmt(Ly)}" ${PANEL_OUTLINE}/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${fmt(zMin)} 0 ${fmt(Lz)} ${fmt(Ly)}" ` +
    `preserveAspectRatio="xMidYMid meet">` +
    `${panelRect}${shades.join('')}${lines.join('')}` +
    `</svg>`
  );
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

type PieceKind = 'slice' | 'offcut';
type Piece = { snap: PanelSnapshot; kind: PieceKind };

function piecesInCutOrder(cutResult: CutResult): Piece[] {
  const pieces: Piece[] = [];
  if (cutResult.offcuts[0]) pieces.push({ snap: cutResult.offcuts[0], kind: 'offcut' });
  for (const s of cutResult.slices) pieces.push({ snap: s, kind: 'slice' });
  if (cutResult.offcuts[1]) pieces.push({ snap: cutResult.offcuts[1], kind: 'offcut' });
  return pieces;
}

/**
 * Find the shared cut edge between two adjacent pieces on a given
 * face (top or bottom). Two pieces that came from the same cut share
 * the face on the cut plane; its endpoints are the extreme
 * coincident vertices between the pieces' polygons on that face.
 */
function findSharedCutSegment(
  a: PanelSnapshot,
  b: PanelSnapshot,
  face: 'topFace' | 'bottomFace',
): Segment2D | null {
  const vertsA = collectFaceVertices(a, face);
  const vertsB = collectFaceVertices(b, face);

  const shared: Point2D[] = [];
  for (const pa of vertsA) {
    const match = vertsB.find(
      (pb) => Math.hypot(pa.x - pb.x, pa.z - pb.z) < VERTEX_MATCH_EPS,
    );
    if (!match) continue;
    const dup = shared.find(
      (p) => Math.hypot(p.x - pa.x, p.z - pa.z) < VERTEX_MATCH_EPS,
    );
    if (!dup) shared.push({ x: pa.x, z: pa.z });
  }
  if (shared.length < 2) return null;

  // Pick the two most-distant shared points — the cut plane's
  // endpoints at the panel boundary. Intermediate shared points
  // (e.g. species boundaries on the cut line) sit between them.
  let best: Segment2D = [shared[0], shared[1]];
  let bestD = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const d = Math.hypot(
        shared[i].x - shared[j].x,
        shared[i].z - shared[j].z,
      );
      if (d > bestD) {
        bestD = d;
        best = [shared[i], shared[j]];
      }
    }
  }
  return best;
}

function collectFaceVertices(
  snap: PanelSnapshot,
  face: 'topFace' | 'bottomFace',
): Point2D[] {
  const pts: Point2D[] = [];
  for (const vol of snap.volumes) {
    for (const p of vol[face]) pts.push(p);
  }
  return pts;
}

/**
 * Interpolate z at a given x along a line segment. Returns null if
 * the segment is parallel to the x-axis at a different x, i.e. the
 * line doesn't reach the target x.
 */
function interpolateZAtX(segment: Segment2D, x: number): number | null {
  const [a, b] = segment;
  if (Math.abs(a.x - b.x) < X_CROSS_EPS) {
    return Math.abs(a.x - x) < X_CROSS_EPS ? (a.z + b.z) / 2 : null;
  }
  const t = (x - a.x) / (b.x - a.x);
  return a.z + t * (b.z - a.z);
}

/**
 * For a convex polygon in XZ, compute the z range where the polygon
 * intersects the line x = 0. Returns null if the polygon doesn't
 * cross x = 0 at all.
 */
function polygonXZeroZRange(poly: Point2D[]): { min: number; max: number } | null {
  if (poly.length < 2) return null;
  const zs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.abs(a.x) < X_CROSS_EPS) zs.push(a.z);
    const aNeg = a.x < -X_CROSS_EPS;
    const bNeg = b.x < -X_CROSS_EPS;
    const aPos = a.x > X_CROSS_EPS;
    const bPos = b.x > X_CROSS_EPS;
    if ((aNeg && bPos) || (aPos && bNeg)) {
      const t = -a.x / (b.x - a.x);
      zs.push(a.z + t * (b.z - a.z));
    }
  }
  if (zs.length === 0) return null;
  return { min: Math.min(...zs), max: Math.max(...zs) };
}

/**
 * Combined x=0 Z-range across all volumes of a piece on a given
 * face. Used by the SIDE view to shade offcut regions.
 */
function pieceXZeroZRange(
  snap: PanelSnapshot,
  face: 'topFace' | 'bottomFace',
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const vol of snap.volumes) {
    const range = polygonXZeroZRange(vol[face]);
    if (!range) continue;
    if (range.min < min) min = range.min;
    if (range.max > max) max = range.max;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

/* -------------------------------------------------------------------------- */
/* Arrange operation view                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Render an Arrange operation — the reassembled panel (from the
 * ArrangeResult snapshot, which is the pipeline's truth) with
 * overlays showing which per-slice edits and spacer inserts were
 * applied.
 *
 * Overlays, per the shared visual vocabulary in #31:
 * - Each PlaceEdit gets a glyph at its target slice's centroid in
 *   the arranged panel:
 *     rotate 180  → '↻' (flip indicator)
 *     rotate  90  → '↻90°'
 *     rotate 270  → '↻270°'
 *     shift       → '→ Δmm' with sign
 * - Each SpacerInsert's volumes get a diagonal-hatched overlay so
 *   inserted material reads as distinct from adjacent slice
 *   material even when the spacer's species matches a neighbour.
 *
 * The annotations are derived from the ArrangeResult volumes'
 * `contributingSliceIds` and `contributingStripIds` — the pipeline's
 * output is the source of truth, the renderer just overlays glyphs
 * derived from the feature list.
 */
export function renderArrangeOperation(
  _input: CutResult,
  arrangeResult: ArrangeResult,
  edits: PlaceEdit[],
  spacers: SpacerInsert[],
): SvgString {
  const base = summarize(arrangeResult.panel);

  const sliceCentroids = computeSliceCentroids(arrangeResult.panel);

  // Spacer overlays: hatch the volumes whose contributingStripIds
  // include a spacer id. Attach one pattern def per spacer so
  // overlapping fill rules don't interfere.
  const defs: string[] = [];
  const spacerFills: string[] = [];
  if (spacers.length > 0) {
    defs.push(
      `<pattern id="arrange-op-spacer-hatch" patternUnits="userSpaceOnUse" ` +
        `width="6" height="6" patternTransform="rotate(45)">` +
        `<line x1="0" y1="0" x2="0" y2="6" stroke="#00000055" stroke-width="1.2" ` +
        `vector-effect="non-scaling-stroke"/>` +
        `</pattern>`,
    );
    const spacerIds = new Set(spacers.map((s) => s.id));
    for (const vol of arrangeResult.panel.volumes) {
      if (!vol.contributingStripIds.some((id) => spacerIds.has(id))) continue;
      if (vol.topFace.length < 3) continue;
      // Axis swap: (x, z) → (svgX=z, svgY=x).
      const pts = vol.topFace.map((p) => `${fmt(p.z)},${fmt(p.x)}`).join(' ');
      spacerFills.push(
        `<polygon points="${pts}" fill="url(#arrange-op-spacer-hatch)" ` +
          `stroke="none" pointer-events="none"/>`,
      );
    }
  }

  // Per-edit glyphs at slice centroids. When a single slice has
  // multiple edits (e.g. flip + shift), stack the glyphs vertically
  // around the centroid so they don't overlap.
  const editsPerSlice = new Map<number, string[]>();
  for (const edit of edits) {
    const label = editLabel(edit);
    if (!label) continue;
    const arr = editsPerSlice.get(edit.target.sliceIdx);
    if (arr) arr.push(label);
    else editsPerSlice.set(edit.target.sliceIdx, [label]);
  }
  const badges: string[] = [];
  const BADGE_LINE_HEIGHT = 22;
  for (const [sliceIdx, labels] of editsPerSlice) {
    const centroid = sliceCentroids.get(sliceIdx);
    if (!centroid) continue;
    // Axis swap: centroid (world x, z) → SVG (z, x). Vertical stack
    // of labels therefore offsets along SVG Y = world X.
    const baseline = centroid.x - ((labels.length - 1) * BADGE_LINE_HEIGHT) / 2;
    labels.forEach((label, i) => {
      badges.push(renderBadge(centroid.z, baseline + i * BADGE_LINE_HEIGHT, label));
    });
  }

  const defsBlock = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';

  return base.replace(
    '</svg>',
    `${defsBlock}${spacerFills.join('')}${badges.join('')}</svg>`,
  );
}

function editLabel(edit: PlaceEdit): string {
  switch (edit.op.kind) {
    case 'rotate':
      return edit.op.degrees === 180 ? '↻' : `↻${edit.op.degrees}°`;
    case 'shift': {
      const d = edit.op.delta;
      const sign = d > 0 ? '+' : '';
      return `⇢ ${sign}${fmt(d)}`;
    }
    default:
      return '';
  }
}

/**
 * Render a small white-on-black badge at (x, z) in SVG user space.
 * Uses a tiny paint-order trick (stroke under fill) so the text
 * stays legible over any underlying fill colour without a backing
 * rectangle cluttering the view.
 */
function renderBadge(x: number, z: number, label: string): string {
  return (
    `<text x="${fmt(x)}" y="${fmt(z)}" ` +
    `font-family="system-ui, -apple-system, Segoe UI, sans-serif" ` +
    `font-size="18" font-weight="700" ` +
    `text-anchor="middle" dominant-baseline="middle" ` +
    `fill="#1a1a1a" stroke="#fafaf7" stroke-width="4" ` +
    `paint-order="stroke" ` +
    `style="--foo:0" pointer-events="none">${label}</text>`
  );
}

/* -------------------------------------------------------------------------- */
/* TrimPanel operation view                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Render a TrimPanel operation — the upstream panel's top-down
 * outline with a dashed rectangle showing the imminent trim and a
 * dimmed overlay on the material about to be discarded.
 *
 * Snapshot-is-truth: the trim rectangle is read from
 * `trimResult.appliedBounds` (the pipeline's computed / user-supplied
 * bounds) — never recomputed from the feature's `mode` or `bounds`
 * params. The discarded-material polygons come from the upstream
 * panel's topFace polygons clipped to the OUTSIDE of appliedBounds.
 *
 * Visual vocabulary (shared across operations):
 * - Solid species-coloured polygons: the upstream panel (existing
 *   material).
 * - Dashed stroke rectangle at appliedBounds: imminent trim operation.
 * - Dimmed (≈5% opacity) overlay on the discarded offcuts: material
 *   that will be removed.
 *
 * The dimmed overlay is achieved with an SVG path that covers the
 * upstream panel's bbox and has the trim rectangle subtracted via
 * fill-rule="evenodd" — one path traces the outer bbox, a second
 * inner path traces the trim rect in the opposite winding. The net
 * filled region is everything outside the trim rect, which is
 * exactly the material the pipeline clips away.
 */
export function renderTrimOperation(
  inputPanel: PanelSnapshot,
  trimResult: TrimPanelResult,
): SvgString {
  const base = summarize(inputPanel);
  const b = trimResult.appliedBounds;

  // Dimmed overlay: outer bbox of input panel minus the trim rect,
  // via evenodd fill-rule. Clamp the bbox to the upstream panel's
  // extents so the overlay doesn't leak past the summarize viewBox.
  const pxMin = inputPanel.bbox.min[0];
  const pxMax = inputPanel.bbox.max[0];
  const pzMin = inputPanel.bbox.min[2];
  const pzMax = inputPanel.bbox.max[2];

  // Axis swap: world (x, z) → SVG (z, x). Outer ring (CW in SVG
  // space): start at bbox top-left, go clockwise. Inner ring (CCW):
  // opposite winding so evenodd fills the annulus.
  const outerRing =
    `M ${fmt(pzMin)} ${fmt(pxMin)} ` +
    `L ${fmt(pzMax)} ${fmt(pxMin)} ` +
    `L ${fmt(pzMax)} ${fmt(pxMax)} ` +
    `L ${fmt(pzMin)} ${fmt(pxMax)} Z`;
  const innerRing =
    `M ${fmt(b.zMin)} ${fmt(b.xMin)} ` +
    `L ${fmt(b.zMin)} ${fmt(b.xMax)} ` +
    `L ${fmt(b.zMax)} ${fmt(b.xMax)} ` +
    `L ${fmt(b.zMax)} ${fmt(b.xMin)} Z`;
  const discardOverlay =
    `<path d="${outerRing} ${innerRing}" ` +
    `fill="#0000000d" fill-rule="evenodd" ` +
    `stroke="none" pointer-events="none"/>`;

  // Dashed trim rectangle — the imminent operation.
  const trimRect =
    `<rect x="${fmt(b.zMin)}" y="${fmt(b.xMin)}" ` +
    `width="${fmt(b.zMax - b.zMin)}" height="${fmt(b.xMax - b.xMin)}" ` +
    `fill="none" ${DASHED_STROKE}/>`;

  return base.replace('</svg>', `${discardOverlay}${trimRect}</svg>`);
}

function computeSliceCentroids(panel: PanelSnapshot): Map<number, Point2D> {
  const groups = new Map<number, Point2D[]>();
  for (const vol of panel.volumes) {
    const sid = vol.contributingSliceIds[0];
    if (!sid) continue;
    const m = sid.match(/-slice-(\d+)$/);
    if (!m) continue;
    const idx = Number(m[1]);
    const cx = (vol.bbox.min[0] + vol.bbox.max[0]) / 2;
    const cz = (vol.bbox.min[2] + vol.bbox.max[2]) / 2;
    const arr = groups.get(idx);
    if (arr) arr.push({ x: cx, z: cz });
    else groups.set(idx, [{ x: cx, z: cz }]);
  }
  const centroids = new Map<number, Point2D>();
  for (const [idx, pts] of groups) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    centroids.set(idx, { x: cx, z: cz });
  }
  return centroids;
}
