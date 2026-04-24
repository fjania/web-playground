import { Box3, Matrix4, Vector3 } from 'three';
import { getManifold } from './manifold';
import type { Species } from '../state/types';

/**
 * End-grain Strip domain model — the first-class representation of a
 * strip of wood as it behaves on a table saw. A strip is ONE logical
 * piece composed of visible parts (blocks, species-colored sub-
 * elements) and has a finite, enumerable list of planar faces. Cuts
 * create faces; transforms preserve face identity while updating the
 * face geometry.
 *
 * The central commitment: face identity is first-class state stored
 * on the strip. It is NOT derived from rendered triangles. Rendering,
 * selection, and mating all read `strip.faces` — the authoritative
 * list — rather than scanning meshes and inferring planes.
 *
 * Why this shape: we control cut geometry upstream (the app rips the
 * strip, nothing else does), so the set of planes a strip carries is
 * exactly what the app handed it at construction and cut. There is
 * never a face on the strip that the strip doesn't know about.
 */

/**
 * A world-space plane: outward unit normal + signed offset
 * `d = n · p` for any point p on the plane. Outward means the normal
 * points away from the strip's interior.
 */
export interface Plane {
  normal: [number, number, number];
  offset: number;
}

/**
 * One face of a strip. `id` is stable within the strip — assigned
 * when the face is created (box face at construction, cut face when
 * `Strip.cut` fires) and preserved through every subsequent
 * transform and cut. Selection keys are `(stripId, faceId)`.
 */
export interface StripFace {
  id: number;
  plane: Plane;
  /** 'box' = an original bounding face from construction; 'cut' = added by a Strip.cut call. */
  kind: 'box' | 'cut';
}

/**
 * A visible sub-element of a strip — one block of a single species.
 * `id` is assigned at construction and carries through cuts
 * unchanged: a block split by a cut retains its id, only its
 * geometry shrinks. Two strips produced by the same cut share part
 * ids for corresponding halves.
 */
export interface Part {
  id: string;
  /** manifold-3d handle. Untyped here because manifold-3d has no types. */
  manifold: any;
  species: Species;
}

export class Strip {
  readonly id: string;
  parts: Part[];
  faces: StripFace[];
  /** Counter for allocating the next face id. Private, but copied across cuts/transforms so ids stay monotonic over the lifetime of a strip lineage. */
  private _nextFaceId: number;

  private constructor(
    id: string,
    parts: Part[],
    faces: StripFace[],
    nextFaceId: number,
  ) {
    this.id = id;
    this.parts = parts;
    this.faces = faces;
    this._nextFaceId = nextFaceId;
  }

  /**
   * Build a strip from N side-by-side unit-width blocks alternating
   * between two species. Blocks are arranged along +X, strip is
   * centered at the origin. The strip ships with its 6 box faces
   * pre-registered (ids 0–5): +X, -X, +Y, -Y, +Z, -Z.
   */
  static fromAlternatingBlocks(
    id: string,
    pair: [Species, Species],
    blockCount: number,
    blockSize: { width: number; height: number; depth: number },
  ): Strip {
    const Manifold = getManifold();
    const totalWidth = blockSize.width * blockCount;
    const halfW = totalWidth / 2;
    const halfH = blockSize.height / 2;
    const halfD = blockSize.depth / 2;

    const parts: Part[] = [];
    for (let i = 0; i < blockCount; i++) {
      const cx = -halfW + (i + 0.5) * blockSize.width;
      const mf = Manifold.cube(
        [blockSize.width, blockSize.height, blockSize.depth],
        true,
      ).translate([cx, 0, 0]);
      parts.push({
        id: `${id}-block-${i}`,
        manifold: mf,
        species: pair[i % 2],
      });
    }

    const faces: StripFace[] = [
      { id: 0, plane: { normal: [1, 0, 0], offset: halfW }, kind: 'box' },
      { id: 1, plane: { normal: [-1, 0, 0], offset: halfW }, kind: 'box' },
      { id: 2, plane: { normal: [0, 1, 0], offset: halfH }, kind: 'box' },
      { id: 3, plane: { normal: [0, -1, 0], offset: halfH }, kind: 'box' },
      { id: 4, plane: { normal: [0, 0, 1], offset: halfD }, kind: 'box' },
      { id: 5, plane: { normal: [0, 0, -1], offset: halfD }, kind: 'box' },
    ];

    return new Strip(id, parts, faces, 6);
  }

  /**
   * Split every part by a plane. Returns two new strips — `above`
   * (where n·p > offset) and `below` (where n·p < offset) — each
   * carrying the original face list plus one new StripFace for the
   * cut plane, with the correct outward-facing orientation for
   * their side.
   *
   * Part ids carry through: a block that straddles the cut appears
   * in both strips under the same id (one half each). A block
   * entirely on one side appears only in that side's strip. Both
   * output strips share the same strip id as the input — the caller
   * keeps one and disposes the other (the table-saw "offcut"); if a
   * future caller wants two strips from a rip, it's their job to
   * rename.
   */
  cut(plane: Plane): { above: Strip; below: Strip } {
    const newFaceId = this._nextFaceId;

    const cloneFaces = (): StripFace[] =>
      this.faces.map((f) => ({
        id: f.id,
        plane: {
          normal: [f.plane.normal[0], f.plane.normal[1], f.plane.normal[2]],
          offset: f.plane.offset,
        },
        kind: f.kind,
      }));

    const aboveFaces = cloneFaces();
    aboveFaces.push({
      id: newFaceId,
      plane: {
        // Above side sees the cut plane from the opposite direction
        // than the cut definition — its outward normal points into
        // where the below side used to be.
        normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]],
        offset: -plane.offset,
      },
      kind: 'cut',
    });

    const belowFaces = cloneFaces();
    belowFaces.push({
      id: newFaceId,
      plane: {
        normal: [plane.normal[0], plane.normal[1], plane.normal[2]],
        offset: plane.offset,
      },
      kind: 'cut',
    });

    const aboveParts: Part[] = [];
    const belowParts: Part[] = [];
    for (const p of this.parts) {
      const [aMf, bMf] = p.manifold.splitByPlane(plane.normal, plane.offset);
      if (aMf.numVert() > 0) {
        aboveParts.push({ id: p.id, manifold: aMf, species: p.species });
      } else {
        aMf.delete();
      }
      if (bMf.numVert() > 0) {
        belowParts.push({ id: p.id, manifold: bMf, species: p.species });
      } else {
        bMf.delete();
      }
    }

    return {
      above: new Strip(this.id, aboveParts, aboveFaces, newFaceId + 1),
      below: new Strip(this.id, belowParts, belowFaces, newFaceId + 1),
    };
  }

  /**
   * Apply a 4×4 transform. Every part's manifold is transformed via
   * manifold's own transform op; every face's plane is transformed
   * analytically (rotate normal, shift offset), so face identity is
   * preserved without re-deriving anything from geometry.
   */
  transform(matrix: Matrix4): Strip {
    const newParts = this.parts.map((p) => ({
      id: p.id,
      manifold: p.manifold.transform(matrix.elements),
      species: p.species,
    }));
    const newFaces = this.faces.map((f) => ({
      id: f.id,
      plane: transformPlane(f.plane, matrix),
      kind: f.kind,
    }));
    return new Strip(this.id, newParts, newFaces, this._nextFaceId);
  }

  /** Pure translation — cheaper than transform() since the normal doesn't rotate. */
  translate(tx: number, ty: number, tz: number): Strip {
    const newParts = this.parts.map((p) => ({
      id: p.id,
      manifold: p.manifold.translate([tx, ty, tz]),
      species: p.species,
    }));
    const newFaces = this.faces.map((f) => ({
      id: f.id,
      plane: {
        normal: [f.plane.normal[0], f.plane.normal[1], f.plane.normal[2]] as [
          number,
          number,
          number,
        ],
        offset:
          f.plane.offset +
          f.plane.normal[0] * tx +
          f.plane.normal[1] * ty +
          f.plane.normal[2] * tz,
      },
      kind: f.kind,
    }));
    return new Strip(this.id, newParts, newFaces, this._nextFaceId);
  }

  boundingBox(): Box3 {
    const box = new Box3();
    for (const p of this.parts) {
      const bb = p.manifold.boundingBox();
      box.expandByPoint(new Vector3(bb.min[0], bb.min[1], bb.min[2]));
      box.expandByPoint(new Vector3(bb.max[0], bb.max[1], bb.max[2]));
    }
    return box;
  }

  /**
   * World-space area-weighted centroid of the face polygon identified
   * by `faceId`. The face may span multiple parts; we sum triangle
   * centroids from every part, weighting each by triangle area, and
   * divide by total area to get the true polygon centroid.
   *
   * Used as the alignment anchor when joining two strips face-to-face:
   * the join transform places the moving face's centroid on top of
   * the keeping face's centroid while flipping the normal to oppose.
   *
   * Returns `null` if the face has no triangles (e.g., a degenerate
   * face on the wedge apex) or if the face id is unknown.
   */
  faceCenter(faceId: number): Vector3 | null {
    const face = this.faces.find((f) => f.id === faceId);
    if (!face) return null;

    let wx = 0;
    let wy = 0;
    let wz = 0;
    let totalArea = 0;

    for (const part of this.parts) {
      const mfMesh = part.manifold.getMesh();
      const verts = mfMesh.vertProperties as Float32Array;
      const triVerts = mfMesh.triVerts as Uint32Array;
      const numProp = mfMesh.numProp as number;
      const numTri = triVerts.length / 3;

      for (let t = 0; t < numTri; t++) {
        const i0 = triVerts[t * 3];
        const i1 = triVerts[t * 3 + 1];
        const i2 = triVerts[t * 3 + 2];
        const ax = verts[i0 * numProp];
        const ay = verts[i0 * numProp + 1];
        const az = verts[i0 * numProp + 2];
        const bx = verts[i1 * numProp];
        const by = verts[i1 * numProp + 1];
        const bz = verts[i1 * numProp + 2];
        const cx = verts[i2 * numProp];
        const cy = verts[i2 * numProp + 1];
        const cz = verts[i2 * numProp + 2];

        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        const nnx = nx / len;
        const nny = ny / len;
        const nnz = nz / len;
        const d = nnx * ax + nny * ay + nnz * az;

        const dot =
          face.plane.normal[0] * nnx +
          face.plane.normal[1] * nny +
          face.plane.normal[2] * nnz;
        if (1 - dot > PLANE_NORMAL_TOL) continue;
        if (Math.abs(face.plane.offset - d) > PLANE_OFFSET_TOL) continue;

        const cxC = (ax + bx + cx) / 3;
        const cyC = (ay + by + cy) / 3;
        const czC = (az + bz + cz) / 3;
        const area = 0.5 * len;
        wx += cxC * area;
        wy += cyC * area;
        wz += czC * area;
        totalArea += area;
      }
    }

    if (totalArea < 1e-12) return null;
    return new Vector3(wx / totalArea, wy / totalArea, wz / totalArea);
  }

  /**
   * Dominant in-plane direction of the face polygon — the first
   * principal axis of its area distribution. Unit vector in world
   * space, lying in the face plane (perpendicular to `face.plane.normal`).
   *
   * Uses the exact polygon-covariance formula: for a polygon
   * triangulated into triangles i with centroid c_i, area A_i, and
   * vertex displacements d_{i,j} = v_{i,j} - c_i, the covariance about
   * the polygon centroid c_poly is
   *
   *   Σ_i [ (A_i/12) Σ_j d_{i,j} d_{i,j}^T  +  A_i (c_i - c_poly)(c_i - c_poly)^T ]
   *
   * The 1/12 per-triangle term is the exact second moment of a
   * uniform-density triangle about its own centroid (from the
   * barycentric E[α²]=1/6, E[αβ]=1/12 identities). The second is the
   * parallel-axis shift to the polygon centroid. With both terms, a
   * square gives degenerate (equal) eigenvalues — any direction is
   * "principal" — as it should, while a rectangle's dominant
   * eigenvector points along the long edge.
   *
   * Returns null when the face has no triangles or when the covariance
   * is too small to decompose reliably.
   */
  facePrincipalAxis(faceId: number): Vector3 | null {
    const face = this.faces.find((f) => f.id === faceId);
    if (!face) return null;
    const center = this.faceCenter(faceId);
    if (!center) return null;

    const normal = new Vector3(
      face.plane.normal[0],
      face.plane.normal[1],
      face.plane.normal[2],
    ).normalize();

    // Orthonormal (u, v) frame on the face plane.
    const u = new Vector3();
    if (Math.abs(normal.x) < 0.9) u.set(1, 0, 0);
    else u.set(0, 1, 0);
    u.sub(normal.clone().multiplyScalar(u.dot(normal))).normalize();
    const v = new Vector3().crossVectors(normal, u).normalize();

    let Cuu = 0;
    let Cuv = 0;
    let Cvv = 0;

    for (const part of this.parts) {
      const mfMesh = part.manifold.getMesh();
      const verts = mfMesh.vertProperties as Float32Array;
      const triVerts = mfMesh.triVerts as Uint32Array;
      const numProp = mfMesh.numProp as number;
      const numTri = triVerts.length / 3;

      for (let t = 0; t < numTri; t++) {
        const i0 = triVerts[t * 3];
        const i1 = triVerts[t * 3 + 1];
        const i2 = triVerts[t * 3 + 2];
        const ax = verts[i0 * numProp];
        const ay = verts[i0 * numProp + 1];
        const az = verts[i0 * numProp + 2];
        const bx = verts[i1 * numProp];
        const by = verts[i1 * numProp + 1];
        const bz = verts[i1 * numProp + 2];
        const cx = verts[i2 * numProp];
        const cy = verts[i2 * numProp + 1];
        const cz = verts[i2 * numProp + 2];

        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        const nnx = nx / len;
        const nny = ny / len;
        const nnz = nz / len;
        const d = nnx * ax + nny * ay + nnz * az;
        const dot =
          face.plane.normal[0] * nnx +
          face.plane.normal[1] * nny +
          face.plane.normal[2] * nnz;
        if (1 - dot > PLANE_NORMAL_TOL) continue;
        if (Math.abs(face.plane.offset - d) > PLANE_OFFSET_TOL) continue;

        const area = 0.5 * len;

        // Project each vertex into (u, v) relative to polygon centroid.
        const pax = ax - center.x;
        const pay = ay - center.y;
        const paz = az - center.z;
        const pbx = bx - center.x;
        const pby = by - center.y;
        const pbz = bz - center.z;
        const pcx = cx - center.x;
        const pcy = cy - center.y;
        const pcz = cz - center.z;
        const au = pax * u.x + pay * u.y + paz * u.z;
        const av = pax * v.x + pay * v.y + paz * v.z;
        const bu = pbx * u.x + pby * u.y + pbz * u.z;
        const bv = pbx * v.x + pby * v.y + pbz * v.z;
        const cu = pcx * u.x + pcy * u.y + pcz * u.z;
        const cv = pcx * v.x + pcy * v.y + pcz * v.z;

        // Triangle centroid in (u, v).
        const tcu = (au + bu + cu) / 3;
        const tcv = (av + bv + cv) / 3;

        // d_j = v_j - c_tri.
        const d0u = au - tcu;
        const d0v = av - tcv;
        const d1u = bu - tcu;
        const d1v = bv - tcv;
        const d2u = cu - tcu;
        const d2v = cv - tcv;

        // Triangle self-covariance about its own centroid, scaled by area.
        const k = area / 12;
        Cuu += k * (d0u * d0u + d1u * d1u + d2u * d2u);
        Cuv += k * (d0u * d0v + d1u * d1v + d2u * d2v);
        Cvv += k * (d0v * d0v + d1v * d1v + d2v * d2v);
        // Parallel-axis term to polygon centroid.
        Cuu += area * tcu * tcu;
        Cuv += area * tcu * tcv;
        Cvv += area * tcv * tcv;
      }
    }

    if (Cuu + Cvv < 1e-18) return null;

    // Dominant eigenvector of the symmetric 2x2 [[Cuu, Cuv], [Cuv, Cvv]].
    const trace = Cuu + Cvv;
    const diff = Cuu - Cvv;
    const disc = Math.sqrt((diff * diff) / 4 + Cuv * Cuv);
    const lambda1 = trace / 2 + disc;

    let eu: number;
    let ev: number;
    if (Math.abs(Cuv) > 1e-18) {
      eu = Cuv;
      ev = lambda1 - Cuu;
    } else if (Cuu >= Cvv) {
      eu = 1;
      ev = 0;
    } else {
      eu = 0;
      ev = 1;
    }
    const en = Math.hypot(eu, ev);
    if (en < 1e-18) return null;
    eu /= en;
    ev /= en;

    return new Vector3(
      eu * u.x + ev * v.x,
      eu * u.y + ev * v.y,
      eu * u.z + ev * v.z,
    );
  }

  dispose(): void {
    for (const p of this.parts) p.manifold.delete();
    this.parts = [];
  }
}

/**
 * Extract the polygon boundary of a face as a list of world-space line
 * segments. The boundary is computed by walking every triangle in the
 * strip's parts whose supporting plane matches the given face, then
 * de-duplicating triangle edges: edges that appear in exactly one
 * triangle are boundary edges; edges appearing in two (shared between
 * adjacent triangles on the same face) are interior diagonals and get
 * dropped.
 *
 * Collinear boundary segments are coalesced into a single segment —
 * adjacent triangles on the same face share a vertex along the face's
 * outer edge, and we want that single long edge back, not two short
 * collinear pieces. This matters for the tipping algorithm, which
 * picks "the edge furthest in +Z" and would otherwise see the midpoint
 * of a half-edge instead of the true polygon edge.
 *
 * Returns an empty array if the face has no triangles (e.g., a stale
 * face clipped to zero area by a cut) or if the face id is unknown.
 */
export function extractFaceBoundary(
  strip: Strip,
  faceId: number,
): Array<{ a: Vector3; b: Vector3 }> {
  const face = strip.faces.find((f) => f.id === faceId);
  if (!face) return [];

  // Collect every triangle edge that lies on this face. Key each edge
  // by its endpoint pair, rounded to PLANE_OFFSET_TOL, so numerically
  // identical edges match even across parts.
  const edgeKey = (a: [number, number, number], b: [number, number, number]): string => {
    const q = (x: number): string => (Math.round(x / PLANE_OFFSET_TOL) * PLANE_OFFSET_TOL).toFixed(4);
    const ka = `${q(a[0])},${q(a[1])},${q(a[2])}`;
    const kb = `${q(b[0])},${q(b[1])},${q(b[2])}`;
    // Canonical order so (A,B) and (B,A) hash the same.
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  interface EdgeEntry {
    a: [number, number, number];
    b: [number, number, number];
    count: number;
  }
  const edges = new Map<string, EdgeEntry>();

  for (const part of strip.parts) {
    const mfMesh = part.manifold.getMesh();
    const verts = mfMesh.vertProperties as Float32Array;
    const triVerts = mfMesh.triVerts as Uint32Array;
    const numProp = mfMesh.numProp as number;
    const numTri = triVerts.length / 3;

    for (let t = 0; t < numTri; t++) {
      const i0 = triVerts[t * 3];
      const i1 = triVerts[t * 3 + 1];
      const i2 = triVerts[t * 3 + 2];
      const ax = verts[i0 * numProp];
      const ay = verts[i0 * numProp + 1];
      const az = verts[i0 * numProp + 2];
      const bx = verts[i1 * numProp];
      const by = verts[i1 * numProp + 1];
      const bz = verts[i1 * numProp + 2];
      const cx = verts[i2 * numProp];
      const cy = verts[i2 * numProp + 1];
      const cz = verts[i2 * numProp + 2];

      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;
      const nnx = nx / len;
      const nny = ny / len;
      const nnz = nz / len;
      const d = nnx * ax + nny * ay + nnz * az;

      const dot =
        face.plane.normal[0] * nnx +
        face.plane.normal[1] * nny +
        face.plane.normal[2] * nnz;
      if (1 - dot > PLANE_NORMAL_TOL) continue;
      if (Math.abs(face.plane.offset - d) > PLANE_OFFSET_TOL) continue;

      const tri: Array<[[number, number, number], [number, number, number]]> = [
        [[ax, ay, az], [bx, by, bz]],
        [[bx, by, bz], [cx, cy, cz]],
        [[cx, cy, cz], [ax, ay, az]],
      ];
      for (const [p, q] of tri) {
        const k = edgeKey(p, q);
        const existing = edges.get(k);
        if (existing) {
          existing.count += 1;
        } else {
          edges.set(k, { a: p, b: q, count: 1 });
        }
      }
    }
  }

  // Boundary = edges that appear in exactly one triangle.
  const rawBoundary: Array<{ a: Vector3; b: Vector3 }> = [];
  for (const entry of edges.values()) {
    if (entry.count === 1) {
      rawBoundary.push({
        a: new Vector3(entry.a[0], entry.a[1], entry.a[2]),
        b: new Vector3(entry.b[0], entry.b[1], entry.b[2]),
      });
    }
  }

  return coalesceCollinearSegments(rawBoundary);
}

/**
 * Merge collinear, connected segments into single segments. Adjacent
 * triangles on the same face produce two half-edges along the polygon's
 * true edge (they share a vertex mid-edge); this fuses those halves.
 *
 * Algorithm: build an adjacency map keyed by quantized endpoint, then
 * for each endpoint with exactly two incident segments AND both
 * segments collinear, stitch them into one. Repeat until no more
 * merges are possible.
 */
function coalesceCollinearSegments(
  segments: Array<{ a: Vector3; b: Vector3 }>,
): Array<{ a: Vector3; b: Vector3 }> {
  if (segments.length === 0) return segments;
  const COLLINEAR_TOL = 1e-6;
  const POINT_TOL = 1e-4;

  const pointKey = (v: Vector3): string =>
    `${(Math.round(v.x / POINT_TOL) * POINT_TOL).toFixed(4)},` +
    `${(Math.round(v.y / POINT_TOL) * POINT_TOL).toFixed(4)},` +
    `${(Math.round(v.z / POINT_TOL) * POINT_TOL).toFixed(4)}`;

  let current = segments.slice();
  // Bounded loop — each pass either merges at least one segment (so
  // length decreases) or halts. Cap defensively.
  for (let pass = 0; pass < segments.length + 1; pass++) {
    // Build endpoint → segment indices map.
    const incident = new Map<string, number[]>();
    current.forEach((seg, i) => {
      const ka = pointKey(seg.a);
      const kb = pointKey(seg.b);
      (incident.get(ka) ?? incident.set(ka, []).get(ka)!).push(i);
      (incident.get(kb) ?? incident.set(kb, []).get(kb)!).push(i);
    });

    let mergedAnything = false;
    const merged: Array<{ a: Vector3; b: Vector3 }> = [];
    const skip = new Set<number>();

    current.forEach((seg, i) => {
      if (skip.has(i)) return;

      // Try to extend this segment from either endpoint across a
      // degree-2 collinear joint.
      let a = seg.a.clone();
      let b = seg.b.clone();

      const tryExtend = (): boolean => {
        for (const endpoint of ['a', 'b'] as const) {
          const v = endpoint === 'a' ? a : b;
          const key = pointKey(v);
          const ids = incident.get(key);
          if (!ids || ids.length !== 2) continue;
          const otherIdx = ids.find((id) => id !== i && !skip.has(id));
          if (otherIdx === undefined) continue;
          const other = current[otherIdx];
          // Direction of this segment vs the other — must be collinear.
          const dirThis = new Vector3().subVectors(b, a).normalize();
          const oA = other.a;
          const oB = other.b;
          // Pick the far endpoint of `other` (the one that isn't v).
          const farPoint = pointKey(oA) === key ? oB : oA;
          const dirOther = new Vector3().subVectors(farPoint, v).normalize();
          if (Math.abs(dirThis.dot(dirOther)) < 1 - COLLINEAR_TOL) continue;
          // Merge: extend this segment to swallow `other`.
          if (endpoint === 'a') a = farPoint.clone();
          else b = farPoint.clone();
          skip.add(otherIdx);
          // Update incident map so subsequent extensions see the new endpoints.
          return true;
        }
        return false;
      };

      while (tryExtend()) {
        mergedAnything = true;
      }

      merged.push({ a, b });
    });

    current = merged;
    if (!mergedAnything) break;
  }

  return current;
}

/**
 * Tolerances for matching a triangle's supporting plane to a strip
 * face. These are intentionally generous because we control cut
 * geometry upstream — the app never produces near-coplanar adversarial
 * pairs. Tolerance here only has to absorb floating-point drift from
 * rotation matrices, which at our 500 mm scale is ~1e-10 mm.
 */
export const PLANE_NORMAL_TOL = 1e-4;
export const PLANE_OFFSET_TOL = 0.01;

/**
 * Given a part's mesh and the strip's face list, compute a
 * `Uint32Array` mapping each triangle to the id of the strip face it
 * lies on. Triangles that don't match any strip face (none of our
 * geometry should produce these in normal operation, but defensive
 * against degenerate triangles) map to `UNASSIGNED_FACE_ID`.
 *
 * This is the bridge from the first-class domain (strip.faces) to
 * rendering. It runs once per part per build; cache the result on the
 * Three.js mesh's userData so click/highlight lookups are O(1).
 */
export const UNASSIGNED_FACE_ID = 0xffffffff;

export function computePartTriangleFaceIds(
  part: Part,
  faces: StripFace[],
): Uint32Array {
  const mfMesh = part.manifold.getMesh();
  const triVerts = mfMesh.triVerts as Uint32Array;
  const verts = mfMesh.vertProperties as Float32Array;
  const numProp = mfMesh.numProp as number;
  const numTri = triVerts.length / 3;
  const out = new Uint32Array(numTri);
  out.fill(UNASSIGNED_FACE_ID);

  for (let t = 0; t < numTri; t++) {
    const i0 = triVerts[t * 3];
    const i1 = triVerts[t * 3 + 1];
    const i2 = triVerts[t * 3 + 2];
    const ax = verts[i0 * numProp];
    const ay = verts[i0 * numProp + 1];
    const az = verts[i0 * numProp + 2];
    const bx = verts[i1 * numProp];
    const by = verts[i1 * numProp + 1];
    const bz = verts[i1 * numProp + 2];
    const cx = verts[i2 * numProp];
    const cy = verts[i2 * numProp + 1];
    const cz = verts[i2 * numProp + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    const nnx = nx / len;
    const nny = ny / len;
    const nnz = nz / len;
    const d = nnx * ax + nny * ay + nnz * az;

    for (const face of faces) {
      const dot =
        face.plane.normal[0] * nnx +
        face.plane.normal[1] * nny +
        face.plane.normal[2] * nnz;
      if (1 - dot > PLANE_NORMAL_TOL) continue;
      if (Math.abs(face.plane.offset - d) > PLANE_OFFSET_TOL) continue;
      out[t] = face.id;
      break;
    }
  }

  return out;
}

function transformPlane(plane: Plane, matrix: Matrix4): Plane {
  const m = matrix.elements;
  const nx =
    m[0] * plane.normal[0] + m[4] * plane.normal[1] + m[8] * plane.normal[2];
  const ny =
    m[1] * plane.normal[0] + m[5] * plane.normal[1] + m[9] * plane.normal[2];
  const nz =
    m[2] * plane.normal[0] + m[6] * plane.normal[1] + m[10] * plane.normal[2];
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  // offset' = offset + n'·t, using the rotated normal.
  const newOffset = plane.offset + nx * tx + ny * ty + nz * tz;
  return { normal: [nx, ny, nz], offset: newOffset };
}
