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
 * `Panel` is the one allowed "rich" type because its v2 shape is a
 * serialisable shadow representation (bbox + species-tagged volume
 * list + provenance) sufficient for all rendering. The concrete
 * Panel class arrives with the pipeline in v2.2 (#20); for now we
 * declare the shadow shape so FeatureResult types can reference it.
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
 * Serialisable shadow of a Panel. Enough information for both 2D
 * top-down summary rendering and 3D mesh construction. The concrete
 * Panel class (v2.2) will expose this shape via `toJSON()` / a
 * `shadow` field.
 *
 * bbox in mm, using the conventional axes: X = strip-width direction,
 * Y = strip-height (vertical), Z = strip-length / cut-normal direction.
 */
export interface Panel {
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
  panel: Panel;
}

export interface CutResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  slices: Panel[];
  offcuts: Panel[];
  sliceProvenance: Array<{ sliceIdx: number; contributingStripIds: string[] }>;
}

export interface ArrangeResult {
  featureId: string;
  status: Status;
  statusReason?: string;
  panel: Panel;
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
