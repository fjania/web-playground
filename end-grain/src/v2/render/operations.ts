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
 * Today this module has one renderer — Cut. Arrange/PlaceEdit/Preset
 * operation views will be added as the corresponding feature-editing
 * issues land (#27–#36). Each renderer takes (inputPanel, feature)
 * and returns a complete SVG string.
 */

import { summarize } from './summary';
import type { Cut, PanelSnapshot } from '../state/types';

type SvgString = string;

/**
 * Render a Cut operation: the input panel's top-down view with the
 * cut-plane lines overlaid. Plane positions derive from the same
 * safe-extent formula that executeCut uses, so the view matches the
 * actual pipeline behaviour (inner planes only; offcut boundaries
 * become the outermost lines).
 *
 * Design: we emit the base panel SVG via summarize() and inject
 * <line> elements before the closing </svg>. That way the rendering
 * of the panel itself stays in one place (summary.ts) and this
 * module only contributes the overlay.
 */
export function renderCutOperation(inputPanel: PanelSnapshot, cut: Cut): SvgString {
  const ripRad = (cut.rip * Math.PI) / 180;
  const sin = Math.sin(ripRad);
  const cos = Math.cos(ripRad);

  const panelX = inputPanel.bbox.max[0] - inputPanel.bbox.min[0];
  const panelZ = inputPanel.bbox.max[2] - inputPanel.bbox.min[2];
  const safeExtent = Math.max(
    0,
    panelZ * Math.abs(cos) - panelX * Math.abs(sin),
  );
  const count = Math.max(0, Math.floor(safeExtent / cut.pitch));

  // Inner cut planes + the two bounding planes that separate
  // inner slices from offcut material.
  const firstPlane = -(count * cut.pitch) / 2;
  const planeOffsets: number[] = [];
  for (let i = 0; i <= count; i++) planeOffsets.push(firstPlane + i * cut.pitch);

  const xMin = inputPanel.bbox.min[0];
  const xMax = inputPanel.bbox.max[0];

  // Render each plane as a line from xMin to xMax. viewBox clipping
  // handles any visual overflow for extreme angles.
  const lines: string[] = [];
  if (Math.abs(cos) > 1e-6) {
    for (const d of planeOffsets) {
      // Plane equation x·sin + z·cos = d  →  z = (d - x·sin)/cos
      const z1 = (d - xMin * sin) / cos;
      const z2 = (d - xMax * sin) / cos;
      // Dashed stroke: signals "imminent operation" per the shared
      // visual vocabulary. Solid strokes are reserved for existing
      // geometry (the panel's outline, edges of rendered volumes).
      lines.push(
        `<line x1="${fmt(xMin)}" y1="${fmt(z1)}" ` +
          `x2="${fmt(xMax)}" y2="${fmt(z2)}" ` +
          `stroke="#1a1a1a" stroke-width="1.2" ` +
          `stroke-dasharray="8 5" vector-effect="non-scaling-stroke"/>`,
      );
    }
  }

  // Shade the offcut regions (beyond the outermost planes) so the
  // viewer can see what gets discarded. Two trapezoids (or triangles
  // if rip ≠ 0) — one past each outermost plane.
  const shades: string[] = [];
  if (count > 0 && Math.abs(cos) > 1e-6) {
    const dMin = planeOffsets[0];
    const dMax = planeOffsets[planeOffsets.length - 1];
    shades.push(offcutShade(inputPanel, sin, cos, dMin, 'min'));
    shades.push(offcutShade(inputPanel, sin, cos, dMax, 'max'));
  }

  const base = summarize(inputPanel);
  return base.replace('</svg>', `${shades.join('')}${lines.join('')}</svg>`);
}

/**
 * Polygon for the offcut region on one side of an outermost plane.
 * `side === 'min'` shades the region where x·sin + z·cos < d (outside
 * the first plane, toward the panel's far corner).
 * `side === 'max'` shades the opposite region.
 */
function offcutShade(
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
  // Walk the panel's 4 corners + the plane's 2 intersection points
  // along xMin / xMax, keeping only corners on the "offcut" side.
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

  // Points that lie on the offcut side, plus plane-intersection points
  // at the panel's X edges (where the plane enters/exits the panel).
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const aOn = onOffcut(a.x, a.z);
    const bOn = onOffcut(b.x, b.z);
    if (aOn) out.push(a);
    if (aOn !== bOn) {
      // Edge crosses the plane — find intersection on this panel edge.
      // Edges alternate X-constant / Z-constant; handle both.
      if (a.x === b.x) {
        // Vertical edge in XZ (X const). Plane: x·sin + z·cos = d → z = (d - x·sin)/cos
        const z = Math.abs(cos) > 1e-6 ? (d - a.x * sin) / cos : a.z;
        out.push({ x: a.x, z });
      } else {
        // Horizontal edge in XZ (Z const). Plane: x = (d - z·cos)/sin
        const x = Math.abs(sin) > 1e-6 ? (d - a.z * cos) / sin : a.x;
        out.push({ x, z: a.z });
      }
    }
  }

  if (out.length < 3) return '';
  const pts = out.map((p) => `${fmt(p.x)},${fmt(p.z)}`).join(' ');
  // Light fill (~5% black) so offcuts read as ghosted / discarded
  // rather than solid shading. Matches the dim treatment in the
  // 3D Output tile.
  return (
    `<polygon points="${pts}" ` +
    `fill="#0000000d" stroke="none" pointer-events="none"/>`
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}
