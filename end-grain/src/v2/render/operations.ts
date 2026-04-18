/**
 * Operation-view renderers — each Feature kind that operates on a
 * panel gets a function here that renders the OPERATION itself (its
 * geometry and parameters) as a 2D SVG overlay. Distinct from
 * `summary.ts`, which renders panel SNAPSHOTS (the thing an operation
 * *produces*).
 *
 * Why separate: under the input → operation(params) → output mental
 * model, the middle tile in the main canvas shows the operation
 * (what's being done and with what parameters), not the output.
 * Operation views compose naturally with panel views because they
 * share the XZ top-down coordinate system that summarize() uses.
 *
 * For Cut — the only Feature kind handled here today — we emit TWO
 * orthographic projections stacked vertically:
 *
 *   TOP  — XZ plan view (same as the 2D summary), overlaying the
 *          cut planes and offcut shading. Encodes rip + pitch.
 *
 *   SIDE — elevation along the cut-chord direction, with the
 *          cut-normal XZ projection on the horizontal axis and
 *          world Y on the vertical axis. Encodes bevel + pitch +
 *          panel thickness. At bevel=90° the cut lines are vertical;
 *          at bevel<90° they lean by (90° − bevel) degrees.
 *
 * Arrange/PlaceEdit/Preset operation views will be added as the
 * corresponding feature-editing issues land (#27–#36). Each renderer
 * takes (inputPanel, feature) and returns a complete HTML string
 * (possibly containing multiple SVGs).
 */

import { summarize } from './summary';
import type { Cut, PanelSnapshot } from '../state/types';

type HtmlString = string;
type SvgString = string;

const DASHED_STROKE =
  'stroke="#1a1a1a" stroke-width="1.2" ' +
  'stroke-dasharray="8 5" vector-effect="non-scaling-stroke"';
const OFFCUT_FILL = 'fill="#0000000d" stroke="none" pointer-events="none"';
const PANEL_OUTLINE =
  'fill="#fafaf7" stroke="#00000033" stroke-width="0.5" ' +
  'vector-effect="non-scaling-stroke"';

/**
 * Render a Cut operation as two stacked orthographic projections.
 * The returned markup is a wrapper `<div>` containing a `TOP` view
 * (full panel summary + cut-plane overlay) above a `SIDE` view
 * (panel Y thickness × along-normal extent, with tilted cut lines).
 *
 * Both views derive their cut-line positions from the same safe-extent
 * formula executeCut uses, so the diagram matches the actual pipeline
 * behaviour.
 */
export function renderCutOperation(inputPanel: PanelSnapshot, cut: Cut): HtmlString {
  const top = renderTopView(inputPanel, cut);
  const side = renderSideView(inputPanel, cut);
  return (
    `<div style="display:flex;flex-direction:column;gap:0.5rem;width:100%;align-items:stretch;">` +
    `  <div style="display:flex;flex-direction:column;gap:0.25rem;align-items:stretch;">` +
    `    ${projectionLabel('TOP')}` +
    `    ${top}` +
    `  </div>` +
    `  <div style="display:flex;flex-direction:column;gap:0.25rem;align-items:stretch;">` +
    `    ${projectionLabel('SIDE')}` +
    `    ${side}` +
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

/* -------------------------------------------------------------------------- */
/* TOP view                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Top-down (XZ) projection of the input panel with dashed cut planes
 * and dimmed offcut corners. Bevel is invisible in this projection
 * by design — bevel is encoded in the side view below.
 */
function renderTopView(inputPanel: PanelSnapshot, cut: Cut): SvgString {
  const ripRad = (cut.rip * Math.PI) / 180;
  const sin = Math.sin(ripRad);
  const cos = Math.cos(ripRad);

  // Safe extent here reflects the PIPELINE's count — keep in sync if
  // the pipeline's formula changes. At bevel < 90° the pipeline may
  // produce fewer slices due to Y-axis interference; this top view
  // still draws the rip-based offsets regardless, because the top
  // projection can't depict the Y-axis interaction anyway.
  const planeOffsets = computePlaneOffsets(inputPanel, cut);

  const xMin = inputPanel.bbox.min[0];
  const xMax = inputPanel.bbox.max[0];

  const lines: string[] = [];
  if (Math.abs(cos) > 1e-6) {
    for (const d of planeOffsets) {
      const z1 = (d - xMin * sin) / cos;
      const z2 = (d - xMax * sin) / cos;
      lines.push(
        `<line x1="${fmt(xMin)}" y1="${fmt(z1)}" ` +
          `x2="${fmt(xMax)}" y2="${fmt(z2)}" ` +
          `${DASHED_STROKE}/>`,
      );
    }
  }

  const shades: string[] = [];
  if (planeOffsets.length >= 2 && Math.abs(cos) > 1e-6) {
    const dMin = planeOffsets[0];
    const dMax = planeOffsets[planeOffsets.length - 1];
    shades.push(topOffcutShade(inputPanel, sin, cos, dMin, 'min'));
    shades.push(topOffcutShade(inputPanel, sin, cos, dMax, 'max'));
  }

  const base = summarize(inputPanel);
  return base.replace('</svg>', `${shades.join('')}${lines.join('')}</svg>`);
}

function topOffcutShade(
  panel: PanelSnapshot,
  sin: number,
  cos: number,
  d: number,
  side: 'min' | 'max',
): string {
  const xMin = panel.bbox.min[0];
  const xMax = panel.bbox.max[0];
  const zMin = panel.bbox.min[2];
  const zMax = panel.bbox.max[2];
  const corners: Array<{ x: number; z: number }> = [
    { x: xMin, z: zMin },
    { x: xMax, z: zMin },
    { x: xMax, z: zMax },
    { x: xMin, z: zMax },
  ];
  const onOffcut = (x: number, z: number): boolean => {
    const v = x * sin + z * cos;
    return side === 'min' ? v < d : v > d;
  };

  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const aOn = onOffcut(a.x, a.z);
    const bOn = onOffcut(b.x, b.z);
    if (aOn) out.push(a);
    if (aOn !== bOn) {
      if (a.x === b.x) {
        const z = Math.abs(cos) > 1e-6 ? (d - a.x * sin) / cos : a.z;
        out.push({ x: a.x, z });
      } else {
        const x = Math.abs(sin) > 1e-6 ? (d - a.z * cos) / sin : a.x;
        out.push({ x, z: a.z });
      }
    }
  }

  if (out.length < 3) return '';
  const pts = out.map((p) => `${fmt(p.x)},${fmt(p.z)}`).join(' ');
  return `<polygon points="${pts}" ${OFFCUT_FILL}/>`;
}

/* -------------------------------------------------------------------------- */
/* SIDE view                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Side elevation. Horizontal axis = projection of XZ onto the
 * cut-normal direction (u = x·sin θ + z·cos θ). Vertical axis = world
 * Y. The view depicts a rectangle of width (Lx·|sin θ| + Lz·|cos θ|)
 * and height Ly, with cut planes drawn as tilted lines.
 *
 * Cut plane equation in (u, y):
 *   cos α · u  −  sin α · y  =  d       where α = 90° − bevel.
 *
 * Solving for u:
 *   u(y) = d/cos α + tan α · y
 *
 * So for each plane offset d, the line in the side view goes from
 * (u(y_max), y_max) at the top of the panel to (u(y_min), y_min) at
 * the bottom. At α = 0 (bevel = 90°), tan α = 0 → vertical line. At
 * α = 45° (bevel = 45°), tan α = 1 → 45° diagonal. The tilt is the
 * bevel's departure from vertical, which is exactly what the user
 * dials in with the bevel parameter.
 */
function renderSideView(inputPanel: PanelSnapshot, cut: Cut): SvgString {
  const ripRad = (cut.rip * Math.PI) / 180;
  const sinR = Math.sin(ripRad);
  const cosR = Math.cos(ripRad);
  const alphaRad = ((90 - cut.bevel) * Math.PI) / 180;
  const sinA = Math.sin(alphaRad);
  const cosA = Math.cos(alphaRad);

  const Lx = inputPanel.bbox.max[0] - inputPanel.bbox.min[0];
  const Ly = inputPanel.bbox.max[1] - inputPanel.bbox.min[1];
  const Lz = inputPanel.bbox.max[2] - inputPanel.bbox.min[2];

  // Projection range onto the cut-normal XZ axis (u). The panel's
  // XZ bbox projects to a range of width Lx·|sin θ| + Lz·|cos θ|.
  const W = Lx * Math.abs(sinR) + Lz * Math.abs(cosR);

  // u-coordinate of the panel's centroid (u=0 at panel XZ centre for
  // a centred panel). We draw the side view centred at u=0.
  const uMin = -W / 2;
  const yMin = inputPanel.bbox.min[1];
  const yMax = inputPanel.bbox.max[1];

  // SVG coordinate helpers: SVG x = u − uMin (so 0 is left edge);
  // SVG y = yMax − y (so 0 is top edge, growing downward).
  const sx = (u: number) => u - uMin;
  const sy = (y: number) => yMax - y;

  const planeOffsets = computePlaneOffsets(inputPanel, cut);

  // Plane-line endpoints in (u, y) space. For each d:
  //   u(y) = d/cosA + tanA · y
  const lines: string[] = [];
  if (cosA > 1e-6) {
    for (const d of planeOffsets) {
      const uTop = d / cosA + (sinA / cosA) * yMax;
      const uBot = d / cosA + (sinA / cosA) * yMin;
      lines.push(
        `<line x1="${fmt(sx(uTop))}" y1="${fmt(sy(yMax))}" ` +
          `x2="${fmt(sx(uBot))}" y2="${fmt(sy(yMin))}" ` +
          `${DASHED_STROKE}/>`,
      );
    }
  }

  // Offcut shading: the region outside the outermost plane. Each
  // offcut is a parallelogram in (u, y): bounded by a tilted cut
  // line on one side and the panel's u-edge on the other.
  const shades: string[] = [];
  if (planeOffsets.length >= 2 && cosA > 1e-6) {
    const dFirst = planeOffsets[0];
    const dLast = planeOffsets[planeOffsets.length - 1];
    shades.push(
      sideOffcutShade(sx, sy, yMax, yMin, uMin, dFirst, cosA, sinA, 'min'),
    );
    shades.push(
      sideOffcutShade(sx, sy, yMax, yMin, uMin + W, dLast, cosA, sinA, 'max'),
    );
  }

  // Panel outline — a simple rectangle.
  const panelRect =
    `<rect x="${fmt(sx(uMin))}" y="${fmt(sy(yMax))}" ` +
    `width="${fmt(W)}" height="${fmt(Ly)}" ${PANEL_OUTLINE}/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${fmt(W)} ${fmt(Ly)}" ` +
    `preserveAspectRatio="xMidYMid meet">` +
    `${panelRect}${shades.join('')}${lines.join('')}` +
    `</svg>`
  );
}

function sideOffcutShade(
  sx: (u: number) => number,
  sy: (y: number) => number,
  yMax: number,
  yMin: number,
  uEdge: number, // u-coordinate of the panel edge on the offcut side
  d: number, // cut-plane offset bounding the offcut
  cosA: number,
  sinA: number,
  side: 'min' | 'max',
): string {
  const uTop = d / cosA + (sinA / cosA) * yMax;
  const uBot = d / cosA + (sinA / cosA) * yMin;
  // Four corners of the offcut parallelogram in (u, y):
  //   side 'min': panel edge (uEdge) to the cut line.
  //   side 'max': cut line to panel edge.
  const pts =
    side === 'min'
      ? [
          [uEdge, yMax],
          [uTop, yMax],
          [uBot, yMin],
          [uEdge, yMin],
        ]
      : [
          [uTop, yMax],
          [uEdge, yMax],
          [uEdge, yMin],
          [uBot, yMin],
        ];
  const pointsStr = pts.map(([u, y]) => `${fmt(sx(u))},${fmt(sy(y))}`).join(' ');
  return `<polygon points="${pointsStr}" ${OFFCUT_FILL}/>`;
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Plane offsets along the cut-normal. Mirrors the pipeline's
 * safe-extent logic. `count` inner planes produce `count − 1` inner
 * slices; the first and last offsets are the two outermost planes
 * (which become the offcut boundaries).
 */
function computePlaneOffsets(panel: PanelSnapshot, cut: Cut): number[] {
  const ripRad = (cut.rip * Math.PI) / 180;
  const cosR = Math.cos(ripRad);
  const sinR = Math.sin(ripRad);
  const alphaRad = ((90 - cut.bevel) * Math.PI) / 180;
  const cosA = Math.cos(alphaRad);
  const sinA = Math.sin(alphaRad);

  const Lx = panel.bbox.max[0] - panel.bbox.min[0];
  const Ly = panel.bbox.max[1] - panel.bbox.min[1];
  const Lz = panel.bbox.max[2] - panel.bbox.min[2];

  // Safe extent — the range of plane offsets that produce a
  // full-chord slice. Accounts for bevel: the plane's tilt makes
  // it sweep an extra Ly·|sin α| along the normal, eating into the
  // usable range. And the rip-based margin scales with cos α because
  // only the XZ-component of the plane's reach is still governed by
  // rip geometry.
  const safe = Math.max(
    0,
    cosA * (Lz * Math.abs(cosR) - Lx * Math.abs(sinR)) - Ly * Math.abs(sinA),
  );
  const count = Math.max(0, Math.floor(safe / cut.pitch));
  const firstPlane = -(count * cut.pitch) / 2;
  const offsets: number[] = [];
  for (let i = 0; i <= count; i++) offsets.push(firstPlane + i * cut.pitch);
  return offsets;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}
