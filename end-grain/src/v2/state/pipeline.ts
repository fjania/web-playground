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
import { getManifold } from '../../domain/manifold';
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
} from './types';

export interface PipelineOutput {
  /** featureId → FeatureResult. Plain data — JSON-serialisable. */
  results: Record<string, FeatureResult>;
  /** featureIds in execution order. */
  trace: string[];
  /**
   * Live Panel instances per featureId, populated when
   * `runPipeline(features, { preserveLive: true })` is called.
   * Present only for features that produce a panel (ComposeStrips
   * and Arrange for this version; Cut's live slices are not
   * surfaced). Caller owns these and must call `.dispose()` when
   * done to free manifold handles.
   *
   * Absent for the default (pure-function) call to preserve JSON
   * serialisability.
   */
  livePanels?: Record<string, Panel>;
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

  // Hand off the accumulated livePanels map (under preserveLive).
  const livePanels = ctx.preserveLive
    ? { ...ctx.livePanelsByFeature }
    : undefined;

  ctx.disposeLiveGeometry({ keepLivePanels: ctx.preserveLive });

  return {
    results: ctx.results,
    trace: ctx.trace,
    ...(livePanels ? { livePanels } : {}),
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

  // Cut normal: rip is rotation of the cut plane about Y, in degrees.
  // bevel is tilt about X (from vertical). bevel=90 means the plane is
  // vertical — for this commit we ignore bevel angles != 90 (deferred).
  const ripRad = (f.rip * Math.PI) / 180;
  const normal: [number, number, number] = [
    Math.sin(ripRad),
    0,
    Math.cos(ripRad),
  ];

  // Slice count: use the "safe extent" — the range of plane offsets
  // where the cut plane passes fully across the panel's X width,
  // producing a full-width parallelogram slice. Outside that range
  // the plane exits the panel through the ±Z edges before reaching
  // both X edges, producing a triangular partial slice that isn't a
  // usable board piece. Those triangles become offcuts.
  //
  // Formula: safeExtent = panelZ * |cos(rip)| - panelX * |sin(rip)|.
  //   At rip=0: panelZ  (full length — every plane is safe).
  //   At rip=45 (panel 100×400): 400*0.707 - 100*0.707 = 212.1.
  //   At the critical angle arctan(panelZ / panelX), safeExtent→0 (no full slice fits).
  //
  // For angles beyond that critical angle (a crosscut-dominated rip),
  // the roles of width and length flip and a different formula is
  // needed. Deferring; typical end-grain rips stay well under the
  // critical angle.
  const inputBbox = input.boundingBox();
  const panelX = inputBbox.max.x - inputBbox.min.x;
  const panelZ = inputBbox.max.z - inputBbox.min.z;
  const safeExtent = Math.max(
    0,
    panelZ * Math.abs(Math.cos(ripRad)) - panelX * Math.abs(Math.sin(ripRad)),
  );
  const count = Math.max(0, Math.floor(safeExtent / f.pitch));

  const { slices, offcuts } = input.cutRepeated(normal, f.pitch, count, 0);

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
// Arrange (cursor-slide with PlaceEdits, Preset expansion, SpacerInsert)
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

  // ---- 3.5 Identity fast path. ----
  // If there are no edits and no spacers, slices are already in
  // their baked post-cut positions — concat in place. This is
  // correct by construction at any rip angle (AABB-based
  // measureAlong overestimates parallelogram thickness, so naive
  // cursor-slide would break bbox invariants here).
  if (mergedEdits.length === 0 && mergedSpacers.length === 0) {
    let assembled = upstreamSlices[0].clone();
    for (let i = 1; i < upstreamSlices.length; i++) {
      const next = assembled.concat(upstreamSlices[i]);
      assembled.dispose();
      assembled = next;
    }
    for (const s of upstreamSlices) s.dispose();
    ctx.lastSlices = [];
    ctx.lastSliceProvenance = [];
    ctx.lastPanel = assembled;
    ctx.lastPanelFeatureId = f.id;
    if (ctx.preserveLive) ctx.livePanelsByFeature[f.id] = assembled;
    return {
      featureId: f.id,
      status: 'ok',
      panel: assembled.toSnapshot(),
      appliedEditCount: 0,
      appliedEditSources: [],
      appliedSpacerCount: 0,
      appliedSpacerSources: [],
    };
  }

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

  // ---- 5. Cursor-slide along +Z. ----
  // Each slice is axis-aligned-after-edit (rotations are multiples of
  // 90° about Y; shifts are along X; reorders don't rotate), so
  // measureAlong([0,0,1]) is exact. For rip != 0 the upstream Cut
  // produces parallelogram slices; this executor currently assumes
  // rip=0 for edit-application correctness. rip != 0 with edits is
  // a known gap tracked in #20 and will be generalised when the
  // renderer demands it.
  const slideAxis: [number, number, number] = [0, 0, 1];
  // Seed cursor at first slice's min-along-Z (preserves bbox
  // position; output panel aligns with input panel's Z range).
  const firstSlice = transformedSlices[sliceOrder[0]];
  let cursor = firstSlice.measureAlong(slideAxis).min;

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
    const m = slice.measureAlong(slideAxis);
    const dz = cursor - m.min;
    placedSlices.push(slice.translate(0, 0, dz));
    cursor += m.extent;

    // After placing slice-at-sliceIdx, insert any spacers keyed on
    // that sliceIdx (NB: afterSliceIdx is a reference to the input
    // slice, not the output position — spacer targets are slice
    // references just like edits).
    const here = spacersByAfterIdx.get(sliceIdx) ?? [];
    for (const { spacer, source } of here) {
      const spacerPanel = makeSpacerPanel(spacer, upstreamSlices[0]);
      const sm = spacerPanel.measureAlong(slideAxis);
      const sdz = cursor - sm.min;
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
 * species matches the SpacerInsert, Z-extent = spacer.width, and
 * X/Y extents match the reference slice's. contributingStripIds is
 * [spacer.id] so the resulting snapshot's volume is attributable
 * back to the originating SpacerInsert feature.
 */
function makeSpacerPanel(spacer: SpacerInsert, reference: Panel): Panel {
  const Manifold = getManifold();
  const bb = reference.boundingBox();
  const xExtent = bb.max.x - bb.min.x;
  const yExtent = bb.max.y - bb.min.y;
  const mf = Manifold.cube([xExtent, yExtent, spacer.width], true);
  return new Panel([
    {
      manifold: mf,
      species: spacer.species,
      contributingStripIds: [spacer.id],
      // Spacers don't descend from a Cut — they're fresh material
      // inserted into the arrangement. No slice provenance.
      contributingSliceIds: [],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): PanelSnapshot {
  return { bbox: { min: [0, 0, 0], max: [0, 0, 0] }, volumes: [] };
}
