import { describe, it, expect } from 'vitest';
import './setup';

import { runPipeline } from '../src/state/pipeline';
import { defaultTimeline } from '../src/state/defaultTimeline';
import { createIdCounter, allocateId } from '../src/state/ids';
import type {
  ArrangeResult,
  ComposeStrips,
  ComposeStripsResult,
  CutResult,
  Feature,
  PresetResult,
  TrimPanel,
  TrimPanelResult,
} from '../src/state/types';

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
// Provenance — slice sliceProvenance at rip=0 and rip=30°.
// ---------------------------------------------------------------------------

describe('runPipeline — slice provenance', () => {
  it('rip=0: every slice carries the full strip list', () => {
    const out = runPipeline(checkerboardTimeline());
    const r = out.results['cut-0'] as CutResult;
    const fullStripList = ['strip-0', 'strip-1', 'strip-2', 'strip-3',
                          'strip-4', 'strip-5', 'strip-6', 'strip-7'];
    for (const { contributingStripIds } of r.sliceProvenance) {
      expect([...contributingStripIds].sort()).toEqual([...fullStripList].sort());
    }
  });

  it('slices are tagged with contributingSliceIds = [${cut.id}-slice-${idx}]', () => {
    const out = runPipeline(checkerboardTimeline());
    const r = out.results['cut-0'] as CutResult;
    for (let sliceIdx = 0; sliceIdx < r.slices.length; sliceIdx++) {
      const slice = r.slices[sliceIdx];
      const expectedSliceId = `cut-0-slice-${sliceIdx}`;
      for (const v of slice.volumes) {
        expect(v.contributingSliceIds).toEqual([expectedSliceId]);
      }
    }
  });

  it('arrange output carries the slice ids from cut (preserved through concat)', () => {
    const out = runPipeline(checkerboardTimeline());
    const r = out.results['arrange-0'] as ArrangeResult;
    // Every volume in the arrange output should have exactly one
    // slice id referencing cut-0 (since there's only one Cut in
    // this timeline).
    for (const v of r.panel.volumes) {
      expect(v.contributingSliceIds).toHaveLength(1);
      expect(v.contributingSliceIds[0]).toMatch(/^cut-0-slice-\d+$/);
    }
    // All 8 distinct slice ids should appear across the volumes.
    const distinctSlices = new Set(
      r.panel.volumes.map((v) => v.contributingSliceIds[0]),
    );
    expect(distinctSlices.size).toBe(8);
  });

  it('rip=30°: slice bboxes differ per slice (angled cut staggers them)', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('unexpected shape');
    cut.rip = 30;

    const out = runPipeline(timeline);
    const r = out.results['cut-0'] as CutResult;
    expect(r.slices.length).toBeGreaterThan(1);

    // Successive slices must have distinct bboxes — because the cut
    // plane is angled, each slice's min-Z differs from the previous.
    for (let i = 1; i < r.slices.length; i++) {
      const prev = r.slices[i - 1];
      const cur = r.slices[i];
      const samePosition =
        prev.bbox.min[2] === cur.bbox.min[2] &&
        prev.bbox.max[2] === cur.bbox.max[2] &&
        prev.bbox.min[0] === cur.bbox.min[0] &&
        prev.bbox.max[0] === cur.bbox.max[0];
      expect(samePosition).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Rip-angle sweep — verifies the safe-extent formula and identity
// reassembly bbox at several angles. Catches regressions in the
// "discard partial end-slices" behaviour.
// ---------------------------------------------------------------------------

describe.each([
  // expectedCount derives from safeExtent = panelZ*cos(rip) - panelX*sin(rip),
  // with panelZ=400, panelX=100, pitch=50.
  { rip: 0, expectedCount: 8 },   // safeExtent = 400
  { rip: 15, expectedCount: 7 },  // safeExtent ≈ 360.5
  { rip: 30, expectedCount: 5 },  // safeExtent ≈ 296.4
  { rip: 45, expectedCount: 4 },  // safeExtent ≈ 212.1
  { rip: 60, expectedCount: 2 },  // safeExtent ≈ 113.4
])('runPipeline — rip=$rip° on default 100×50×400 panel', ({ rip, expectedCount }) => {
  function runAtRip(): { compose: ComposeStripsResult; arrange: ArrangeResult; cut: CutResult } {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cutFeature = timeline[1];
    if (cutFeature.kind !== 'cut') throw new Error('unexpected shape');
    cutFeature.rip = rip;
    const out = runPipeline(timeline);
    return {
      compose: out.results['compose-0'] as ComposeStripsResult,
      arrange: out.results['arrange-0'] as ArrangeResult,
      cut: out.results['cut-0'] as CutResult,
    };
  }

  it(`produces ${expectedCount} inner slices per safe-extent formula`, () => {
    const { cut } = runAtRip();
    expect(cut.slices.length).toBe(expectedCount);
  });

  it('identity arrange preserves full X width', () => {
    const { compose, arrange } = runAtRip();
    const inputX = compose.panel.bbox.max[0] - compose.panel.bbox.min[0];
    const outputX = arrange.panel.bbox.max[0] - arrange.panel.bbox.min[0];
    expect(outputX).toBeCloseTo(inputX, 2);
  });

  it('output Z extent matches (count*pitch + panelX*sinθ)/cosθ', () => {
    const { compose, arrange } = runAtRip();
    const panelX = compose.panel.bbox.max[0] - compose.panel.bbox.min[0];
    const ripRad = (rip * Math.PI) / 180;
    // pitch = 50 from default timeline
    const pitch = 50;
    const expectedZ =
      (expectedCount * pitch + panelX * Math.sin(ripRad)) / Math.cos(ripRad);
    const outputZ = arrange.panel.bbox.max[2] - arrange.panel.bbox.min[2];
    expect(outputZ).toBeCloseTo(expectedZ, 1);
  });

  it('output bbox fits within input bbox (no overflow from identity reassembly)', () => {
    const { compose, arrange } = runAtRip();
    const eps = 0.5;
    expect(arrange.panel.bbox.min[0]).toBeGreaterThanOrEqual(compose.panel.bbox.min[0] - eps);
    expect(arrange.panel.bbox.max[0]).toBeLessThanOrEqual(compose.panel.bbox.max[0] + eps);
    expect(arrange.panel.bbox.min[2]).toBeGreaterThanOrEqual(compose.panel.bbox.min[2] - eps);
    expect(arrange.panel.bbox.max[2]).toBeLessThanOrEqual(compose.panel.bbox.max[2] + eps);
  });

  it('output bbox is centered (symmetric about origin)', () => {
    const { arrange } = runAtRip();
    expect(arrange.panel.bbox.min[0] + arrange.panel.bbox.max[0]).toBeCloseTo(0, 2);
    expect(arrange.panel.bbox.min[2] + arrange.panel.bbox.max[2]).toBeCloseTo(0, 2);
  });

  it('every slice has topFace polygon with 3+ points (no degenerate slices)', () => {
    const { cut } = runAtRip();
    for (const slice of cut.slices) {
      for (const v of slice.volumes) {
        expect(v.topFace.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mitred cut — rip=30° identity arrange. The pipeline discards partial
// triangular end slices (planes that don't pass fully across the panel's
// X width), so the output bbox is strictly inside the input bbox: full
// width, reduced Z.
// ---------------------------------------------------------------------------

describe('runPipeline — mitred cut (rip=30°) discards partial slices', () => {
  it('retains full-width slices only; output Z extent matches the safe-extent formula', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('unexpected timeline shape');
    cut.rip = 30;

    const out = runPipeline(timeline);
    const compose = out.results['compose-0'] as ComposeStripsResult;
    const arrange = out.results['arrange-0'] as ArrangeResult;

    const panelX = compose.panel.bbox.max[0] - compose.panel.bbox.min[0];
    const panelZ = compose.panel.bbox.max[2] - compose.panel.bbox.min[2];
    const rip = 30;
    const ripRad = (rip * Math.PI) / 180;

    // Safe-extent formula from executeCut: planes only produce full
    // slices within this range of offsets.
    const safeExtent = panelZ * Math.cos(ripRad) - panelX * Math.sin(ripRad);
    const count = Math.floor(safeExtent / cut.pitch);
    expect(count).toBe(5); // 100×400 at rip=30, pitch=50

    // Output Z extent derives from the outermost plane positions
    // projected through the panel width: (count*pitch + panelX*sinθ)/cosθ.
    const expectedZExtent =
      (count * cut.pitch + panelX * Math.sin(ripRad)) / Math.cos(ripRad);
    const arrangeZExtent = arrange.panel.bbox.max[2] - arrange.panel.bbox.min[2];
    expect(arrangeZExtent).toBeCloseTo(expectedZExtent, 1);

    // Full width preserved (cuts only trim along the cut-normal).
    expect(arrange.panel.bbox.max[0] - arrange.panel.bbox.min[0]).toBeCloseTo(panelX, 3);

    // Output bbox sits strictly inside the input bbox (some material
    // was discarded as triangular offcuts).
    expect(arrangeZExtent).toBeLessThan(panelZ);
  });
});

// ---------------------------------------------------------------------------
// Bevel sweep — rip=0°, pitch=50 on the default 100×50×400 panel.
//
// Safe-extent formula from executeCut with α = 90° − bevel:
//   safe = cos α · (Lz·|cos θ| − Lx·|sin θ|) − Ly·|sin α|
// At rip=0 this reduces to: safe = cos α · Lz − Ly · sin α.
//
// Output Z extent of the (identity) Arrange:
//   zExtent = (count · pitch + sin α · Ly) / cos α
// — the outermost plane offsets project across the panel's Y dimension
// with a sin α · Ly shift, then scale by 1/cos α to convert from
// along-normal distance to along-Z distance.
// ---------------------------------------------------------------------------

describe.each([
  { bevel: 90, expectedCount: 8 },  // α=0  → safe = 400
  { bevel: 75, expectedCount: 7 },  // α=15 → safe ≈ 373.4
  { bevel: 60, expectedCount: 6 },  // α=30 → safe ≈ 321.4
  { bevel: 45, expectedCount: 4 },  // α=45 → safe ≈ 247.5
])('runPipeline — bevel=$bevel° (rip=0) on default 100×50×400 panel', ({ bevel, expectedCount }) => {
  function runAtBevel(): {
    compose: ComposeStripsResult;
    arrange: ArrangeResult;
    cut: CutResult;
  } {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cutFeature = timeline[1];
    if (cutFeature.kind !== 'cut') throw new Error('unexpected shape');
    cutFeature.bevel = bevel;
    const out = runPipeline(timeline);
    return {
      compose: out.results['compose-0'] as ComposeStripsResult,
      arrange: out.results['arrange-0'] as ArrangeResult,
      cut: out.results['cut-0'] as CutResult,
    };
  }

  it(`produces ${expectedCount} inner slices per safe-extent formula`, () => {
    const { cut } = runAtBevel();
    expect(cut.slices.length).toBe(expectedCount);
  });

  it('identity arrange preserves full X width', () => {
    const { compose, arrange } = runAtBevel();
    const inputX = compose.panel.bbox.max[0] - compose.panel.bbox.min[0];
    const outputX = arrange.panel.bbox.max[0] - arrange.panel.bbox.min[0];
    expect(outputX).toBeCloseTo(inputX, 2);
  });

  it('output Z extent matches (count*pitch + sinα*Ly)/cosα', () => {
    const { compose, arrange } = runAtBevel();
    const Ly = compose.panel.bbox.max[1] - compose.panel.bbox.min[1];
    const alphaRad = ((90 - bevel) * Math.PI) / 180;
    const pitch = 50;
    const expectedZ =
      (expectedCount * pitch + Math.sin(alphaRad) * Ly) / Math.cos(alphaRad);
    const outputZ = arrange.panel.bbox.max[2] - arrange.panel.bbox.min[2];
    expect(outputZ).toBeCloseTo(expectedZ, 1);
  });

  it('output bbox is centred (symmetric about origin)', () => {
    const { arrange } = runAtBevel();
    expect(arrange.panel.bbox.min[0] + arrange.panel.bbox.max[0]).toBeCloseTo(0, 2);
    expect(arrange.panel.bbox.min[2] + arrange.panel.bbox.max[2]).toBeCloseTo(0, 2);
  });

  it('panel thickness (Y) is preserved through the cut', () => {
    const { compose, arrange } = runAtBevel();
    const inputY = compose.panel.bbox.max[1] - compose.panel.bbox.min[1];
    const outputY = arrange.panel.bbox.max[1] - arrange.panel.bbox.min[1];
    expect(outputY).toBeCloseTo(inputY, 2);
  });

  it('every slice has topFace polygon with 3+ points', () => {
    const { cut } = runAtBevel();
    for (const slice of cut.slices) {
      for (const v of slice.volumes) {
        expect(v.topFace.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('slice Z extent matches (pitch + sinα*Ly)/cosα (bevelled trapezoidal prism)', () => {
    const { compose, cut } = runAtBevel();
    const Ly = compose.panel.bbox.max[1] - compose.panel.bbox.min[1];
    const alphaRad = ((90 - bevel) * Math.PI) / 180;
    const pitch = 50;
    const expectedZ = (pitch + Math.sin(alphaRad) * Ly) / Math.cos(alphaRad);
    // Look at the first slice — all slices share the same Z extent
    // (identical shapes, just translated along the cut-normal).
    if (cut.slices.length > 0) {
      const sliceZ =
        cut.slices[0].bbox.max[2] - cut.slices[0].bbox.min[2];
      expect(sliceZ).toBeCloseTo(expectedZ, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Slice-count mode sweep — the alternative density driver. User specifies
// N slices, the pipeline derives pitch = safeExtent / N so the slices
// distribute evenly. Parallel to the pitch-mode sweep above.
// ---------------------------------------------------------------------------

describe.each([
  { slices: 4, expectedPitch: 100 },  // 400 / 4
  { slices: 8, expectedPitch: 50 },   // 400 / 8 (matches default)
  { slices: 10, expectedPitch: 40 },  // 400 / 10
  { slices: 16, expectedPitch: 25 },  // 400 / 16
])('runPipeline — spacingMode=slices, slices=$slices on default 100×50×400 panel', ({ slices, expectedPitch }) => {
  function runAtSliceCount(): {
    compose: ComposeStripsResult;
    arrange: ArrangeResult;
    cut: CutResult;
  } {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cutFeature = timeline[1];
    if (cutFeature.kind !== 'cut') throw new Error('unexpected shape');
    cutFeature.spacingMode = 'slices';
    cutFeature.slices = slices;
    const out = runPipeline(timeline);
    return {
      compose: out.results['compose-0'] as ComposeStripsResult,
      arrange: out.results['arrange-0'] as ArrangeResult,
      cut: out.results['cut-0'] as CutResult,
    };
  }

  it(`produces exactly ${slices} slices`, () => {
    const { cut } = runAtSliceCount();
    expect(cut.slices.length).toBe(slices);
  });

  it(`derives pitch = ${expectedPitch} mm (safeExtent/slices)`, () => {
    const { cut } = runAtSliceCount();
    // Each slice's Z extent (at bevel=90, rip=0) equals the derived
    // pitch — single-cut slices are axis-aligned prisms.
    if (cut.slices.length > 0) {
      const sliceZ =
        cut.slices[0].bbox.max[2] - cut.slices[0].bbox.min[2];
      expect(sliceZ).toBeCloseTo(expectedPitch, 1);
    }
  });

  it('identity arrange preserves full X width', () => {
    const { compose, arrange } = runAtSliceCount();
    const inputX = compose.panel.bbox.max[0] - compose.panel.bbox.min[0];
    const outputX = arrange.panel.bbox.max[0] - arrange.panel.bbox.min[0];
    expect(outputX).toBeCloseTo(inputX, 2);
  });
});

describe('runPipeline — spacingMode switches independently', () => {
  it('pitch-mode ignores the slices field', () => {
    const timeline = defaultTimeline(createIdCounter());
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('bad shape');
    cut.spacingMode = 'pitch';
    cut.pitch = 50;
    cut.slices = 999; // should be ignored
    const out = runPipeline(timeline);
    expect((out.results['cut-0'] as CutResult).slices.length).toBe(8);
  });

  it('slices-mode ignores the pitch field', () => {
    const timeline = defaultTimeline(createIdCounter());
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('bad shape');
    cut.spacingMode = 'slices';
    cut.pitch = 9999; // should be ignored
    cut.slices = 5;
    const out = runPipeline(timeline);
    expect((out.results['cut-0'] as CutResult).slices.length).toBe(5);
  });
});

describe('runPipeline — liveCutSlices surfaced under preserveLive', () => {
  it('populates liveCutSlices for each Cut with one Panel per slice', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline, { preserveLive: true });
    expect(out.liveCutSlices).toBeDefined();
    const cutSlices = out.liveCutSlices!['cut-0'];
    expect(cutSlices).toBeDefined();
    const snap = (out.results['cut-0'] as CutResult).slices;
    expect(cutSlices.length).toBe(snap.length);
    // Clean up — caller owns these.
    for (const p of cutSlices) p.dispose();
    if (out.livePanels) {
      for (const p of Object.values(out.livePanels)) p.dispose();
    }
  });

  it('omits liveCutSlices without preserveLive', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    expect(out.liveCutSlices).toBeUndefined();
  });

  it('live slices at bevel=60° carry bevel-tilted manifold (Z extent > pitch)', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('unexpected timeline shape');
    cut.bevel = 60;
    const out = runPipeline(timeline, { preserveLive: true });
    const slices = out.liveCutSlices!['cut-0'];
    const firstBbox = slices[0].boundingBox();
    const zExtent = firstBbox.max.z - firstBbox.min.z;
    // At bevel=60 (α=30), pitch=50, Ly=50:
    //   zExtent = (50 + sin30·50)/cos30 = 75/0.866 ≈ 86.6
    expect(zExtent).toBeCloseTo(86.6, 0);
    for (const p of slices) p.dispose();
    if (out.livePanels) {
      for (const p of Object.values(out.livePanels)) p.dispose();
    }
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
      spacingMode: 'pitch',
      pitch: 25,
      slices: 16,
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
      spacingMode: 'pitch',
      pitch: 50,
      slices: 8,
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
        spacingMode: 'pitch',
        pitch: 50,
        slices: 8,
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

// ---------------------------------------------------------------------------
// TrimPanel — flush / rectangle / bbox modes on various upstream panels.
// ---------------------------------------------------------------------------

/** Append a TrimPanel to the default timeline and return the full pipeline output. */
function runWithTrim(
  timelineMods: (t: Feature[], counter: ReturnType<typeof createIdCounter>) => void,
  trimMods: Partial<TrimPanel> & { mode: TrimPanel['mode'] },
) {
  const counter = createIdCounter();
  const timeline = defaultTimeline(counter);
  timelineMods(timeline, counter);
  const trim: TrimPanel = {
    kind: 'trimPanel',
    id: allocateId(counter, 'trim'),
    mode: trimMods.mode,
    bounds: trimMods.bounds,
    status: 'ok',
  };
  timeline.push(trim);
  const out = runPipeline(timeline);
  return { out, trim, timeline };
}

describe('runPipeline — TrimPanel (identity)', () => {
  it('flush on a rip=0 panel is a no-op (output bbox == input bbox)', () => {
    const { out, trim } = runWithTrim(() => {}, { mode: 'flush' });
    const arrange = out.results['arrange-0'] as ArrangeResult;
    const trimResult = out.results[trim.id] as TrimPanelResult;
    expect(trimResult.status).toBe('ok');
    // Compose + cut + arrange on defaults → 100 × 50 × 400 panel.
    // Flush trim should find the same bbox.
    for (const axis of [0, 2]) {
      expect(trimResult.panel.bbox.min[axis]).toBeCloseTo(arrange.panel.bbox.min[axis], 3);
      expect(trimResult.panel.bbox.max[axis]).toBeCloseTo(arrange.panel.bbox.max[axis], 3);
    }
    expect(trimResult.trimmedArea).toBeCloseTo(0, 3);
  });
});

describe('runPipeline — TrimPanel (flush at rip > 0)', () => {
  it('flush shrinks the Z bbox to sit inside the parallelogram outline', () => {
    const { out, trim } = runWithTrim(
      (t) => {
        const cut = t[1];
        if (cut.kind !== 'cut') throw new Error('bad timeline');
        cut.rip = 30;
        cut.spacingMode = 'slices';
        cut.slices = 4;
      },
      { mode: 'flush' },
    );
    const arrange = out.results['arrange-0'] as ArrangeResult;
    const trimResult = out.results[trim.id] as TrimPanelResult;
    expect(trimResult.status).toBe('ok');

    // At rip=30 the arrange output is a parallelogram spanning the
    // full 100mm X (slices still span the panel's X extent) but with
    // triangular overhangs at zMin / zMax. Flush trim removes those
    // triangles — the inscribed Z extent < arrange AABB Z extent.
    const arrangeZExtent = arrange.panel.bbox.max[2] - arrange.panel.bbox.min[2];
    const trimZExtent = trimResult.panel.bbox.max[2] - trimResult.panel.bbox.min[2];
    expect(trimZExtent).toBeLessThan(arrangeZExtent);
    expect(trimResult.trimmedArea).toBeGreaterThan(0);

    // X stays at panel width — the parallelogram's left + right edges
    // are both at x=+/-50 (just at different z).
    const arrangeXExtent = arrange.panel.bbox.max[0] - arrange.panel.bbox.min[0];
    const trimXExtent = trimResult.panel.bbox.max[0] - trimResult.panel.bbox.min[0];
    expect(trimXExtent).toBeCloseTo(arrangeXExtent, 3);

    // Applied bounds are within the upstream bbox.
    expect(trimResult.appliedBounds.zMin).toBeGreaterThanOrEqual(arrange.panel.bbox.min[2] - 1e-3);
    expect(trimResult.appliedBounds.zMax).toBeLessThanOrEqual(arrange.panel.bbox.max[2] + 1e-3);
  });
});

describe('runPipeline — TrimPanel (bbox mode)', () => {
  it('bbox clips panel to exact user-supplied bounds', () => {
    const { out, trim } = runWithTrim(() => {}, {
      mode: 'bbox',
      bounds: { xMin: -40, xMax: 40, zMin: -150, zMax: 150 },
    });
    const trimResult = out.results[trim.id] as TrimPanelResult;
    expect(trimResult.status).toBe('ok');
    expect(trimResult.appliedBounds).toEqual({ xMin: -40, xMax: 40, zMin: -150, zMax: 150 });
    expect(trimResult.panel.bbox.min[0]).toBeCloseTo(-40, 3);
    expect(trimResult.panel.bbox.max[0]).toBeCloseTo(40, 3);
    expect(trimResult.panel.bbox.min[2]).toBeCloseTo(-150, 3);
    expect(trimResult.panel.bbox.max[2]).toBeCloseTo(150, 3);
  });

  it('bbox with missing fields falls back to panel bbox on that axis', () => {
    const { out, trim } = runWithTrim(() => {}, {
      mode: 'bbox',
      bounds: { xMin: -40, xMax: 40 },
    });
    const arrange = out.results['arrange-0'] as ArrangeResult;
    const trimResult = out.results[trim.id] as TrimPanelResult;
    expect(trimResult.status).toBe('ok');
    // X trimmed to [-40, 40]; Z untouched.
    expect(trimResult.appliedBounds.xMin).toBeCloseTo(-40, 3);
    expect(trimResult.appliedBounds.xMax).toBeCloseTo(40, 3);
    expect(trimResult.appliedBounds.zMin).toBeCloseTo(arrange.panel.bbox.min[2], 3);
    expect(trimResult.appliedBounds.zMax).toBeCloseTo(arrange.panel.bbox.max[2], 3);
  });

  it('bbox outside panel bbox clamps to panel + sets status=warning', () => {
    // Panel is 100×50×400 centred on origin; xMax=50, request xMax=200.
    const { out, trim } = runWithTrim(() => {}, {
      mode: 'bbox',
      bounds: { xMin: -50, xMax: 200, zMin: -200, zMax: 200 },
    });
    const trimResult = out.results[trim.id] as TrimPanelResult;
    expect(trimResult.status).toBe('warning');
    expect(trimResult.statusReason).toMatch(/clamped/);
    // xMax should clamp to 50 (panel's xMax), zMax to 200 (== panel's zMax).
    expect(trimResult.appliedBounds.xMax).toBeCloseTo(50, 3);
    expect(trimResult.appliedBounds.zMax).toBeCloseTo(200, 3);
  });
});

describe('runPipeline — TrimPanel (rectangle mode at bevel != 90)', () => {
  it('rectangle mode at bevel=60 produces a non-empty trimmed panel', () => {
    // Bevel=60 makes top and bottom footprints differ; rectangle mode
    // must produce bounds inside both so trim cuts are square at every y.
    const { out, trim } = runWithTrim(
      (t) => {
        const cut = t[1];
        if (cut.kind !== 'cut') throw new Error('bad timeline');
        cut.bevel = 60;
        cut.spacingMode = 'slices';
        cut.slices = 4;
      },
      { mode: 'rectangle' },
    );
    const trimResult = out.results[trim.id] as TrimPanelResult;
    expect(trimResult.status).toBe('ok');
    expect(trimResult.panel.volumes.length).toBeGreaterThan(0);
    // Applied bounds should produce a non-degenerate rectangle.
    expect(trimResult.appliedBounds.xMax).toBeGreaterThan(trimResult.appliedBounds.xMin);
    expect(trimResult.appliedBounds.zMax).toBeGreaterThan(trimResult.appliedBounds.zMin);
  });
});

describe('runPipeline — TrimPanel feeds downstream features', () => {
  it('Cut after Trim sees the trimmed panel (not the pre-trim one)', () => {
    // Timeline: compose + cut + arrange + trim(bbox to 80×300) + cut again.
    // The second Cut's safe extent should be derived from the trimmed panel.
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    timeline.push({
      kind: 'trimPanel',
      id: allocateId(counter, 'trim'),
      mode: 'bbox',
      bounds: { xMin: -40, xMax: 40, zMin: -150, zMax: 150 },
      status: 'ok',
    });
    // Add a second cut after the trim. Pitch-driven so slice count
    // derives from the trimmed panel's Z extent (300 mm / 50 mm = 6).
    timeline.push({
      kind: 'cut',
      id: allocateId(counter, 'cut'),
      rip: 0,
      bevel: 90,
      spacingMode: 'pitch',
      pitch: 50,
      slices: 6,
      showOffcuts: false,
      status: 'ok',
    });
    const out = runPipeline(timeline);
    const trimResult = out.results['trim-0'] as TrimPanelResult;
    const secondCut = out.results['cut-1'] as CutResult;
    expect(trimResult.status).toBe('ok');
    expect(secondCut.status).toBe('ok');
    // trimmed Z extent = 300, pitch = 50 → 6 slices.
    expect(secondCut.slices).toHaveLength(6);
    // Each slice's X extent should match trimmed panel (80 mm).
    for (const s of secondCut.slices) {
      const xExtent = s.bbox.max[0] - s.bbox.min[0];
      expect(xExtent).toBeCloseTo(80, 2);
    }
  });
});

describe('runPipeline — TrimPanel (multi-trim)', () => {
  it('two trims in sequence produce the second trim\'s bounds', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    timeline.push({
      kind: 'trimPanel',
      id: allocateId(counter, 'trim'),
      mode: 'bbox',
      bounds: { xMin: -50, xMax: 50, zMin: -200, zMax: 200 },
      status: 'ok',
    });
    timeline.push({
      kind: 'trimPanel',
      id: allocateId(counter, 'trim'),
      mode: 'bbox',
      bounds: { xMin: -30, xMax: 30, zMin: -100, zMax: 100 },
      status: 'ok',
    });
    const out = runPipeline(timeline);
    const second = out.results['trim-1'] as TrimPanelResult;
    expect(second.status).toBe('ok');
    expect(second.appliedBounds).toEqual({ xMin: -30, xMax: 30, zMin: -100, zMax: 100 });
    expect(second.panel.bbox.min[0]).toBeCloseTo(-30, 3);
    expect(second.panel.bbox.max[0]).toBeCloseTo(30, 3);
  });
});

describe('runPipeline — TrimPanel (malformed)', () => {
  it('trimPanel without upstream panel produces status=error', () => {
    const timeline: Feature[] = [
      {
        kind: 'trimPanel',
        id: 'trim-0',
        mode: 'flush',
        status: 'ok',
      },
    ];
    const out = runPipeline(timeline);
    const r = out.results['trim-0'];
    expect(r.status).toBe('error');
    expect(r.statusReason).toMatch(/without upstream/);
  });
});

// ---------------------------------------------------------------------------
// ComposeStrips parameter sweep — locks in the harness's core invariant:
// the output panel's X extent is the sum of strip widths, for any strip
// count / species mix / dimensions. If the harness reorders strips, the
// resulting panel's X extent is unchanged.
// ---------------------------------------------------------------------------

describe('runPipeline — ComposeStrips parameter sweep', () => {
  type Case = {
    label: string;
    strips: Array<{ species: 'maple' | 'walnut' | 'cherry' | 'padauk' | 'purpleheart'; width: number }>;
    stripHeight: number;
    stripLength: number;
  };

  const cases: Case[] = [
    {
      label: '14 strips (7 maple + 7 walnut) — default harness seed',
      strips: [
        ...Array(7).fill({ species: 'maple' as const, width: 50 }),
        ...Array(7).fill({ species: 'walnut' as const, width: 50 }),
      ],
      stripHeight: 50,
      stripLength: 400,
    },
    {
      label: '3 strips (all species)',
      strips: [
        { species: 'cherry', width: 30 },
        { species: 'padauk', width: 40 },
        { species: 'purpleheart', width: 20 },
      ],
      stripHeight: 50,
      stripLength: 400,
    },
    {
      label: 'single strip (lower bound)',
      strips: [{ species: 'maple', width: 25 }],
      stripHeight: 10,
      stripLength: 100,
    },
    {
      label: '64 strips (upper bound — harness MAX_STRIPS)',
      strips: Array.from({ length: 64 }, (_, i) => ({
        species: (i % 2 === 0 ? 'maple' : 'walnut') as 'maple' | 'walnut',
        width: 10,
      })),
      stripHeight: 50,
      stripLength: 200,
    },
    {
      label: 'mixed widths',
      strips: [
        { species: 'maple', width: 80 },
        { species: 'walnut', width: 15 },
        { species: 'cherry', width: 60 },
        { species: 'padauk', width: 25 },
      ],
      stripHeight: 40,
      stripLength: 300,
    },
  ];

  describe.each(cases)('$label', (c) => {
    it('panel width equals sum of strip widths', () => {
      const counter = createIdCounter();
      const strips = c.strips.map((s) => ({
        stripId: allocateId(counter, 'strip'),
        species: s.species,
        width: s.width,
      }));
      allocateId(counter, 'compose');
      const compose: ComposeStrips = {
        kind: 'composeStrips',
        id: 'compose-0',
        strips,
        stripHeight: c.stripHeight,
        stripLength: c.stripLength,
        status: 'ok',
      };
      const out = runPipeline([compose]);
      const r = out.results['compose-0'] as ComposeStripsResult;
      expect(r.status).toBe('ok');
      const expectedWidth = c.strips.reduce((s, st) => s + st.width, 0);
      const actualWidth = r.panel.bbox.max[0] - r.panel.bbox.min[0];
      expect(actualWidth).toBeCloseTo(expectedWidth, 4);
      expect(r.panel.volumes).toHaveLength(c.strips.length);
    });

    it('reordering strips preserves panel width', () => {
      const counter = createIdCounter();
      const strips = c.strips.map((s) => ({
        stripId: allocateId(counter, 'strip'),
        species: s.species,
        width: s.width,
      }));
      allocateId(counter, 'compose');
      // Reverse — the harness's `order` layer feeds into ComposeStrips
      // with an already-reordered `strips` array, so we test that the
      // executor produces the same total X extent regardless of order.
      const reversed = [...strips].reverse();
      const compose: ComposeStrips = {
        kind: 'composeStrips',
        id: 'compose-0',
        strips: reversed,
        stripHeight: c.stripHeight,
        stripLength: c.stripLength,
        status: 'ok',
      };
      const out = runPipeline([compose]);
      const r = out.results['compose-0'] as ComposeStripsResult;
      const expectedWidth = c.strips.reduce((s, st) => s + st.width, 0);
      const actualWidth = r.panel.bbox.max[0] - r.panel.bbox.min[0];
      expect(actualWidth).toBeCloseTo(expectedWidth, 4);
      // And the volumes order reflects the reversed input.
      expect(r.panel.volumes.map((v) => v.species)).toEqual(
        reversed.map((s) => s.species),
      );
    });

    it('Y extent equals stripHeight, Z extent equals stripLength', () => {
      const counter = createIdCounter();
      const strips = c.strips.map((s) => ({
        stripId: allocateId(counter, 'strip'),
        species: s.species,
        width: s.width,
      }));
      allocateId(counter, 'compose');
      const compose: ComposeStrips = {
        kind: 'composeStrips',
        id: 'compose-0',
        strips,
        stripHeight: c.stripHeight,
        stripLength: c.stripLength,
        status: 'ok',
      };
      const out = runPipeline([compose]);
      const r = out.results['compose-0'] as ComposeStripsResult;
      const y = r.panel.bbox.max[1] - r.panel.bbox.min[1];
      const z = r.panel.bbox.max[2] - r.panel.bbox.min[2];
      expect(y).toBeCloseTo(c.stripHeight, 4);
      expect(z).toBeCloseTo(c.stripLength, 4);
    });
  });
});
