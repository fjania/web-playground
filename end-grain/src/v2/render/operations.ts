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
 * For Cut we emit TWO orthographic projections placed side-by-side:
 *
 *   TOP  — XZ plan view. Panel outline from the input snapshot,
 *          cut-plane lines drawn between shared vertices of
 *          adjacent slice/offcut topFace polygons, offcut regions
 *          rendered from the offcut snapshots' topFace polygons.
 *
 *   SIDE — YZ elevation, cross-section at x = 0. Horizontal axis =
 *          world Y (panel thickness); vertical axis = world Z
 *          (matches TOP, so cut lines align between the views).
 *          Cut-plane lines drawn from (y_max, z at x=0 on shared
 *          topFace edge) to (y_min, z at x=0 on shared bottomFace
 *          edge). Offcut shading = each offcut's cross-section at
 *          x=0 between its top and bottom edges.
 *
 * Layout: horizontal flex — TOP on the left (wider), SIDE on the
 * right (narrower). Both are constrained to the tile's height so
 * their Z axes render at the same scale; cut lines at the same d
 * land at the same vertical screen position.
 *
 * Operation views for Arrange/PlaceEdit/Preset will be added as the
 * corresponding feature-editing issues land (#27–#36).
 */

import { summarize } from './summary';
import type { CutResult, PanelSnapshot } from '../state/types';

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
export function renderCutOperation(
  inputPanel: PanelSnapshot,
  cutResult: CutResult,
): HtmlString {
  const top = renderTopView(inputPanel, cutResult);
  const side = renderSideView(inputPanel, cutResult);
  const Lx = inputPanel.bbox.max[0] - inputPanel.bbox.min[0];
  const Ly = inputPanel.bbox.max[1] - inputPanel.bbox.min[1];
  const topFlex = Lx > 0 ? Lx : 1;
  const sideFlex = Ly > 0 ? Ly : 1;
  return (
    `<div style="display:flex;flex-direction:row;gap:0.5rem;width:100%;height:100%;align-items:stretch;">` +
    `  <div style="flex:${topFlex} 1 0;display:flex;flex-direction:column;gap:0.25rem;min-width:0;">` +
    `    ${projectionLabel('TOP')}` +
    `    <div style="flex:1 1 0;min-height:0;display:flex;align-items:stretch;justify-content:center;">${wrapSvg(top)}</div>` +
    `  </div>` +
    `  <div style="flex:${sideFlex} 1 0;display:flex;flex-direction:column;gap:0.25rem;min-width:0;">` +
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
  const lines: string[] = [];
  for (let i = 0; i < pieces.length - 1; i++) {
    const segment = findSharedCutSegment(pieces[i].snap, pieces[i + 1].snap, 'topFace');
    if (!segment) continue;
    const [a, b] = segment;
    lines.push(
      `<line x1="${fmt(a.x)}" y1="${fmt(a.z)}" ` +
        `x2="${fmt(b.x)}" y2="${fmt(b.z)}" ` +
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
      const pts = vol.topFace.map((q) => `${fmt(q.x)},${fmt(q.z)}`).join(' ');
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

  // Horizontal-axis convention: we are looking at the panel from
  // +X toward −X (third-angle right elevation, placed to the right
  // of TOP). The Y axis of the panel therefore runs RIGHT-TO-LEFT
  // across our view — world Y_max is on the left edge of the SVG,
  // world Y_min is on the right edge. This mapping makes a bevel
  // that leans +Z at the top of the panel also lean toward +Z (down
  // on screen) on the LEFT side of the view, matching how a
  // woodworker looking at the side of the board would expect the
  // cut geometry to read.
  const sxFromY = (y: number): number => yMax - y; // y_max → 0 (left), y_min → Ly (right)

  // Cut-plane lines: the shared face between adjacent pieces is a 3D
  // plane. Its intersection with x = 0 is a line in (y, z); the
  // endpoints come from the shared topFace edge (at y_max) and
  // shared bottomFace edge (at y_min), interpolated at x = 0.
  const lines: string[] = [];
  for (let i = 0; i < pieces.length - 1; i++) {
    const topSeg = findSharedCutSegment(pieces[i].snap, pieces[i + 1].snap, 'topFace');
    const botSeg = findSharedCutSegment(pieces[i].snap, pieces[i + 1].snap, 'bottomFace');
    if (!topSeg || !botSeg) continue;
    const zTop = interpolateZAtX(topSeg, 0);
    const zBot = interpolateZAtX(botSeg, 0);
    if (zTop === null || zBot === null) continue;
    lines.push(
      `<line x1="${fmt(sxFromY(yMax))}" y1="${fmt(zTop)}" ` +
        `x2="${fmt(sxFromY(yMin))}" y2="${fmt(zBot)}" ` +
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
      [sxFromY(yMax), topRange.min],
      [sxFromY(yMax), topRange.max],
      [sxFromY(yMin), botRange.max],
      [sxFromY(yMin), botRange.min],
    ]
      .map(([x, z]) => `${fmt(x)},${fmt(z)}`)
      .join(' ');
    shades.push(`<polygon points="${pts}" ${OFFCUT_FILL}/>`);
  }

  const panelRect =
    `<rect x="0" y="${fmt(zMin)}" ` +
    `width="${fmt(Ly)}" height="${fmt(Lz)}" ${PANEL_OUTLINE}/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 ${fmt(zMin)} ${fmt(Ly)} ${fmt(Lz)}" ` +
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
