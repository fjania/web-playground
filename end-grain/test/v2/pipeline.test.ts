import { describe, it, expect } from 'vitest';
import '../setup';

import { runPipeline } from '../../src/v2/state/pipeline';
import { defaultTimeline } from '../../src/v2/state/defaultTimeline';
import { createIdCounter, allocateId } from '../../src/v2/state/ids';
import type {
  ArrangeResult,
  ComposeStrips,
  ComposeStripsResult,
  CutResult,
  Feature,
  PresetResult,
} from '../../src/v2/state/types';

// ---------------------------------------------------------------------------
// Default timeline — the simplest happy path through the pipeline.
// ---------------------------------------------------------------------------

describe('runPipeline — default timeline', () => {
  it('executes compose → cut → arrange in trace order', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    expect(out.trace).toEqual(['compose-0', 'cut-0', 'arrange-0']);
  });

  it('every feature emits status ok', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    for (const id of out.trace) {
      expect(out.results[id].status).toBe('ok');
    }
  });

  it('compose result panel has 2 volumes matching strips', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const r = out.results['compose-0'] as ComposeStripsResult;
    expect(r.panel.volumes).toHaveLength(2);
    expect(r.panel.volumes[0].species).toBe('maple');
    expect(r.panel.volumes[0].contributingStripIds).toEqual(['strip-0']);
    expect(r.panel.volumes[1].species).toBe('walnut');
    expect(r.panel.volumes[1].contributingStripIds).toEqual(['strip-1']);
  });

  it('cut result slices panel into 8 full-width slices at pitch 50', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const r = out.results['cut-0'] as CutResult;
    expect(r.slices).toHaveLength(8);
    for (const s of r.slices) {
      // Every slice should span the full 100mm X (both strips) and
      // have 50mm thickness along Z.
      expect(s.volumes).toHaveLength(2);
      const zExtent = s.bbox.max[2] - s.bbox.min[2];
      expect(zExtent).toBeCloseTo(50, 4);
    }
  });

  it('cut result provenance: every slice carries both source strip ids', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const r = out.results['cut-0'] as CutResult;
    for (const { sliceIdx, contributingStripIds } of r.sliceProvenance) {
      expect(contributingStripIds.sort()).toEqual(['strip-0', 'strip-1']);
      expect(sliceIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it('arrange(identity) reassembles slices into a panel with input bbox', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const compose = out.results['compose-0'] as ComposeStripsResult;
    const arrange = out.results['arrange-0'] as ArrangeResult;

    // Output bbox equals input bbox (identity reassembly, rip=0).
    expect(arrange.panel.bbox.min[0]).toBeCloseTo(compose.panel.bbox.min[0], 4);
    expect(arrange.panel.bbox.max[0]).toBeCloseTo(compose.panel.bbox.max[0], 4);
    expect(arrange.panel.bbox.min[1]).toBeCloseTo(compose.panel.bbox.min[1], 4);
    expect(arrange.panel.bbox.max[1]).toBeCloseTo(compose.panel.bbox.max[1], 4);
    expect(arrange.panel.bbox.min[2]).toBeCloseTo(compose.panel.bbox.min[2], 4);
    expect(arrange.panel.bbox.max[2]).toBeCloseTo(compose.panel.bbox.max[2], 4);
  });

  it('arrange applied-edit / spacer counts are zero for identity', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const arrange = out.results['arrange-0'] as ArrangeResult;
    expect(arrange.appliedEditCount).toBe(0);
    expect(arrange.appliedEditSources).toEqual([]);
    expect(arrange.appliedSpacerCount).toBe(0);
    expect(arrange.appliedSpacerSources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mitred identity — rip=30°, no edits. Tests the cursor-slide algorithm's
// ability to reassemble flush at any cut angle.
// ---------------------------------------------------------------------------

describe('runPipeline — mitred identity (rip=30°)', () => {
  it('output bbox equals input bbox within epsilon', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    // Mutate the cut feature's rip. Safe because the array hasn't
    // been frozen and this is the only timeline we're using.
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('unexpected timeline shape');
    cut.rip = 30;

    const out = runPipeline(timeline);
    const compose = out.results['compose-0'] as ComposeStripsResult;
    const arrange = out.results['arrange-0'] as ArrangeResult;

    // bbox-of-whole-panel should match within epsilon. Individual
    // slice bboxes are AABBs that over-approximate the parallelogram
    // volumes, but summed/concatenated the reassembly is flush.
    const eps = 0.5; // mm. The Z-extent may round differently because
    // measureAlong is AABB-based for rotated segments.
    expect(Math.abs(arrange.panel.bbox.min[2] - compose.panel.bbox.min[2])).toBeLessThan(eps);
    expect(Math.abs(arrange.panel.bbox.max[2] - compose.panel.bbox.max[2])).toBeLessThan(eps);
    expect(Math.abs(arrange.panel.bbox.min[0] - compose.panel.bbox.min[0])).toBeLessThan(eps);
    expect(Math.abs(arrange.panel.bbox.max[0] - compose.panel.bbox.max[0])).toBeLessThan(eps);
  });
});

// ---------------------------------------------------------------------------
// Serialisability — model is the source of truth.
// ---------------------------------------------------------------------------

describe('runPipeline — serialisability', () => {
  it('PipelineOutput roundtrips through JSON.stringify / parse without loss', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const roundtripped = JSON.parse(JSON.stringify(out));
    expect(roundtripped).toEqual(out);
  });

  it('results map contains one entry per feature in the timeline', () => {
    const timeline: Feature[] = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    for (const f of timeline) {
      expect(out.results[f.id]).toBeDefined();
      expect(out.results[f.id].featureId).toBe(f.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Checkerboard final state — 8 strips + flipAlternate preset.
// ---------------------------------------------------------------------------

/**
 * Build a checkerboard timeline: 8 alternating 25mm strips, cut at
 * pitch=25, flipAlternate preset on the arrange.
 */
function checkerboardTimeline(): Feature[] {
  const counter = createIdCounter();
  const strips = Array.from({ length: 8 }, (_, i) => ({
    stripId: allocateId(counter, 'strip'),
    species: (i % 2 === 0 ? 'maple' : 'walnut') as 'maple' | 'walnut',
    width: 25,
  }));
  const compose: ComposeStrips = {
    kind: 'composeStrips',
    id: 'compose-0',
    strips,
    stripHeight: 50,
    stripLength: 200,
    status: 'ok',
  };
  allocateId(counter, 'compose');
  return [
    compose,
    {
      kind: 'cut',
      id: allocateId(counter, 'cut'),
      rip: 0,
      bevel: 90,
      pitch: 25,
      showOffcuts: false,
      status: 'ok',
    },
    {
      kind: 'arrange',
      id: allocateId(counter, 'arrange'),
      layout: 'cursor-slide',
      status: 'ok',
    },
    {
      kind: 'preset',
      id: allocateId(counter, 'preset'),
      arrangeId: 'arrange-0',
      preset: 'flipAlternate',
      params: {},
      status: 'ok',
    },
  ];
}

describe('runPipeline — checkerboard', () => {
  it('flipAlternate preset expands to (N/2) PlaceEdits on odd slices', () => {
    const out = runPipeline(checkerboardTimeline());
    const presetResult = out.results['preset-0'] as PresetResult;
    // Type guard on expandedPlaceEdits
    if (!('expandedPlaceEdits' in presetResult)) throw new Error('wrong preset variant');
    // 8 slices → odd slices = {1,3,5,7} → 4 edits
    expect(presetResult.expandedPlaceEdits).toHaveLength(4);
    for (const e of presetResult.expandedPlaceEdits) {
      expect(e.op.kind).toBe('rotate');
      if (e.op.kind !== 'rotate') throw new Error('narrow');
      expect(e.op.degrees).toBe(180);
    }
    // Odd sliceIdxs only.
    const idxs = presetResult.expandedPlaceEdits.map((e) => e.target.sliceIdx);
    expect(idxs).toEqual([1, 3, 5, 7]);
  });

  it('arrange records 4 applied edits, sourced to the preset feature', () => {
    const out = runPipeline(checkerboardTimeline());
    const arrange = out.results['arrange-0'] as ArrangeResult;
    expect(arrange.appliedEditCount).toBe(4);
    expect(arrange.appliedEditSources).toEqual(['preset-0', 'preset-0', 'preset-0', 'preset-0']);
  });

  it('flipAlternate preserves the whole-panel bbox', () => {
    const out = runPipeline(checkerboardTimeline());
    const compose = out.results['compose-0'] as ComposeStripsResult;
    const arrange = out.results['arrange-0'] as ArrangeResult;
    // 8 strips × 25mm = 200 X. pitch=25, length=200 → 8 slices × 25 = 200 Z.
    expect(arrange.panel.bbox.min[0]).toBeCloseTo(compose.panel.bbox.min[0], 4);
    expect(arrange.panel.bbox.max[0]).toBeCloseTo(compose.panel.bbox.max[0], 4);
    expect(arrange.panel.bbox.min[2]).toBeCloseTo(compose.panel.bbox.min[2], 4);
    expect(arrange.panel.bbox.max[2]).toBeCloseTo(compose.panel.bbox.max[2], 4);
  });

  it('output panel has 64 species-homogeneous volumes (8×8)', () => {
    const out = runPipeline(checkerboardTimeline());
    const arrange = out.results['arrange-0'] as ArrangeResult;
    // 8 slices × 8 strips/slice = 64 volumes.
    expect(arrange.panel.volumes).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// Brick step 2 — asymmetric compose + flipAlternate (no spacers).
// ---------------------------------------------------------------------------

function brickTimelineNoSpacers(): Feature[] {
  // 7 strips: 3× maple full + 3× walnut mortar + 1 maple half-brick.
  // Widths: 50, 5, 50, 5, 50, 5, 25 = 190mm total X.
  // Length 400, pitch 50 → 8 slices.
  const counter = createIdCounter();
  const strips = [
    { stripId: allocateId(counter, 'strip'), species: 'maple' as const, width: 50 },
    { stripId: allocateId(counter, 'strip'), species: 'walnut' as const, width: 5 },
    { stripId: allocateId(counter, 'strip'), species: 'maple' as const, width: 50 },
    { stripId: allocateId(counter, 'strip'), species: 'walnut' as const, width: 5 },
    { stripId: allocateId(counter, 'strip'), species: 'maple' as const, width: 50 },
    { stripId: allocateId(counter, 'strip'), species: 'walnut' as const, width: 5 },
    { stripId: allocateId(counter, 'strip'), species: 'maple' as const, width: 25 },
  ];
  const compose: ComposeStrips = {
    kind: 'composeStrips',
    id: 'compose-0',
    strips,
    stripHeight: 50,
    stripLength: 400,
    status: 'ok',
  };
  allocateId(counter, 'compose');
  return [
    compose,
    {
      kind: 'cut',
      id: allocateId(counter, 'cut'),
      rip: 0,
      bevel: 90,
      pitch: 50,
      showOffcuts: false,
      status: 'ok',
    },
    {
      kind: 'arrange',
      id: allocateId(counter, 'arrange'),
      layout: 'cursor-slide',
      status: 'ok',
    },
    {
      kind: 'preset',
      id: allocateId(counter, 'preset'),
      arrangeId: 'arrange-0',
      preset: 'flipAlternate',
      params: {},
      status: 'ok',
    },
  ];
}

describe('runPipeline — brick step 2 (compose + flipAlternate)', () => {
  it('preserves bbox (no spacers yet)', () => {
    const out = runPipeline(brickTimelineNoSpacers());
    const compose = out.results['compose-0'] as ComposeStripsResult;
    const arrange = out.results['arrange-0'] as ArrangeResult;
    // Compose X extent: 50+5+50+5+50+5+25 = 190. Z extent: 400.
    expect(arrange.panel.bbox.min[0]).toBeCloseTo(compose.panel.bbox.min[0], 3);
    expect(arrange.panel.bbox.max[0]).toBeCloseTo(compose.panel.bbox.max[0], 3);
    expect(arrange.panel.bbox.min[2]).toBeCloseTo(compose.panel.bbox.min[2], 3);
    expect(arrange.panel.bbox.max[2]).toBeCloseTo(compose.panel.bbox.max[2], 3);
  });
});

// ---------------------------------------------------------------------------
// Brick step 3 — brick step 2 + spacerEveryRow.
// ---------------------------------------------------------------------------

function brickTimelineWithSpacers(): Feature[] {
  const t = brickTimelineNoSpacers();
  t.push({
    kind: 'preset',
    id: 'preset-1',
    arrangeId: 'arrange-0',
    preset: 'spacerEveryRow',
    params: { species: 'walnut', width: 5 },
    status: 'ok',
  });
  return t;
}

describe('runPipeline — brick step 3 (compose + flipAlternate + spacerEveryRow)', () => {
  it('spacerEveryRow preset expands to N-1 SpacerInserts', () => {
    const out = runPipeline(brickTimelineWithSpacers());
    const spacerPreset = out.results['preset-1'] as PresetResult;
    if (!('expandedSpacers' in spacerPreset)) throw new Error('wrong preset variant');
    // 8 slices → 7 spacers between them.
    expect(spacerPreset.expandedSpacers).toHaveLength(7);
    for (const s of spacerPreset.expandedSpacers) {
      expect(s.species).toBe('walnut');
      expect(s.width).toBe(5);
    }
  });

  it('arrange records 7 applied spacers, sourced to the spacer preset', () => {
    const out = runPipeline(brickTimelineWithSpacers());
    const arrange = out.results['arrange-0'] as ArrangeResult;
    expect(arrange.appliedSpacerCount).toBe(7);
    for (const src of arrange.appliedSpacerSources) expect(src).toBe('preset-1');
  });

  it('Z bbox extends by 35mm (7 × 5mm spacers)', () => {
    const out = runPipeline(brickTimelineWithSpacers());
    const compose = out.results['compose-0'] as ComposeStripsResult;
    const arrange = out.results['arrange-0'] as ArrangeResult;
    const composeZ = compose.panel.bbox.max[2] - compose.panel.bbox.min[2];
    const arrangeZ = arrange.panel.bbox.max[2] - arrange.panel.bbox.min[2];
    expect(arrangeZ - composeZ).toBeCloseTo(35, 3);
  });
});

// ---------------------------------------------------------------------------
// Topological execution order — trace has presets before their arrange
// even when they appear after the arrange in the timeline.
// ---------------------------------------------------------------------------

describe('runPipeline — topological execution', () => {
  it('trace records preset before arrange even when preset is last in timeline', () => {
    const out = runPipeline(checkerboardTimeline());
    // Timeline order: compose-0, cut-0, arrange-0, preset-0.
    // Execution order: compose-0, cut-0, preset-0, arrange-0.
    expect(out.trace).toEqual(['compose-0', 'cut-0', 'preset-0', 'arrange-0']);
  });
});

// ---------------------------------------------------------------------------
// Preset + manual edit composition — "manual wins on same slice".
// ---------------------------------------------------------------------------

describe('runPipeline — preset + manual composition', () => {
  it('user PlaceEdit on sliceIdx drops preset edits on that slice', () => {
    // Default timeline + flipAlternate + user rotate 180 on slice 1.
    // With "manual wins", preset's rotate-180 on slice 1 is dropped;
    // only user's rotate-180 remains. Slice 1 still ends up rotated
    // once (same net effect here, but sourcing attributes to the
    // user edit, not the preset).
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    timeline.push({
      kind: 'preset',
      id: allocateId(counter, 'preset'),
      arrangeId: 'arrange-0',
      preset: 'flipAlternate',
      params: {},
      status: 'ok',
    });
    timeline.push({
      kind: 'placeEdit',
      id: allocateId(counter, 'edit'),
      target: { arrangeId: 'arrange-0', sliceIdx: 1 },
      op: { kind: 'rotate', degrees: 180 },
      status: 'ok',
    });

    const out = runPipeline(timeline);
    const arrange = out.results['arrange-0'] as ArrangeResult;

    // 8 slices; preset would normally flip {1,3,5,7} = 4 edits.
    // User wins on slice 1 → preset edits on {3,5,7} (3) + user edit on 1 (1) = 4 total.
    expect(arrange.appliedEditCount).toBe(4);
    // Sources: 3 from preset, 1 from the user edit.
    const presetCount = arrange.appliedEditSources.filter((s) => s === 'preset-0').length;
    const editCount = arrange.appliedEditSources.filter((s) => s === 'edit-0').length;
    expect(presetCount).toBe(3);
    expect(editCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Malformed timelines — the executor degrades gracefully with status='error'.
// ---------------------------------------------------------------------------

describe('runPipeline — malformed timelines', () => {
  it('cut without upstream panel produces status=error', () => {
    const timeline: Feature[] = [
      {
        kind: 'cut',
        id: 'cut-0',
        rip: 0,
        bevel: 90,
        pitch: 50,
        showOffcuts: false,
        status: 'ok',
      },
    ];
    const out = runPipeline(timeline);
    const r = out.results['cut-0'];
    expect(r.status).toBe('error');
    expect(r.statusReason).toMatch(/cut without upstream/);
  });

  it('arrange without upstream cut produces status=error', () => {
    const timeline: Feature[] = [
      {
        kind: 'arrange',
        id: 'arrange-0',
        layout: 'cursor-slide',
        status: 'ok',
      },
    ];
    const out = runPipeline(timeline);
    const r = out.results['arrange-0'];
    expect(r.status).toBe('error');
    expect(r.statusReason).toMatch(/arrange without upstream/);
  });
});
