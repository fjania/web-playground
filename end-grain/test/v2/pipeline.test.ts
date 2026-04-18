import { describe, it, expect } from 'vitest';
import '../setup';

import { runPipeline } from '../../src/v2/state/pipeline';
import { defaultTimeline } from '../../src/v2/state/defaultTimeline';
import { createIdCounter } from '../../src/v2/state/ids';
import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
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
