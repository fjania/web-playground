import { Box3, Matrix4, Vector3 } from 'three';
import { getManifold } from './manifold';
import type { StripDef } from './types';

/**
 * A Panel is an assembly of segments, each with its own manifold handle
 * and a species label. All geometry operations live on Panel — cut,
 * transform, translate, rotateAbout, concat, boundingBox, dispose.
 * Panels are immutable: every operation returns a new Panel with freshly
 * baked manifold handles. The source Panel is never mutated.
 *
 * Manifold is the single source of truth for geometry. The Three.js view
 * layer only ever reads a Panel to build meshes — it never holds transforms
 * that need to be baked back.
 */
export interface Segment {
  manifold: any;
  species: string;
}

export class Panel {
  segments: Segment[];

  constructor(segments: Segment[]) {
    this.segments = segments;
  }

  static fromStripList(strips: StripDef[], height: number, length: number): Panel {
    const Manifold = getManifold();
    const total = strips.reduce((s, st) => s + st.width, 0);
    let x = -total / 2;
    const segs: Segment[] = strips.map(({ species, width }) => {
      const cx = x + width / 2;
      x += width;
      const mf = Manifold.cube([width, height, length], true).translate([cx, 0, 0]);
      return { manifold: mf, species };
    });
    return new Panel(segs);
  }

  get size(): number {
    return this.segments.length;
  }

  cut(normal: [number, number, number], offset: number): { above: Panel; below: Panel } {
    const above: Segment[] = [];
    const below: Segment[] = [];
    for (const s of this.segments) {
      const [a, b] = s.manifold.splitByPlane(normal, offset);
      if (a.numVert() > 0) above.push({ manifold: a, species: s.species });
      else a.delete();
      if (b.numVert() > 0) below.push({ manifold: b, species: s.species });
      else b.delete();
    }
    return { above: new Panel(above), below: new Panel(below) };
  }

  /**
   * Cut with `count + 1` parallel planes perpendicular to `normal`, spaced
   * `pitch` apart, centered on `centerOffset` along the normal. Returns the
   * `count` inner regions (slices) plus up to 2 end regions (offcuts).
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
   * Apply a Three.js Matrix4 to every segment, baking it into new manifold
   * handles. Returns a new Panel; source is not modified.
   *
   * Convention: manifold.transform(m: Mat4) takes a 16-element column-major
   * array. Three.js Matrix4.elements is already column-major, so pass it through.
   */
  transform(matrix4: Matrix4): Panel {
    const m = matrix4.elements;
    return new Panel(
      this.segments.map((s) => ({
        manifold: s.manifold.transform(m),
        species: s.species,
      })),
    );
  }

  translate(tx: number, ty: number, tz: number): Panel {
    return new Panel(
      this.segments.map((s) => ({
        manifold: s.manifold.translate([tx, ty, tz]),
        species: s.species,
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

  concat(other: Panel): Panel {
    return new Panel([...this.segments, ...other.segments]);
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

  dispose(): void {
    for (const s of this.segments) s.manifold.delete();
    this.segments = [];
  }
}
