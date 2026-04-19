/**
 * End-grain v2.2 pipeline executor.
 *
 * `runPipeline(features)` is a **pure function** that executes a
 * Feature timeline to produce a `PipelineOutput`. No THREE.js scene,
 * no DOM — runs headless under Vitest. Model is the source of truth;
 * rendering is a pure function of the output this file produces.
 *
 * Execution is two-phase and **topological**:
 *
 *   Phase 1 — index: walk the timeline once, collect Presets,
 *     PlaceEdits, and SpacerInserts into maps keyed by arrangeId.
 *
 *   Phase 2 — execute: walk the timeline in order. When an Arrange
 *     executes it consults the phase-1 index for its attached
 *     features, expands Presets, merges preset-expanded edits with
 *     user-authored edits (manual wins on same slice), and runs the
 *     cursor-slide algorithm.
 *
 * The `trace` in `PipelineOutput` reflects **execution order** — which
 * for this first commit is identical to timeline order because we're
 * only implementing Compose/Cut/Arrange-identity. Preset-before-Arrange
 * reordering lands in a subsequent commit.
 *
 * This first commit implements ComposeStrips + Cut + Arrange(identity).
 * PlaceEdit application, Preset expansion, and SpacerInsert follow in
 * subsequent commits — the executor is structured so those extensions
 * slot into executeArrange without reshaping the envelope.
 */

import { Vector3 } from 'three';
import { getManifold } from '../domain/manifold';
import { Panel } from '../domain/Panel';
import { expandPreset } from './presets';
import type {
  Arrange,
  ArrangeResult,
  ComposeStrips,
  ComposeStripsResult,
  Cut,
  CutResult,
  Feature,
  FeatureResult,
  PanelSnapshot,
  PlaceEdit,
  PresetResult,
  Preset,
  SpacerInsert,
  TrimPanel,
  TrimPanelResult,
} from './types';

export interface PipelineOutput {
  /** featureId → FeatureResult. Plain data — JSON-serialisable. */
  results: Record<string, FeatureResult>;
  /** featureIds in execution order. */
  trace: string[];
  /**
   * Live Panel instances per featureId, populated when
   * `runPipeline(features, { preserveLive: true })` is called.
   * Present only for features that produce a single panel
   * (ComposeStrips and Arrange). Caller owns these and must call
   * `.dispose()` when done to free manifold handles.
   *
   * Absent for the default (pure-function) call to preserve JSON
   * serialisability.
   */
  livePanels?: Record<string, Panel>;
  /**
   * Live per-slice Panel instances per Cut featureId, populated
   * under preserveLive. Each entry is an array of N slices (same
   * order as the corresponding CutResult.slices snapshots). These
   * are CLONES of the slices Arrange consumes, so preservation
   * doesn't interfere with downstream geometry. Caller owns these
   * and must dispose each Panel when done.
   */
  liveCutSlices?: Record<string, Panel[]>;
}

export interface RunOptions {
  /**
   * When true, the returned PipelineOutput carries `livePanels`,
   * and the pipeline does NOT dispose the final live Panels
   * (compose result and arrange results). Headless callers should
   * omit this; the 3D viewport passes it so it can build meshes
   * from manifold geometry.
   */
  preserveLive?: boolean;
}

export function runPipeline(features: Feature[], options: RunOptions = {}): PipelineOutput {
  const ctx = new ExecutionContext();
  ctx.preserveLive = options.preserveLive === true;

  // ---- Phase 1: index features attached to an Arrange. ----
  for (const f of features) {
    switch (f.kind) {
      case 'preset':
        ctx.presetsByArrange(f.arrangeId).push(f);
        break;
      case 'placeEdit':
        ctx.placeEditsByArrange(f.target.arrangeId).push(f);
        break;
      case 'spacerInsert':
        ctx.spacerInsertsByArrange(f.arrangeId).push(f);
        break;
      default:
        break;
    }
  }

  // ---- Phase 2: execute features in timeline order. ----
  for (const f of features) {
    switch (f.kind) {
      case 'composeStrips':
        ctx.record(f.id, executeComposeStrips(f, ctx));
        break;
      case 'cut':
        ctx.record(f.id, executeCut(f, ctx));
        break;
      case 'arrange':
        ctx.record(f.id, executeArrange(f, ctx));
        break;
      case 'trimPanel':
        ctx.record(f.id, executeTrimPanel(f, ctx));
        break;
      case 'preset':
        // Preset results are populated by the Arrange that consumes
        // them (Arrange has the sliceProvenance that expansion
        // needs). If Arrange already recorded this preset (topological
        // order: preset executes before arrange), skip the
        // placeholder; otherwise this Preset targets an Arrange that
        // hasn't run yet or doesn't exist, so leave a placeholder.
        if (!(f.id in ctx.results)) {
          ctx.record(f.id, { featureId: f.id, status: 'ok' });
        }
        break;
      case 'placeEdit':
      case 'spacerInsert':
        // These contribute to an Arrange; they have no geometry of
        // their own. Same topological-order caveat as Preset.
        if (!(f.id in ctx.results)) {
          ctx.record(f.id, { featureId: f.id, status: 'ok' });
        }
        break;
    }
  }

  // Hand off the accumulated livePanels + liveCutSlices maps (under
  // preserveLive).
  const livePanels = ctx.preserveLive
    ? { ...ctx.livePanelsByFeature }
    : undefined;
  const liveCutSlices = ctx.preserveLive
    ? { ...ctx.liveCutSlicesByFeature }
    : undefined;

  ctx.disposeLiveGeometry({ keepLivePanels: ctx.preserveLive });

  return {
    results: ctx.results,
    trace: ctx.trace,
    ...(livePanels ? { livePanels } : {}),
    ...(liveCutSlices ? { liveCutSlices } : {}),
  };
}

// ---------------------------------------------------------------------------
// Execution context — scratch state for a single run. NOT returned.
// ---------------------------------------------------------------------------

class ExecutionContext {
  results: Record<string, FeatureResult> = {};
  trace: string[] = [];

  /** The live panel that the next Cut or Arrange will consume. */
  lastPanel: Panel | null = null;
  /** Live slices produced by the most recent Cut. Consumed by the next Arrange. */
  lastSlices: Panel[] = [];
  /** Provenance per slice. Parallel to lastSlices. */
  lastSliceProvenance: string[][] = [];
  /** The most recent Cut feature, cached so Arrange can read its rip/bevel. */
  lastCut: Cut | null = null;

  /**
   * When true, live Panel instances for EVERY panel-producing
   * feature (compose + each arrange) are surfaced to the caller
   * via `PipelineOutput.livePanels`. Cut's input is not disposed
   * under preserveLive so the compose panel stays alive past the
   * Cut step. Caller owns all livePanels and must dispose.
   */
  preserveLive = false;
  /** featureId → live Panel. Accumulates under preserveLive. */
  livePanelsByFeature: Record<string, Panel> = {};
  /**
   * featureId → live cut slices. Accumulates under preserveLive.
   * Clones of the slices the Cut produced, safe to keep past the
   * downstream Arrange's consumption.
   */
  liveCutSlicesByFeature: Record<string, Panel[]> = {};
  /** Which feature last set `lastPanel`. */
  lastPanelFeatureId: string | null = null;

  private presetIndex = new Map<string, Preset[]>();
  private editIndex = new Map<string, PlaceEdit[]>();
  private spacerIndex = new Map<string, SpacerInsert[]>();

  presetsByArrange(arrangeId: string): Preset[] {
    return mapGetOrCreate(this.presetIndex, arrangeId);
  }
  placeEditsByArrange(arrangeId: string): PlaceEdit[] {
    return mapGetOrCreate(this.editIndex, arrangeId);
  }
  spacerInsertsByArrange(arrangeId: string): SpacerInsert[] {
    return mapGetOrCreate(this.spacerIndex, arrangeId);
  }

  record(id: string, result: FeatureResult): void {
    this.results[id] = result;
    this.trace.push(id);
  }

  disposeLiveGeometry(opts: { keepLivePanels?: boolean } = {}): void {
    const keep = opts.keepLivePanels === true;
    // Slices + mid-pipeline panels always get freed. The caller-
    // visible livePanelsByFeature map is preserved separately.
    if (this.lastPanel && !keep) {
      this.lastPanel.dispose();
    }
    this.lastPanel = null;
    for (const s of this.lastSlices) s.dispose();
    this.lastSlices = [];
    this.lastSliceProvenance = [];
  }
}

function mapGetOrCreate<V>(m: Map<string, V[]>, key: string): V[] {
  let arr = m.get(key);
  if (!arr) {
    arr = [];
    m.set(key, arr);
  }
  return arr;
}

// ---------------------------------------------------------------------------
// ComposeStrips
// ---------------------------------------------------------------------------

function executeComposeStrips(
  f: ComposeStrips,
  ctx: ExecutionContext,
): ComposeStripsResult {
  const panel = Panel.fromStrips(f.strips, f.stripHeight, f.stripLength);
  // Stash the live panel for the next feature to consume. Dispose any
  // previous lastPanel first — ComposeStrips is typically the first
  // feature, but we stay defensive.
  if (ctx.lastPanel) ctx.lastPanel.dispose();
  ctx.lastPanel = panel;
  ctx.lastPanelFeatureId = f.id;
  if (ctx.preserveLive) ctx.livePanelsByFeature[f.id] = panel;
  return {
    featureId: f.id,
    status: 'ok',
    panel: panel.toSnapshot(),
  };
}

// ---------------------------------------------------------------------------
// Cut
// ---------------------------------------------------------------------------

function executeCut(f: Cut, ctx: ExecutionContext): CutResult {
  const input = ctx.lastPanel;
  if (!input) {
    return {
      featureId: f.id,
      status: 'error',
      statusReason: 'cut without upstream panel',
      slices: [],
      offcuts: [],
      sliceProvenance: [],
    };
  }

  // Cut normal: rip is rotation of the cut plane about Y (in XZ), and
  // bevel is tilt of the plane from vertical about the in-plane chord
  // axis. Writing α = 90° − bevel (so α is the tilt MAGNITUDE, zero
  // when the cut is vertical), the normal is constructed by first
  // taking the rip-only normal (sin θ, 0, cos θ), then rotating it
  // by α about the cut-chord axis (cos θ, 0, −sin θ). The result:
  //   n = (sin θ·cos α, −sin α, cos θ·cos α)
  // α=0   → n = (sin θ, 0, cos θ)    (vertical cut, today's behaviour)
  // α=45° → n leans 45° down in Y    (classic 45° bevel)
  const ripRad = (f.rip * Math.PI) / 180;
  const alphaRad = ((90 - f.bevel) * Math.PI) / 180;
  const sinR = Math.sin(ripRad);
  const cosR = Math.cos(ripRad);
  const sinA = Math.sin(alphaRad);
  const cosA = Math.cos(alphaRad);
  const normal: [number, number, number] = [
    sinR * cosA,
    -sinA,
    cosR * cosA,
  ];

  // Safe extent — range of plane offsets (measured along the normal,
  // in 3D) that produce a full-chord slice.
  //
  // At bevel=90° (α=0) the problem reduces to a 2D one in XZ:
  //   safe = Lz·|cos θ| − Lx·|sin θ|
  //
  // With bevel<90° two additional things happen:
  // 1. The rip-based XZ margin (Lz·|cos θ| − Lx·|sin θ|) needs to be
  //    measured along the 3D normal, not along the XZ projection, so
  //    it scales by cos α.
  // 2. The plane now tilts in Y too, sweeping Ly·|sin α| of extra
  //    offset to get across the Y dimension of the panel. That
  //    subtracts from the usable range.
  //
  // Combined:
  //   safe = cos α · (Lz·|cos θ| − Lx·|sin θ|) − Ly·|sin α|
  //
  // Validated against the bevel=90° base case (α=0 → cos α=1, sin α=0
  // → matches the original formula exactly).
  const inputBbox = input.boundingBox();
  const panelX = inputBbox.max.x - inputBbox.min.x;
  const panelY = inputBbox.max.y - inputBbox.min.y;
  const panelZ = inputBbox.max.z - inputBbox.min.z;
  const safeExtent = Math.max(
    0,
    cosA * (panelZ * Math.abs(cosR) - panelX * Math.abs(sinR)) -
      panelY * Math.abs(sinA),
  );

  // Two density modes:
  //   'pitch'  — user dialled the cut spacing; pipeline floors the
  //              safe extent by pitch to get the slice count.
  //   'slices' — user dialled the slice count; pipeline divides the
  //              safe extent by count to get the spacing.
  // Either way, `count` (slice count) and `effectivePitch` (spacing
  // used for the cut) are the two values fed into cutRepeated below.
  let count: number;
  let effectivePitch: number;
  if (f.spacingMode === 'slices') {
    count = Math.max(0, Math.floor(f.slices));
    effectivePitch = count > 0 ? safeExtent / count : 0;
  } else {
    count = f.pitch > 0 ? Math.max(0, Math.floor(safeExtent / f.pitch)) : 0;
    effectivePitch = f.pitch;
  }

  const { slices, offcuts: rawOffcuts } = input.cutRepeated(normal, effectivePitch, count, 0);

  // Drop no-op offcuts — at rip=0/bevel=90 (or whenever the slice
  // count evenly divides the safe extent) the outer cut planes sit
  // exactly on the panel edges, so the "offcut" is either a
  // zero-vertex panel or a zero-thickness degenerate slab. Neither
  // represents discarded material; surfacing them would have the
  // UI claim "2 offcuts discarded" when no material was lost.
  //
  // Test: non-negligible bbox volume. Use 0.01 mm³ as the floor —
  // well below anything a real cut produces, well above numerical
  // noise from manifold's plane-intersection results.
  const OFFCUT_MIN_VOLUME = 0.01;
  const hasRealVolume = (p: Panel): boolean => {
    if (p.segments.length === 0) return false;
    const bb = p.boundingBox();
    const vol = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
    return vol > OFFCUT_MIN_VOLUME;
  };
  const offcuts = rawOffcuts.filter(hasRealVolume);
  for (const p of rawOffcuts) {
    if (!hasRealVolume(p)) p.dispose();
  }

  // Tag every segment of each slice with this Cut's slice id so the
  // view layer can group / explode by slice origin. Mutates segments
  // in place — safe because slices were just created; nothing else
  // holds references yet.
  for (let sliceIdx = 0; sliceIdx < slices.length; sliceIdx++) {
    const sliceId = `${f.id}-slice-${sliceIdx}`;
    for (const seg of slices[sliceIdx].segments) {
      seg.contributingSliceIds = [...seg.contributingSliceIds, sliceId];
    }
  }

  // Take snapshots before we move the live geometry into ctx / dispose.
  const sliceSnapshots: PanelSnapshot[] = slices.map((s) => s.toSnapshot());
  const offcutSnapshots: PanelSnapshot[] = offcuts.map((p) => p.toSnapshot());
  const sliceProvenance = slices.map((s, sliceIdx) => ({
    sliceIdx,
    contributingStripIds: collectStripIds(s),
  }));

  // Under preserveLive, surface clones of the slices to the caller
  // via liveCutSlicesByFeature. Clones so downstream Arrange can
  // still consume (and dispose) the originals normally; the caller
  // owns the clones and must dispose them when done.
  if (ctx.preserveLive) {
    ctx.liveCutSlicesByFeature[f.id] = slices.map((s) => s.clone());
  }

  // Stash live slices for the downstream Arrange. Offcuts always
  // dispose (we don't surface them). The input panel disposes only
  // when preserveLive is false — under preserveLive it stays alive
  // inside livePanelsByFeature for the caller's viewport access.
  if (!ctx.preserveLive) input.dispose();
  ctx.lastPanel = null;
  for (const o of offcuts) o.dispose();
  ctx.lastSlices = slices;
  ctx.lastSliceProvenance = sliceProvenance.map((p) => p.contributingStripIds);
  ctx.lastCut = f;

  return {
    featureId: f.id,
    status: 'ok',
    slices: sliceSnapshots,
    offcuts: offcutSnapshots,
    sliceProvenance,
  };
}

function collectStripIds(panel: Panel): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const seg of panel.segments) {
    for (const id of seg.contributingStripIds) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  return order;
}

// ---------------------------------------------------------------------------
// Arrange — mate faces successively along the cut-normal.
// Applies PlaceEdits per slice, expands Presets, inserts SpacerInserts.
// ---------------------------------------------------------------------------

function executeArrange(f: Arrange, ctx: ExecutionContext): ArrangeResult {
  const upstreamSlices = ctx.lastSlices;
  const upstreamProvenance = ctx.lastSliceProvenance;
  if (upstreamSlices.length === 0) {
    return {
      featureId: f.id,
      status: 'error',
      statusReason: 'arrange without upstream cut',
      panel: emptySnapshot(),
      appliedEditCount: 0,
      appliedEditSources: [],
      appliedSpacerCount: 0,
      appliedSpacerSources: [],
    };
  }

  // ---- 1. Expand Presets targeting this Arrange. ----
  const provEntries = upstreamProvenance.map((ids, sliceIdx) => ({
    sliceIdx,
    contributingStripIds: ids,
  }));

  const presets = ctx.presetsByArrange(f.id);
  const presetEdits: Array<{ edit: PlaceEdit; source: string }> = [];
  const presetSpacers: Array<{ spacer: SpacerInsert; source: string }> = [];

  for (const preset of presets) {
    const expansion = expandPreset(preset, provEntries);
    // Fill in the Preset's own FeatureResult with the expansion and
    // record it in the trace topologically (before this Arrange).
    const presetResult: PresetResult =
      expansion.kind === 'placeEdits'
        ? {
            featureId: preset.id,
            status: 'ok',
            expandedPlaceEdits: expansion.edits,
          }
        : {
            featureId: preset.id,
            status: 'ok',
            expandedSpacers: expansion.spacers,
          };
    ctx.record(preset.id, presetResult);

    if (expansion.kind === 'placeEdits') {
      for (const edit of expansion.edits) presetEdits.push({ edit, source: preset.id });
    } else {
      for (const spacer of expansion.spacers) presetSpacers.push({ spacer, source: preset.id });
    }
  }

  // ---- 2. Collect user-authored PlaceEdits + SpacerInserts. ----
  // Record them in the trace topologically (before this Arrange) so
  // downstream tooling sees the true execution order.
  const userEdits = ctx.placeEditsByArrange(f.id).map((e) => ({ edit: e, source: e.id }));
  const userSpacers = ctx.spacerInsertsByArrange(f.id).map((s) => ({ spacer: s, source: s.id }));

  for (const { edit } of userEdits) {
    if (!(edit.id in ctx.results)) {
      ctx.record(edit.id, { featureId: edit.id, status: 'ok' });
    }
  }
  for (const { spacer } of userSpacers) {
    if (!(spacer.id in ctx.results)) {
      ctx.record(spacer.id, { featureId: spacer.id, status: 'ok' });
    }
  }

  // ---- 3. Merge: "manual wins on same slice". ----
  // Drop preset edits for any sliceIdx that has a user edit.
  // Drop preset spacers for any afterSliceIdx that has a user spacer.
  const userEditSliceIdxs = new Set(userEdits.map((e) => e.edit.target.sliceIdx));
  const mergedEdits = [
    ...presetEdits.filter(({ edit }) => !userEditSliceIdxs.has(edit.target.sliceIdx)),
    ...userEdits,
  ];
  const userSpacerIdxs = new Set(userSpacers.map((s) => s.spacer.afterSliceIdx));
  const mergedSpacers = [
    ...presetSpacers.filter(({ spacer }) => !userSpacerIdxs.has(spacer.afterSliceIdx)),
    ...userSpacers,
  ];

  // ---- 4. Apply PlaceEdits per slice. ----
  // Group edits by sliceIdx. rotate and shift accumulate; reorder is
  // collected separately and applied to the output sequence.
  const editsBySlice = new Map<number, Array<{ edit: PlaceEdit; source: string }>>();
  for (const e of mergedEdits) {
    const arr = editsBySlice.get(e.edit.target.sliceIdx) ?? [];
    arr.push(e);
    editsBySlice.set(e.edit.target.sliceIdx, arr);
  }

  // Per-slice transforms. `sliceOrder` starts as identity 0..N-1,
  // then reorder edits mutate it.
  const transformedSlices: Panel[] = upstreamSlices.map((slice, i) => {
    const edits = editsBySlice.get(i) ?? [];
    let current = slice.clone();
    for (const { edit } of edits) {
      if (edit.op.kind === 'rotate') {
        const bb = current.boundingBox();
        const cx = (bb.min.x + bb.max.x) / 2;
        const cz = (bb.min.z + bb.max.z) / 2;
        const angle = (edit.op.degrees * Math.PI) / 180;
        const rotated = current.rotateAbout(
          new Vector3(0, 1, 0),
          angle,
          new Vector3(cx, 0, cz),
        );
        current.dispose();
        current = rotated;
      } else if (edit.op.kind === 'shift') {
        const shifted = current.translate(edit.op.delta, 0, 0);
        current.dispose();
        current = shifted;
      }
      // reorder is sequence-level; handled below.
    }
    return current;
  });

  // Reorder: apply in edit order, last wins per slice.
  let sliceOrder = upstreamSlices.map((_, i) => i);
  for (const { edit } of mergedEdits) {
    if (edit.op.kind === 'reorder') {
      sliceOrder = reorderSequence(sliceOrder, edit.target.sliceIdx, edit.op.newIdx);
    }
  }

  // ---- 5. Mate faces successively along the panel's +Z axis. ----
  //
  // Physical analogue: the woodworker holds the first slice still
  // on the bench, positions each subsequent piece against a fence
  // running along the panel's long axis, and slides it forward
  // until its cut face mates with the previous piece's cut face.
  // The slide direction is along the panel's Z axis — the fence
  // keeps every piece aligned to the same X column, so the
  // assembly grows in one dimension, not diagonally.
  //
  // Algorithm:
  // 1. Track a cursor in the ALONG-NORMAL (d) direction — this is
  //    the "pitch" axis of the cut, along which cut planes live.
  //    Each piece advances the cursor by its own projectOnto(normal)
  //    extent (= pitch for a slice, = width for a spacer).
  // 2. To position a piece so its low cut plane is at the current
  //    cursor, translate along +Z by (cursor - piece_d_low) / n_z.
  //    Why divide by n_z: translating along Z by dz shifts any
  //    plane's d-offset by dz · n_z, so the Z translation needed to
  //    move a plane by Δd along the normal is Δd / n_z.
  //
  // Why Z-only instead of along-normal: the normal at non-zero rip
  // has both X and Z components. Translating along the normal
  // moves pieces diagonally, accumulating an X drift across many
  // spacers so the panel grows in both dimensions. Translating
  // along Z only keeps every piece in the same X column — what a
  // fence-and-bench glue-up actually does — while still mating cut
  // planes exactly (cut plane d-offsets still land on their target
  // values because of the 1/n_z factor).
  //
  // At rip=0 n_z=1, so along-Z and along-normal coincide and the
  // old behaviour falls out unchanged. At rip!=0 the algorithm
  // produces a panel that grows only in Z, not diagonally.
  //
  // projectOnto (exact, walks mesh vertices) not measureAlong (AABB
  // over-approximation): the exact along-normal extent is what
  // drives cursor advancement; AABB Z would over-count for
  // parallelogram slices.
  //
  // Identity arrange (no edits, no spacers) flows through this
  // code path with zero translations: each slice's d_low exactly
  // equals the running cursor, so Δd=0 → dz=0, piece stays put.
  const normalAxis: [number, number, number] = ctx.lastCut
    ? computeCutNormalForArrange(ctx.lastCut)
    : [0, 0, 1];
  // z-component of the normal — the conversion factor from
  // along-normal shifts to along-Z shifts. Guard against near-zero
  // (normal in XY plane, rip very close to ±90° or extreme bevel)
  // to avoid division blow-up; in that regime the panel's geometry
  // degenerates anyway and the user would see the cut go sideways.
  const nZ = Math.abs(normalAxis[2]);
  const zFactor = nZ > 1e-6 ? nZ : 1;

  const firstSlice = transformedSlices[sliceOrder[0]];
  let cursor = firstSlice.projectOnto(normalAxis).min;

  const placedSlices: Panel[] = [];
  // Spacer placement: at each afterSliceIdx, after placing the slice
  // at output position matching the sliceIdx, insert a spacer slab.
  const spacersByAfterIdx = new Map<number, Array<{ spacer: SpacerInsert; source: string }>>();
  for (const s of mergedSpacers) {
    const arr = spacersByAfterIdx.get(s.spacer.afterSliceIdx) ?? [];
    arr.push(s);
    spacersByAfterIdx.set(s.spacer.afterSliceIdx, arr);
  }

  const appliedSpacerSources: string[] = [];
  let appliedSpacerCount = 0;

  for (let outIdx = 0; outIdx < sliceOrder.length; outIdx++) {
    const sliceIdx = sliceOrder[outIdx];
    const slice = transformedSlices[sliceIdx];
    const m = slice.projectOnto(normalAxis);
    const dz = (cursor - m.min) / zFactor;
    placedSlices.push(slice.translate(0, 0, dz));
    cursor += m.extent;

    // After placing slice-at-sliceIdx, insert any spacers keyed on
    // that sliceIdx (NB: afterSliceIdx is a reference to the input
    // slice, not the output position — spacer targets are slice
    // references just like edits).
    const here = spacersByAfterIdx.get(sliceIdx) ?? [];
    for (const { spacer, source } of here) {
      const spacerPanel = makeSpacerPanel(spacer, upstreamSlices[0], normalAxis);
      const sm = spacerPanel.projectOnto(normalAxis);
      const sdz = (cursor - sm.min) / zFactor;
      placedSlices.push(spacerPanel.translate(0, 0, sdz));
      spacerPanel.dispose();
      cursor += sm.extent;
      appliedSpacerSources.push(source);
      appliedSpacerCount++;
    }
  }

  // ---- 6. Concat everything. ----
  let assembled = placedSlices[0].clone();
  for (let i = 1; i < placedSlices.length; i++) {
    const next = assembled.concat(placedSlices[i]);
    assembled.dispose();
    assembled = next;
  }
  for (const p of placedSlices) p.dispose();
  for (const t of transformedSlices) t.dispose();
  for (const s of upstreamSlices) s.dispose();
  ctx.lastSlices = [];
  ctx.lastSliceProvenance = [];

  ctx.lastPanel = assembled;
  ctx.lastPanelFeatureId = f.id;
  if (ctx.preserveLive) ctx.livePanelsByFeature[f.id] = assembled;

  const appliedEditSources = mergedEdits.map((e) => e.source);

  return {
    featureId: f.id,
    status: 'ok',
    panel: assembled.toSnapshot(),
    appliedEditCount: mergedEdits.length,
    appliedEditSources,
    appliedSpacerCount,
    appliedSpacerSources,
  };
}

// ---------------------------------------------------------------------------
// TrimPanel — crop the upstream panel to an axis-aligned rectangle.
// ---------------------------------------------------------------------------

function executeTrimPanel(f: TrimPanel, ctx: ExecutionContext): TrimPanelResult {
  const input = ctx.lastPanel;
  if (!input) {
    return {
      featureId: f.id,
      status: 'error',
      statusReason: 'trimPanel without upstream panel',
      panel: emptySnapshot(),
      appliedBounds: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
      trimmedArea: 0,
    };
  }

  const upstreamSnapshot = input.toSnapshot();
  const upstreamBbox = input.boundingBox();
  const panelXMin = upstreamBbox.min.x;
  const panelXMax = upstreamBbox.max.x;
  const panelZMin = upstreamBbox.min.z;
  const panelZMax = upstreamBbox.max.z;

  // Compute the axis-aligned trim bounds per mode. All three modes
  // emit a bounds rect in XZ; trim is a clipping step applied to the
  // live panel via four axis-aligned splitByPlane calls.
  let bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  let status: 'ok' | 'warning' = 'ok';
  let statusReason: string | undefined;

  if (f.mode === 'bbox') {
    // User-supplied bounds; missing fields fall back to the panel's
    // current bbox extent. If the user asks for bounds that extend
    // OUTSIDE the current panel, clamp to the panel bbox and mark as
    // warning — honouring the request would otherwise be a no-op on
    // that side, which is worth surfacing.
    const requested = {
      xMin: f.bounds?.xMin ?? panelXMin,
      xMax: f.bounds?.xMax ?? panelXMax,
      zMin: f.bounds?.zMin ?? panelZMin,
      zMax: f.bounds?.zMax ?? panelZMax,
    };
    bounds = {
      xMin: Math.max(requested.xMin, panelXMin),
      xMax: Math.min(requested.xMax, panelXMax),
      zMin: Math.max(requested.zMin, panelZMin),
      zMax: Math.min(requested.zMax, panelZMax),
    };
    if (
      bounds.xMin !== requested.xMin ||
      bounds.xMax !== requested.xMax ||
      bounds.zMin !== requested.zMin ||
      bounds.zMax !== requested.zMax
    ) {
      status = 'warning';
      statusReason = 'bbox bounds extended outside panel; clamped to panel bbox';
    }
  } else {
    // 'flush' — largest axis-aligned rectangle inscribed in the
    //           top-face outline.
    // 'rectangle' — same algorithm against the INTERSECTION of top-
    //           and bottom-face outlines (bevel-aware).
    //
    // Algorithm (per #37 spec): collect all face vertices, classify
    // by half (left/right/bottom/top) relative to the AABB centroid,
    // take max of mins on one side and min of maxes on the other.
    // Assumption: the face outline is convex (true for all v2
    // pipeline outputs — parallelogram slices, cut→arrange panels,
    // spacer-expanded panels). Non-convex outlines (e.g. post-shift
    // arranges) would defeat the heuristic; for those cases the
    // resulting inscribed rect will still be inside the bbox but may
    // be sub-optimal, and we surface status='warning'.
    const vertices = collectFaceVertices(upstreamSnapshot, f.mode);

    if (vertices.length === 0) {
      bounds = { xMin: panelXMin, xMax: panelXMax, zMin: panelZMin, zMax: panelZMax };
    } else {
      bounds = computeInscribedRect(vertices, {
        xMin: panelXMin,
        xMax: panelXMax,
        zMin: panelZMin,
        zMax: panelZMax,
      });
    }
  }

  // Sanity-check the computed bounds. If bounds are degenerate (min >=
  // max), drop the trim — produce an empty panel with a warning rather
  // than attempt a no-material clip that would either throw in
  // manifold or silently produce garbage.
  if (bounds.xMin >= bounds.xMax || bounds.zMin >= bounds.zMax) {
    // Emit an empty trimmed panel. The upstream live panel survives
    // unchanged — future pipeline steps won't see it, but disposing
    // it here would be incorrect under preserveLive; instead we
    // replace lastPanel with an empty Panel and dispose the old one
    // per the normal flow.
    const empty = emptyPanel();
    if (!ctx.preserveLive) input.dispose();
    // But even under preserveLive, the input panel is no longer the
    // canonical lastPanel — replace it. The caller only reads
    // livePanels[featureId] so the upstream's livePanel entry stays
    // valid.
    ctx.lastPanel = empty;
    ctx.lastPanelFeatureId = f.id;
    if (ctx.preserveLive) ctx.livePanelsByFeature[f.id] = empty;
    return {
      featureId: f.id,
      status: 'warning',
      statusReason: statusReason ?? 'trim bounds are degenerate; panel empty',
      panel: empty.toSnapshot(),
      appliedBounds: bounds,
      trimmedArea:
        (panelXMax - panelXMin) * (panelZMax - panelZMin),
    };
  }

  // Apply four axis-aligned cuts: clip left of xMin, right of xMax,
  // below zMin, above zMax. Each cut splits the live panel into two
  // halves; we keep the half inside the bounds and dispose the other.
  //
  // Panel.cut(normal, offset) splits by plane n·x = offset: `above` is
  // n·x > offset, `below` is n·x < offset. So for the "keep x >= xMin"
  // cut, normal = (1, 0, 0), offset = xMin, keep `above`.
  let current = input.clone();

  // Helper: cut + dispose unwanted side. Returns the kept half.
  const axisCut = (
    panel: Panel,
    normal: [number, number, number],
    offset: number,
    keep: 'above' | 'below',
  ): Panel => {
    const { above, below } = panel.cut(normal, offset);
    if (keep === 'above') {
      below.dispose();
      return above;
    }
    above.dispose();
    return below;
  };

  const next1 = axisCut(current, [1, 0, 0], bounds.xMin, 'above');
  current.dispose();
  current = next1;

  const next2 = axisCut(current, [1, 0, 0], bounds.xMax, 'below');
  current.dispose();
  current = next2;

  const next3 = axisCut(current, [0, 0, 1], bounds.zMin, 'above');
  current.dispose();
  current = next3;

  const next4 = axisCut(current, [0, 0, 1], bounds.zMax, 'below');
  current.dispose();
  current = next4;

  // Compute trimmed area (XZ footprint of the material removed).
  const upstreamArea = (panelXMax - panelXMin) * (panelZMax - panelZMin);
  const keptArea = (bounds.xMax - bounds.xMin) * (bounds.zMax - bounds.zMin);
  const trimmedArea = Math.max(0, upstreamArea - keptArea);

  // Replace ctx.lastPanel with the trimmed panel. Under preserveLive,
  // the upstream live panel stays cached under its own featureId for
  // the caller; we don't dispose it here. When preserveLive is false,
  // dispose the upstream now that it's been consumed.
  if (!ctx.preserveLive) input.dispose();
  ctx.lastPanel = current;
  ctx.lastPanelFeatureId = f.id;
  if (ctx.preserveLive) ctx.livePanelsByFeature[f.id] = current;

  return {
    featureId: f.id,
    status,
    ...(statusReason ? { statusReason } : {}),
    panel: current.toSnapshot(),
    appliedBounds: bounds,
    trimmedArea,
  };
}

/**
 * Collect face vertices for the flush / rectangle mode computations.
 *
 *   'flush'     — union of all volumes' topFace vertices.
 *   'rectangle' — intersection of the top-face outline and bottom-face
 *                 outline. At bevel=90° both faces share the same
 *                 polygon, so this reduces to flush. At bevel<90° top
 *                 and bottom differ, and we want the inscribed
 *                 rectangle inside BOTH so the trim cuts are square
 *                 to the panel at every y.
 *
 * For the intersection case we use a pragmatic heuristic: treat the
 * set of vertices = topVerts ∪ bottomVerts, which forces the inscribed
 * rectangle's sides to sit inside both outlines. For convex outlines
 * this is correct; for non-convex it degrades gracefully to a smaller
 * rectangle.
 */
function collectFaceVertices(
  snap: PanelSnapshot,
  mode: 'flush' | 'rectangle',
): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (const vol of snap.volumes) {
    for (const p of vol.topFace) pts.push({ x: p.x, z: p.z });
    if (mode === 'rectangle') {
      for (const p of vol.bottomFace) pts.push({ x: p.x, z: p.z });
    }
  }
  return pts;
}

/**
 * Largest axis-aligned rectangle inscribed in a convex polygon, via
 * the #37 spec's half-plane vertex heuristic applied to the convex
 * hull of the input vertex set:
 *
 *   1. Compute convex hull of all input vertices (discards interior
 *      points — shared-edge vertices between adjacent volumes, strip
 *      boundaries etc. — which would spuriously constrain the rect).
 *   2. xMin = max({x : hull vertex on the STRICT left of centroid})
 *      xMax = min({x : hull vertex on the STRICT right of centroid})
 *      zMin = max({z : hull vertex on the STRICT bottom of centroid})
 *      zMax = min({z : hull vertex on the STRICT top of centroid})
 *
 * For a parallelogram (rip-angled arrange output with no spacers),
 * the hull has 4 vertices; each side of the centroid has two hull
 * vertices at differing x or z, and the max/min of those gives the
 * inscribed rectangle's edge — which is correct. For trapezoids and
 * other convex outlines, the heuristic still gives the inscribed
 * rectangle.
 *
 * Non-convex outlines (would only arise post-spacer at odd rip/
 * shift combinations we don't currently produce) degrade to the
 * hull's inscribed rect, which is a conservative but still
 * material-preserving trim.
 */
function computeInscribedRect(
  vertices: Array<{ x: number; z: number }>,
  bbox: { xMin: number; xMax: number; zMin: number; zMax: number },
): { xMin: number; xMax: number; zMin: number; zMax: number } {
  const hull = convexHull(vertices);
  const midX = (bbox.xMin + bbox.xMax) / 2;
  const midZ = (bbox.zMin + bbox.zMax) / 2;

  let xMin = bbox.xMin;
  let xMax = bbox.xMax;
  let zMin = bbox.zMin;
  let zMax = bbox.zMax;

  // Strict left/right/bottom/top classification. A hull vertex sitting
  // exactly at the centroid would be a degenerate symmetric case — we
  // ignore it in that case (neither constrains) rather than letting it
  // clamp the rect to a point.
  for (const v of hull) {
    if (v.x < midX && v.x > xMin) xMin = v.x;
    if (v.x > midX && v.x < xMax) xMax = v.x;
    if (v.z < midZ && v.z > zMin) zMin = v.z;
    if (v.z > midZ && v.z < zMax) zMax = v.z;
  }

  return { xMin, xMax, zMin, zMax };
}

/**
 * Convex hull of a 2D point set (XZ plane), via monotone chain.
 * Returns the hull vertices in CCW order (Andrew's algorithm). Used
 * by computeInscribedRect to discard interior / shared-edge vertices
 * that would spuriously constrain the half-plane heuristic.
 */
function convexHull(
  points: Array<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  if (points.length < 3) return [...points];
  const pts = points.slice().sort((a, b) => (a.x !== b.x ? a.x - b.x : a.z - b.z));

  const cross = (
    o: { x: number; z: number },
    a: { x: number; z: number },
    b: { x: number; z: number },
  ): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const lower: Array<{ x: number; z: number }> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<{ x: number; z: number }> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Create an empty Panel (zero segments). Used when a trim degenerates. */
function emptyPanel(): Panel {
  return new Panel([]);
}

/**
 * Compute the Cut's unit normal from its rip + bevel. Same formula
 * as executeCut; duplicated here so executeArrange can align its
 * mate-faces axis with the upstream cut without importing math from
 * the Cut executor's private state.
 *
 * α = 90° − bevel is the tilt magnitude (0 when cut is vertical).
 * The normal is the rip-only normal (sin θ, 0, cos θ) rotated by α
 * about the in-plane chord axis (cos θ, 0, −sin θ), yielding:
 *   n = (sin θ·cos α,  −sin α,  cos θ·cos α).
 */
function computeCutNormalForArrange(cut: Cut): [number, number, number] {
  const ripRad = (cut.rip * Math.PI) / 180;
  const alphaRad = ((90 - cut.bevel) * Math.PI) / 180;
  return [
    Math.sin(ripRad) * Math.cos(alphaRad),
    -Math.sin(alphaRad),
    Math.cos(ripRad) * Math.cos(alphaRad),
  ];
}

/**
 * Move sequence[fromIdx] to position newIdx, shifting other entries.
 * Out-of-range indices clamp to the sequence bounds. Used by the
 * reorder op.
 */
function reorderSequence(seq: number[], fromIdx: number, newIdx: number): number[] {
  if (fromIdx < 0 || fromIdx >= seq.length) return seq;
  const clampedNew = Math.max(0, Math.min(seq.length - 1, newIdx));
  const copy = seq.slice();
  const [picked] = copy.splice(fromIdx, 1);
  copy.splice(clampedNew, 0, picked);
  return copy;
}

/**
 * Build a spacer slab as a Panel — a single-segment panel whose
 * species matches the SpacerInsert and whose faces are oriented to
 * mate flush with adjacent slices at the upstream Cut's angle.
 *
 * Construction:
 *   1. Axis-aligned cube of (chord_length × panel_Y × spacer.width).
 *      chord_length = panel_X projected along the cut chord, so the
 *      rotated spacer ends up with panel_X along its world-X AABB
 *      (matching the adjacent slices).
 *   2. Rotate the cube so its natural "+Z" face normal aligns with
 *      the Cut's normal. At rip=0/bevel=90 this is identity. At
 *      rip!=0 or bevel!=90 the spacer becomes a parallelogram-
 *      shaped slab whose cut faces lie on the same plane family as
 *      the slices' cut faces, so they mate flush with no wedge gap.
 *
 * Physical analogue: the woodworker pre-cuts the spacer strip at
 * the same blade angle as the main cuts, so when clamped between
 * two slices it fills the gap without a visible seam.
 *
 * contributingStripIds = [spacer.id] so the resulting snapshot's
 * volume is attributable back to the originating SpacerInsert.
 */
function makeSpacerPanel(
  spacer: SpacerInsert,
  reference: Panel,
  cutNormal: [number, number, number],
): Panel {
  const Manifold = getManifold();
  const bb = reference.boundingBox();
  const xExtent = bb.max.x - bb.min.x;
  const yExtent = bb.max.y - bb.min.y;

  // Decompose the cut-normal into a Y-rotation (rip) and a
  // chord-axis rotation (bevel). If the normal is already +Z, both
  // angles are zero and the spacer is just an axis-aligned cube.
  const [nx, ny, nz] = cutNormal;
  const nxzLen = Math.hypot(nx, nz);
  const ripAngleRad = Math.atan2(nx, nz); // 0 when normal has no X component
  const bevelTiltRad = Math.atan2(-ny, nxzLen); // 0 when normal lies in XZ

  // Inflate the chord and thickness directions so the rotated
  // spacer's low AND high cut faces both fully span the slice's
  // X × Y extents — no triangular gaps where the spacer tapers
  // past the slice at non-zero rip or bevel.
  //
  // Geometry: after rotating a cube of (a × b × W) by rip about Y
  // and bevel α about the chord, each cut face's projection onto
  // the world X axis shifts by ±W/2 · sin(rip) (relative to the
  // cube's own X center), and onto world Y by ±W/2 · sin(α).
  // Adjacent cut planes therefore have their material staggered
  // in X by W · sin(rip) and in Y by W · sin(α). To make every
  // cut face span xExtent × yExtent after rotation, the cube
  // needs that same stagger added to its pre-rotation size, then
  // divided by the cos factor that the rotation introduces:
  //   a = (xExtent + W · |sin rip|) / |cos rip|
  //   b = (yExtent + W · |sin α|)   / |cos α|
  // At rip = 0 (|sin| = 0, |cos| = 1) this reduces to a = xExtent;
  // at α = 0 to b = yExtent. No geometric penalty on the easy case.
  const cosRip = Math.cos(ripAngleRad);
  const sinRipMag = Math.abs(Math.sin(ripAngleRad));
  const cosBevel = Math.cos(bevelTiltRad);
  const sinBevelMag = Math.abs(Math.sin(bevelTiltRad));
  const chordLen =
    Math.abs(cosRip) > 1e-6
      ? (xExtent + spacer.width * sinRipMag) / Math.abs(cosRip)
      : xExtent;
  const thicknessHeight =
    Math.abs(cosBevel) > 1e-6
      ? (yExtent + spacer.width * sinBevelMag) / Math.abs(cosBevel)
      : yExtent;

  let panel = new Panel([
    {
      manifold: Manifold.cube([chordLen, thicknessHeight, spacer.width], true),
      species: spacer.species,
      contributingStripIds: [spacer.id],
      // Spacers don't descend from a Cut — they're fresh material
      // inserted into the arrangement. No slice provenance.
      contributingSliceIds: [],
    },
  ]);

  // Apply rip rotation (about Y). Pivot at origin — the spacer is
  // centred there from Manifold.cube(..., true).
  if (Math.abs(ripAngleRad) > 1e-9) {
    const rotated = panel.rotateAbout(
      new Vector3(0, 1, 0),
      ripAngleRad,
      new Vector3(0, 0, 0),
    );
    panel.dispose();
    panel = rotated;
  }

  // Apply bevel tilt about the (now world-space) chord axis. After
  // the Y-rotation above, the chord axis is (cos(rip), 0, -sin(rip)).
  if (Math.abs(bevelTiltRad) > 1e-9) {
    const chordAxis = new Vector3(Math.cos(ripAngleRad), 0, -Math.sin(ripAngleRad));
    const tilted = panel.rotateAbout(chordAxis, bevelTiltRad, new Vector3(0, 0, 0));
    panel.dispose();
    panel = tilted;
  }

  return panel;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): PanelSnapshot {
  return { bbox: { min: [0, 0, 0], max: [0, 0, 0] }, volumes: [] };
}
