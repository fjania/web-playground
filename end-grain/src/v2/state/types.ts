/**
 * End-grain v2.1 — Feature timeline types.
 *
 * Guiding principle (v2.1-design.html §2): **Model is the source of
 * truth; rendering is a pure function of the model.**
 *
 * Every type declared here must be JSON-serialisable. No THREE.js
 * handles, no function-valued fields, no Svelte runes. The full
 * timeline must round-trip through `JSON.stringify` / `JSON.parse`
 * without loss.
 *
 * `PanelSnapshot` is the serialisable shadow of a panel — bbox +
 * species-tagged volume list + provenance — sufficient for all
 * rendering. FeatureResult values carry PanelSnapshots (plain data)
 * so the JSON-roundtrip invariant stays clean.
 *
 * The live `Panel` class that wraps manifold handles for geometry
 * math lands with the pipeline in v2.2 (#20). It exposes its
 * PanelSnapshot via `toSnapshot()`; pipeline results only ever
 * surface snapshots, never live Panel instances.
 */

// ---------------------------------------------------------------------------
// Leaf types
// ---------------------------------------------------------------------------

export type Species = 'maple' | 'walnut' | 'cherry' | 'padauk' | 'purpleheart';

export type Status = 'ok' | 'warning' | 'error';

export interface StripDef {
  /** Stable, monotonic id. Never reused after deletion. */
  stripId: string;
  species: Species;
  /** mm — per-strip (not per-species). */
  width: number;
}

/**
 * Serialisable shadow of a panel. Enough information for both 2D
 * top-down summary rendering and 3D mesh construction. The live
 * `Panel` class (v2.2) will expose this shape via `toSnapshot()`.
 *
 * bbox in mm, using the conventional axes: X = strip-width direction,
 * Y = strip-height (vertical), Z = strip-length / cut-normal direction.
 */
export interface PanelSnapshot {
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /**
   * One entry per species-homogeneous volume inside the panel, in
   * assembly order. The sum of volume bboxes covers the panel bbox
   * (modulo shared faces).
   */
  volumes: Array<{
    species: Species;
    bbox: { min: [number, number, number]; max: [number, number, number] };
    /**
     * Which source strip(s) this volume descends from. A volume may
     * aggregate multiple strips after joins; a single strip may
     * contribute to multiple volumes after cuts.
     */
    contributingStripIds: string[];
    /**
     * Which slice(s) this volume descends from. Empty before any
     * Cut runs. A Cut tags each slice's segments with
     * `${cut.id}-slice-${sliceIdx}`. Multi-generation cuts
     * accumulate ids.
     *
     * Enables view consumers (exploded output, thumbnails, hover)
     * to group volumes by slice origin without heuristics.
     */
    contributingSliceIds: string[];
    /**
     * Top-face polygon in XZ, at y = bbox.max[1]. Ordered around
     * the centroid (CCW when viewed from +Y looking down). Captures
     * the volume's actual top-down footprint — essential for
     * angled-cut slices (parallelograms) and rotated slices where
     * the AABB is a loose over-approximation.
     *
     * For axis-aligned volumes, topFace is the 4 corners of the bbox
     * in XZ. For parallelogram slices (rip != 0), it's the actual
     * parallelogram. For rotated slices, it's the rotated rectangle.
     *
     * Rendering consumers (the 2D summary SVG renderer) should emit
     * <polygon> from this field rather than <rect> from the AABB,
     * so the view matches the real geometry.
     */
    topFace: Array<{ x: number; z: number }>;
    /**
     * Bottom-face polygon (at y = bbox.min[1]), same shape as topFace.
     * For a vertical-walled prism (all cuts at bevel=90°) this is an
     * identical polygon to topFace; for a bevelled cut it is sheared
     * relative to topFace by the bevel's shift along the cut-normal,
     * which is how operation-view side projections read the bevel
     * straight from the geometry instead of recomputing it from the
     * feature parameters.
     */
    bottomFace: Array<{ x: number; z: number }>;
  }>;
}

// ---------------------------------------------------------------------------
// Feature configs
// ---------------------------------------------------------------------------

export interface ComposeStrips {
  kind: 'composeStrips';
  /** Exactly one ComposeStrips per design. Stable id. */
  id: 'compose-0';
  /** Ordered left-to-right (along +X). */
  strips: StripDef[];
  /** mm, uniform Y across every strip. */
  stripHeight: number;
  /** mm, uniform Z across every strip. */
  stripLength: number;
  status: Status;
  statusReason?: string;
}

export interface Cut {
  kind: 'cut';
  /** 'cut-0', 'cut-1', ... */
  id: string;
  /** -90..90 degrees. Rotation of cut-plane about Y (rip angle). */
  rip: number;
  /** 45..90 degrees. Tilt of cut-plane from vertical (bevel angle). */
  bevel: number;
  /** mm, slice pitch along cut-normal. */
  pitch: number;
  showOffcuts: boolean;
  status: Status;
  statusReason?: string;
}

export interface Arrange {
  kind: 'arrange';
  /** 'arrange-0', 'arrange-1', ... */
  id: string;
  /** Only one algorithm for now — craftsman's cursor-slide. */
  layout: 'cursor-slide';
  status: Status;
  statusReason?: string;
  // NB: NO `placements` field. PlaceEdits and SpacerInserts live in
  // the timeline and are discovered by this feature's `id` (#19 §arrange).
}

export interface PlaceEditTarget {
  /** Which Arrange the edit applies to. */
  arrangeId: string;
  /** Always stored. Used as the resolver fallback when contributingStripIds is absent or ambiguous. */
  sliceIdx: number;
  /**
   * Provenance captured at edit time. Declared from day one;
   * consumed by the resolver starting at v2.14 (#34). Optional so
   * tests / fixtures can omit it.
   */
  contributingStripIds?: string[];
}

/**
 * A PlaceEdit's operation. `flip` is UI shorthand for
 * `{ kind: 'rotate', degrees: 180 }` — no separate op kind.
 */
export type PlaceEditOp =
  | { kind: 'reorder'; newIdx: number }
  | { kind: 'rotate'; degrees: 90 | 180 | 270 }
  /** mm, perpendicular to cut normal (along +X for an unrotated cut). */
  | { kind: 'shift'; delta: number };

export interface PlaceEdit {
  kind: 'placeEdit';
  /** 'edit-0', 'edit-1', ... */
  id: string;
  target: PlaceEditTarget;
  op: PlaceEditOp;
  status: Status;
  statusReason?: string;
}

/**
 * Preset expands at pipeline time into a list of PlaceEdits (or
 * SpacerInserts for `spacerEveryRow`). The expansion is
 * deterministic and re-runs on every regen — presets are persistent,
 * not baked.
 */
export type Preset =
  | {
      kind: 'preset';
      id: string;
      arrangeId: string;
      preset: 'flipAlternate';
      params: Record<string, never>;
      status: Status;
      statusReason?: string;
    }
  | {
      kind: 'preset';
      id: string;
      arrangeId: string;
      preset: 'rotateAlternate';
      params: { degrees: 90 | 180 | 270 };
      status: Status;
      statusReason?: string;
    }
  | {
      kind: 'preset';
      id: string;
      arrangeId: string;
      preset: 'mirrorAlternate';
      params: Record<string, never>;
      status: Status;
      statusReason?: string;
    }
  | {
      kind: 'preset';
      id: string;
      arrangeId: string;
      preset: 'rotate4way';
      params: Record<string, never>;
      status: Status;
      statusReason?: string;
    }
  | {
      kind: 'preset';
      id: string;
      arrangeId: string;
      preset: 'shiftAlternate';
      params: { shift: number };
      status: Status;
      statusReason?: string;
    }
  | {
      kind: 'preset';
      id: string;
      arrangeId: string;
      preset: 'spacerEveryRow';
      params: { species: Species; width: number };
      status: Status;
      statusReason?: string;
    };

export interface SpacerInsert {
  kind: 'spacerInsert';
  /** 'spacer-0', 'spacer-1', ... */
  id: string;
  arrangeId: string;
  /** 0-based; spacer goes after slice at this index in the arranged sequence. */
  afterSliceIdx: number;
  /** Provenance, captured at insert time. Consumed by resolver at v2.14 (#34). */
  contributingStripIds?: string[];
  species: Species;
  /** mm, added along cut-normal (+Z for an unrotated arrange). */
  width: number;
  status: Status;
  statusReason?: string;
}

export type Feature =
  | ComposeStrips
  | Cut
  | Arrange
  | PlaceEdit
  | Preset
  | SpacerInsert;

// ---------------------------------------------------------------------------
// Feature results (per-kind discriminated union)
// ---------------------------------------------------------------------------

export interface ComposeStripsResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  panel: PanelSnapshot;
}

export interface CutResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  slices: PanelSnapshot[];
  offcuts: PanelSnapshot[];
  sliceProvenance: Array<{ sliceIdx: number; contributingStripIds: string[] }>;
}

export interface ArrangeResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  panel: PanelSnapshot;
  /** Count of PlaceEdits the Arrange applied this regen. */
  appliedEditCount: number;
  /** Source feature ids, parallel to applied edits. Includes Preset expansions. */
  appliedEditSources: string[];
  /** Count of SpacerInserts the Arrange applied this regen. */
  appliedSpacerCount: number;
  /** Source feature ids, parallel to applied spacers. */
  appliedSpacerSources: string[];
}

export type PresetResult =
  | {
      featureId: string;
      status: Status;
      statusReason?: string;
      /** rotate / shift / flip / mirror / rotate4way presets expand here. */
      expandedPlaceEdits: PlaceEdit[];
    }
  | {
      featureId: string;
      status: Status;
      statusReason?: string;
      /** `spacerEveryRow` expands here. */
      expandedSpacers: SpacerInsert[];
    };

export interface PlaceEditResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  // No geometry of its own — consumed by the matching Arrange.
}

export interface SpacerInsertResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  // No geometry of its own — consumed by the matching Arrange.
}

export type FeatureResult =
  | ComposeStripsResult
  | CutResult
  | ArrangeResult
  | PresetResult
  | PlaceEditResult
  | SpacerInsertResult;
