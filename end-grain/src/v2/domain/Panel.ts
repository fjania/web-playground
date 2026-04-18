import { Box3, Matrix4, Vector3 } from 'three';
import { getManifold } from '../../domain/manifold';
import type { PanelSnapshot, Species, StripDef } from '../state/types';

/**
 * End-grain v2 Panel — the live geometry object used inside pipeline
 * execution. Wraps manifold handles and tracks per-segment provenance
 * (which source strip ids each segment descends from).
 *
 * Pipeline results never carry a Panel; they carry a `PanelSnapshot`
 * produced by `toSnapshot()`. The snapshot is plain data — JSON-safe
 * and sufficient for rendering — so the "model is source of truth"
 * invariant holds across the pipeline output boundary.
 *
 * Panels are immutable: every operation returns a new Panel with
 * freshly baked manifold handles. Call `dispose()` on Panels that
 * drop out of scope to free the manifold-side memory.
 */
export interface Segment {
  /** manifold-3d handle. Untyped because @types for manifold-3d isn't set up. */
  manifold: any;
  species: Species;
  /**
   * Source strip ids contributing to this segment. Starts as a single
   * stripId on `fromStrips`; accumulates on concat / join; preserved
   * on cut, transform, rotate, translate.
   */
  contributingStripIds: string[];
  /**
   * Slice provenance. Empty before any Cut runs; a Cut tags each
   * slice's segments with `${cut.id}-slice-${sliceIdx}`. If the
   * panel is re-cut later, additional slice ids accumulate. Preserved
   * on transform / translate / rotate / concat.
   *
   * Enables view-layer consumers (exploded output, timeline
   * thumbnails, hover highlight) to group segments by slice origin
   * without heuristics.
   */
  contributingSliceIds: string[];
}

export class Panel {
  segments: Segment[];

  constructor(segments: Segment[]) {
    this.segments = segments;
  }

  /**
   * Build a panel from a StripDef[] — one segment per strip, centered
   * on the X axis, spanning Y from -height/2..+height/2 and Z from
   * -length/2..+length/2. Each segment records its originating
   * stripId in `contributingStripIds`.
   */
  static fromStrips(strips: StripDef[], height: number, length: number): Panel {
    const Manifold = getManifold();
    const total = strips.reduce((s, st) => s + st.width, 0);
    let x = -total / 2;
    const segs: Segment[] = strips.map(({ stripId, species, width }) => {
      const cx = x + width / 2;
      x += width;
      const mf = Manifold.cube([width, height, length], true).translate([cx, 0, 0]);
      return {
        manifold: mf,
        species,
        contributingStripIds: [stripId],
        contributingSliceIds: [],
      };
    });
    return new Panel(segs);
  }

  get size(): number {
    return this.segments.length;
  }

  /**
   * Split every segment by a plane. Returns two panels; one holds
   * everything on the plane's positive side, the other the negative
   * side. Segments that end up empty are pruned. Provenance is
   * preserved — a segment that straddles the plane appears in both
   * outputs with the same `contributingStripIds`.
   */
  cut(normal: [number, number, number], offset: number): { above: Panel; below: Panel } {
    const above: Segment[] = [];
    const below: Segment[] = [];
    for (const s of this.segments) {
      const [a, b] = s.manifold.splitByPlane(normal, offset);
      if (a.numVert() > 0) {
        above.push({
          manifold: a,
          species: s.species,
          contributingStripIds: [...s.contributingStripIds],
          contributingSliceIds: [...s.contributingSliceIds],
        });
      } else {
        a.delete();
      }
      if (b.numVert() > 0) {
        below.push({
          manifold: b,
          species: s.species,
          contributingStripIds: [...s.contributingStripIds],
          contributingSliceIds: [...s.contributingSliceIds],
        });
      } else {
        b.delete();
      }
    }
    return { above: new Panel(above), below: new Panel(below) };
  }

  /**
   * Cut with `count + 1` parallel planes perpendicular to `normal`,
   * spaced `pitch` apart, centered on `centerOffset` along the normal.
   * Returns the `count - 1` inner regions (slices) plus two end
   * regions (offcuts).
   *
   * Provenance: every slice inherits the parent panel's segment
   * provenance — cutting does not change composition.
   */
  cutRepeated(
    normal: [number, number, number],
    pitch: number,
    count: number,
    centerOffset = 0,
  ): { slices: Panel[]; offcuts: [Panel, Panel] | [] } {
    if (count < 1) return { slices: [], offcuts: [] };
    const firstPlane = centerOffset - (count * pitch) / 2;
    const planeOffsets: number[] = [];
    for (let i = 0; i <= count; i++) planeOffsets.push(firstPlane + i * pitch);

    const regions: Panel[] = [];
    let remainder = this.clone();
    for (const off of planeOffsets) {
      const { above, below } = remainder.cut(normal, off);
      regions.push(below);
      remainder.dispose();
      remainder = above;
    }
    regions.push(remainder);
    return {
      slices: regions.slice(1, regions.length - 1),
      offcuts: [regions[0], regions[regions.length - 1]],
    };
  }

  /**
   * Apply a Three.js Matrix4. The matrix is flattened column-major
   * (Matrix4.elements already is), which matches manifold's convention.
   */
  transform(matrix4: Matrix4): Panel {
    const m = matrix4.elements;
    return new Panel(
      this.segments.map((s) => ({
        manifold: s.manifold.transform(m),
        species: s.species,
        contributingStripIds: [...s.contributingStripIds],
        contributingSliceIds: [...s.contributingSliceIds],
      })),
    );
  }

  translate(tx: number, ty: number, tz: number): Panel {
    return new Panel(
      this.segments.map((s) => ({
        manifold: s.manifold.translate([tx, ty, tz]),
        species: s.species,
        contributingStripIds: [...s.contributingStripIds],
        contributingSliceIds: [...s.contributingSliceIds],
      })),
    );
  }

  rotateAbout(axis: Vector3, angle: number, pivot: Vector3): Panel {
    if (Math.abs(angle) < 1e-6) return this.clone();
    const T1 = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const R = new Matrix4().makeRotationAxis(axis.clone().normalize(), angle);
    const T2 = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
    return this.transform(T2.multiply(R).multiply(T1));
  }

  clone(): Panel {
    return this.transform(new Matrix4());
  }

  /**
   * Append another panel's segments. The result owns its own manifold
   * handles — both `this` and `other` are cloned — so disposing
   * either input does not invalidate the result. This is the safest
   * contract for a pipeline that frees intermediates aggressively.
   */
  concat(other: Panel): Panel {
    const a = this.clone();
    const b = other.clone();
    return new Panel([...a.segments, ...b.segments]);
  }

  boundingBox(): Box3 {
    const box = new Box3();
    for (const s of this.segments) {
      const bb = s.manifold.boundingBox();
      box.expandByPoint(new Vector3(bb.min[0], bb.min[1], bb.min[2]));
      box.expandByPoint(new Vector3(bb.max[0], bb.max[1], bb.max[2]));
    }
    return box;
  }

  /**
   * Extent of the whole panel along a unit vector, measured from
   * manifold geometry. Used by the cursor-slide algorithm: it reads
   * each slice's thickness along the cut-normal at placement time,
   * so angled cuts reassemble flush.
   *
   * Returns `{ min, max, extent }` where extent = max - min.
   */
  measureAlong(axis: [number, number, number]): { min: number; max: number; extent: number } {
    // Normalise the axis; caller may pass an un-normalised vector.
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-12) throw new Error('measureAlong: axis has zero length');
    const n: [number, number, number] = [axis[0] / len, axis[1] / len, axis[2] / len];

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const s of this.segments) {
      const bb = s.manifold.boundingBox();
      // Project all 8 AABB corners onto the axis and take the extrema.
      // For axis-aligned geometry this is exact; for rotated geometry
      // it's a conservative over-approximation, which is fine because
      // manifold's boundingBox is already a world-space AABB of the
      // baked-in transformed mesh.
      for (let xi = 0; xi < 2; xi++) {
        for (let yi = 0; yi < 2; yi++) {
          for (let zi = 0; zi < 2; zi++) {
            const x = xi === 0 ? bb.min[0] : bb.max[0];
            const y = yi === 0 ? bb.min[1] : bb.max[1];
            const z = zi === 0 ? bb.min[2] : bb.max[2];
            const p = x * n[0] + y * n[1] + z * n[2];
            if (p < min) min = p;
            if (p > max) max = p;
          }
        }
      }
    }
    return { min, max, extent: max - min };
  }

  /**
   * Produce the serialisable shadow of this panel. One volume entry
   * per segment, carrying species + AABB + provenance. This is the
   * type pipeline results surface — live Panel instances never cross
   * the pipeline-output boundary.
   *
   * Empty panels (no segments — e.g. an offcut from a cut that ran
   * exactly at the panel boundary) return a zero-size bbox at the
   * origin rather than Three's default Box3 state of ±Infinity. That
   * keeps the snapshot JSON-safe: JSON.stringify turns Infinity into
   * null, which breaks the roundtrip invariant.
   */
  toSnapshot(): PanelSnapshot {
    if (this.segments.length === 0) {
      return {
        bbox: { min: [0, 0, 0], max: [0, 0, 0] },
        volumes: [],
      };
    }
    const volumes = this.segments.map((s) => {
      const bb = s.manifold.boundingBox();
      return {
        species: s.species,
        bbox: {
          min: [bb.min[0], bb.min[1], bb.min[2]] as [number, number, number],
          max: [bb.max[0], bb.max[1], bb.max[2]] as [number, number, number],
        },
        contributingStripIds: [...s.contributingStripIds],
        contributingSliceIds: [...s.contributingSliceIds],
        topFace: extractTopFacePolygon(s.manifold),
      };
    });
    const panelBox = this.boundingBox();
    return {
      bbox: {
        min: [panelBox.min.x, panelBox.min.y, panelBox.min.z],
        max: [panelBox.max.x, panelBox.max.y, panelBox.max.z],
      },
      volumes,
    };
  }

  dispose(): void {
    for (const s of this.segments) s.manifold.delete();
    this.segments = [];
  }
}

/**
 * Extract the top-face polygon of a manifold in XZ, at y = max Y.
 *
 * Strategy:
 * 1. Read all vertex positions from the mesh.
 * 2. Find max Y across all vertices.
 * 3. Collect vertices whose Y is within epsilon of max Y.
 * 4. Dedupe (a single logical corner may appear multiple times if
 *    incident triangles each list it).
 * 5. Sort angularly around the centroid — for a convex top face (which
 *    all v2 volumes have: cubes, parallelogram prisms, rotated cubes),
 *    this yields the polygon in a consistent CCW order around the centre.
 *
 * Why not use `.getMeshGL()` or face-id routing: manifold's face
 * tagging is available but overkill here. We only need the vertex
 * set on the top plane, and all our volumes are convex prisms, so
 * angular sort around the centroid is sufficient and stable.
 */
function extractTopFacePolygon(
  manifoldHandle: any,
): Array<{ x: number; z: number }> {
  const mesh = manifoldHandle.getMesh();
  const numVerts: number = mesh.numVert;
  const numProp: number = mesh.numProp;

  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < numVerts; i++) {
    const y = mesh.vertProperties[i * numProp + 1];
    if (y > maxY) maxY = y;
  }

  const eps = 1e-4;
  const seen = new Set<string>();
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < numVerts; i++) {
    const y = mesh.vertProperties[i * numProp + 1];
    if (Math.abs(y - maxY) > eps) continue;
    const x = mesh.vertProperties[i * numProp];
    const z = mesh.vertProperties[i * numProp + 2];
    const key = `${x.toFixed(4)},${z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push({ x, z });
  }

  if (pts.length < 3) return pts;

  // Angular sort around centroid (CCW when viewed from +Y).
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  pts.sort(
    (a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx),
  );
  return pts;
}
