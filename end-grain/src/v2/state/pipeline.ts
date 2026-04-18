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

import { Panel } from '../domain/Panel';
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
  Preset,
  SpacerInsert,
} from './types';

export interface PipelineOutput {
  /** featureId → FeatureResult. Plain data — JSON-serialisable. */
  results: Record<string, FeatureResult>;
  /** featureIds in execution order. */
  trace: string[];
}

export function runPipeline(features: Feature[]): PipelineOutput {
  const ctx = new ExecutionContext();

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
      case 'placeEdit':
      case 'spacerInsert':
        // Contribute to an Arrange; they produce trivial results (no
        // geometry of their own) and are consumed via ctx indices.
        ctx.record(f.id, { featureId: f.id, status: 'ok' });
        break;
    }
  }

  ctx.disposeLiveGeometry();
  return { results: ctx.results, trace: ctx.trace };
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

  disposeLiveGeometry(): void {
    if (this.lastPanel) {
      this.lastPanel.dispose();
      this.lastPanel = null;
    }
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

  // Slice count: measure extent along cut-normal, divide by pitch.
  const { extent } = input.measureAlong(normal);
  const count = Math.max(0, Math.floor(extent / f.pitch));

  const { slices, offcuts } = input.cutRepeated(normal, f.pitch, count, 0);

  // Take snapshots before we move the live geometry into ctx / dispose.
  const sliceSnapshots: PanelSnapshot[] = slices.map((s) => s.toSnapshot());
  const offcutSnapshots: PanelSnapshot[] = offcuts.map((p) => p.toSnapshot());
  const sliceProvenance = slices.map((s, sliceIdx) => ({
    sliceIdx,
    contributingStripIds: collectStripIds(s),
  }));

  // Stash live slices for the downstream Arrange. Dispose input +
  // offcuts; we don't reuse them as live geometry.
  input.dispose();
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
// Arrange (cursor-slide, identity layout — no edits yet)
// ---------------------------------------------------------------------------

function executeArrange(f: Arrange, ctx: ExecutionContext): ArrangeResult {
  const upstreamSlices = ctx.lastSlices;
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

  // Identity arrange for this commit: slices are already baked in
  // their post-cut positions, so concat them in place — that gives
  // bbox(output) = bbox(input) at any rip angle. Cursor-slide
  // (measuring each slice's thickness from manifold geometry and
  // placing flush at a running cursor) is introduced in the next
  // commit when PlaceEdits land — edited slices are no longer in
  // their baked positions and must be re-placed.
  //
  // Rationale: AABB-based measureAlong overestimates thickness for
  // parallelogram slices (rip != 0), so naively cursor-sliding the
  // identity case would break the bbox invariant. Baking-in-place
  // here is correct by construction.
  let assembled = upstreamSlices[0].clone();
  for (let i = 1; i < upstreamSlices.length; i++) {
    const next = assembled.concat(upstreamSlices[i]);
    assembled.dispose();
    assembled = next;
  }
  for (const s of upstreamSlices) s.dispose();
  ctx.lastSlices = [];
  ctx.lastSliceProvenance = [];

  // Promote assembled panel to lastPanel so any downstream Cut/Arrange
  // sees it as input.
  ctx.lastPanel = assembled;

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): PanelSnapshot {
  return { bbox: { min: [0, 0, 0], max: [0, 0, 0] }, volumes: [] };
}
