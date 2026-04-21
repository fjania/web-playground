/**
 * Tests for the operation-view renderers in src/render/operations.ts.
 *
 * These are snapshot-as-truth renderers — they read ArrangeResult /
 * CutResult / PanelSnapshot outputs and emit SVG overlays. The tests
 * run the real pipeline end-to-end and assert on the resulting SVG
 * (structural checks, not pixel diffs) so the renderer stays in
 * lockstep with whatever the pipeline actually produces.
 */

import { describe, it, expect } from 'vitest';
import './setup';

import { runPipeline } from '../src/state/pipeline';
import { defaultTimeline } from '../src/state/defaultTimeline';
import { createIdCounter, allocateId } from '../src/state/ids';
import {
  renderCutOperation,
  renderArrangeOperation,
  renderTrimOperation,
} from '../src/render/operations';
import type {
  ArrangeResult,
  CutResult,
  Feature,
  PlaceEdit,
  Preset,
  SpacerInsert,
  TrimPanel,
  TrimPanelResult,
} from '../src/state/types';

// ---------------------------------------------------------------------------
// renderCutOperation — derived from CutResult (snapshot-as-truth)
// ---------------------------------------------------------------------------

describe('renderCutOperation', () => {
  it('emits TOP and SIDE projections stacked in a flex row', () => {
    const timeline = defaultTimeline(createIdCounter());
    const out = runPipeline(timeline);
    const cut = out.results['cut-0'] as CutResult;
    const html = renderCutOperation(cut);
    expect(html).toMatch(/TOP/);
    expect(html).toMatch(/SIDE/);
    expect(html).toMatch(/<svg/);
    // Two SVGs — one per projection.
    expect((html.match(/<svg /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('draws one dashed cut line per (slice,slice) or (slice,offcut) pair in the TOP view', () => {
    const timeline = defaultTimeline(createIdCounter());
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('bad timeline');
    cut.spacingMode = 'slices';
    cut.slices = 4;
    // rip > 0 so offcuts exist (pipeline filters empty ones).
    cut.rip = 30;
    const out = runPipeline(timeline);
    const cutResult = out.results['cut-0'] as CutResult;
    const html = renderCutOperation(cutResult);
    // 4 slices + 2 offcuts = 5 adjacent-piece pairs = 5 cut lines per view,
    // × 2 views = 10 lines total in the emitted markup.
    const lineCount = (html.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// renderArrangeOperation — derived from ArrangeResult (snapshot-as-truth)
// ---------------------------------------------------------------------------

describe('renderArrangeOperation', () => {
  function runWith(mods: (timeline: Feature[], counter: ReturnType<typeof createIdCounter>) => void) {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('bad timeline');
    cut.spacingMode = 'slices';
    cut.slices = 4;
    cut.pitch = 100;
    mods(timeline, counter);
    const out = runPipeline(timeline);
    return {
      cutResult: out.results['cut-0'] as CutResult,
      arrangeResult: out.results['arrange-0'] as ArrangeResult,
      timeline,
      results: out.results,
    };
  }

  it('renders a valid SVG from identity arrange (no edits, no spacers)', () => {
    const { cutResult, arrangeResult } = runWith(() => {});
    const svg = renderArrangeOperation(cutResult, arrangeResult, [], []);
    expect(svg).toMatch(/<svg/);
    expect(svg).toMatch(/<\/svg>/);
    // No edit badges, no spacer hatch.
    expect(svg).not.toMatch(/spacer-hatch/);
    expect(svg).not.toMatch(/↻/);
  });

  it('places a ↻ glyph at each flipped slice', () => {
    const { cutResult, arrangeResult, timeline } = runWith((tl, counter) => {
      tl.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId: 'arrange-0', sliceIdx: 1 },
        op: { kind: 'rotate', degrees: 180 },
        status: 'ok',
      });
      tl.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId: 'arrange-0', sliceIdx: 3 },
        op: { kind: 'rotate', degrees: 180 },
        status: 'ok',
      });
    });
    const edits = timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit');
    const svg = renderArrangeOperation(cutResult, arrangeResult, edits, []);
    // Two flip glyphs (one per flipped slice).
    const flipCount = (svg.match(/↻/g) ?? []).length;
    expect(flipCount).toBe(2);
  });

  it('labels rotate !== 180° edits with the angle', () => {
    const { cutResult, arrangeResult, timeline } = runWith((tl, counter) => {
      tl.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId: 'arrange-0', sliceIdx: 0 },
        op: { kind: 'rotate', degrees: 90 },
        status: 'ok',
      });
    });
    const edits = timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit');
    const svg = renderArrangeOperation(cutResult, arrangeResult, edits, []);
    expect(svg).toMatch(/↻90°/);
  });

  it('labels shift edits with signed magnitude', () => {
    const { cutResult, arrangeResult, timeline } = runWith((tl, counter) => {
      tl.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId: 'arrange-0', sliceIdx: 1 },
        op: { kind: 'shift', delta: 25 },
        status: 'ok',
      });
      tl.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId: 'arrange-0', sliceIdx: 2 },
        op: { kind: 'shift', delta: -10 },
        status: 'ok',
      });
    });
    const edits = timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit');
    const svg = renderArrangeOperation(cutResult, arrangeResult, edits, []);
    expect(svg).toMatch(/⇢ \+25/);
    expect(svg).toMatch(/⇢ -10/);
  });

  it('hatches spacer volumes (one overlay polygon per spacer segment)', () => {
    const { cutResult, arrangeResult, timeline } = runWith((tl, counter) => {
      tl.push({
        kind: 'spacerInsert',
        id: allocateId(counter, 'spacer'),
        arrangeId: 'arrange-0',
        afterSliceIdx: 1,
        species: 'walnut',
        width: 10,
        status: 'ok',
      });
    });
    const spacers = timeline.filter((f): f is SpacerInsert => f.kind === 'spacerInsert');
    const svg = renderArrangeOperation(cutResult, arrangeResult, [], spacers);
    expect(svg).toMatch(/arrange-op-spacer-hatch/);
    expect(svg).toMatch(/fill="url\(#arrange-op-spacer-hatch\)"/);
  });

  it('does not render badges for slices whose contributingSliceIds got filtered', () => {
    // Edits targeting slice indices that don't exist should be
    // silently ignored by the renderer (the pipeline already flags
    // them via status; the renderer is not the place to re-report).
    const { cutResult, arrangeResult, timeline } = runWith((tl, counter) => {
      tl.push({
        kind: 'placeEdit',
        id: allocateId(counter, 'edit'),
        target: { arrangeId: 'arrange-0', sliceIdx: 999 },
        op: { kind: 'rotate', degrees: 180 },
        status: 'ok',
      });
    });
    const edits = timeline.filter((f): f is PlaceEdit => f.kind === 'placeEdit');
    const svg = renderArrangeOperation(cutResult, arrangeResult, edits, []);
    // No badge rendered — the slice doesn't exist so its centroid
    // lookup fails and the renderer skips it.
    expect(svg).not.toMatch(/↻/);
  });

  it('integrates preset-expanded edits when harvested from PresetResult', () => {
    const { cutResult, arrangeResult, timeline, results } = runWith((tl, counter) => {
      const preset: Preset = {
        kind: 'preset',
        id: allocateId(counter, 'preset'),
        arrangeId: 'arrange-0',
        preset: 'flipAlternate',
        params: {},
        status: 'ok',
      };
      tl.push(preset);
    });
    const preset = timeline.find((f) => f.kind === 'preset');
    const presetResult = preset ? results[preset.id] : undefined;
    const presetEdits: PlaceEdit[] =
      presetResult && 'expandedPlaceEdits' in presetResult
        ? (presetResult as { expandedPlaceEdits: PlaceEdit[] }).expandedPlaceEdits
        : [];
    const svg = renderArrangeOperation(cutResult, arrangeResult, presetEdits, []);
    // flipAlternate on 4 slices → 2 flipped (indices 1, 3).
    const flipCount = (svg.match(/↻/g) ?? []).length;
    expect(flipCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// renderTrimOperation — derived from TrimPanelResult (snapshot-as-truth)
// ---------------------------------------------------------------------------

describe('renderTrimOperation', () => {
  function runWithTrim(trim: Partial<TrimPanel> & { mode: TrimPanel['mode'] }) {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const cut = timeline[1];
    if (cut.kind !== 'cut') throw new Error('bad timeline');
    cut.rip = 30;
    cut.spacingMode = 'slices';
    cut.slices = 4;
    const trimFeature: TrimPanel = {
      kind: 'trimPanel',
      id: allocateId(counter, 'trim'),
      mode: trim.mode,
      bounds: trim.bounds,
      status: 'ok',
    };
    timeline.push(trimFeature);
    const out = runPipeline(timeline);
    const arrangeResult = out.results['arrange-0'] as ArrangeResult;
    const trimResult = out.results[trimFeature.id] as TrimPanelResult;
    return { arrangeResult, trimResult };
  }

  it('emits an SVG with a dashed trim rect + a dimmed discard overlay', () => {
    const { arrangeResult, trimResult } = runWithTrim({ mode: 'flush' });
    const svg = renderTrimOperation(arrangeResult.panel, trimResult);
    expect(svg).toMatch(/<svg/);
    expect(svg).toMatch(/<\/svg>/);
    // Dashed stroke on the trim rect (matches the shared DASHED_STROKE pattern).
    expect(svg).toMatch(/stroke-dasharray="8 5"/);
    // Dimmed discard overlay via evenodd path.
    expect(svg).toMatch(/fill-rule="evenodd"/);
    expect(svg).toMatch(/#0000000d/);
  });

  it('trim rect width/height match the computed appliedBounds', () => {
    const { arrangeResult, trimResult } = runWithTrim({
      mode: 'bbox',
      bounds: { xMin: -80, xMax: 0, zMin: 50, zMax: 350 },
    });
    const svg = renderTrimOperation(arrangeResult.panel, trimResult);
    // Bench-anchored upstream panel (X ∈ [-100, 0], Z ∈ [0, 400]).
    // appliedBounds = (-80,50)→(0,350). Axis swap: SVG X=Z (extent 300),
    // SVG Y=X (extent 80); origin at (zMin, xMin) = (50, -80).
    expect(svg).toMatch(/<rect x="50" y="-80" width="300" height="80"/);
  });

  it('snapshot-is-truth: the rect is driven by appliedBounds, not input params', () => {
    // Render once with an explicit bbox request, once with a larger
    // request that will clamp. The rendered rect must match the
    // post-clamp appliedBounds in both cases (the renderer reads the
    // result, not the feature).
    const { arrangeResult: ar1, trimResult: tr1 } = runWithTrim({
      mode: 'bbox',
      bounds: { xMin: -40, xMax: 40 },
    });
    const { arrangeResult: ar2, trimResult: tr2 } = runWithTrim({
      mode: 'bbox',
      bounds: { xMin: -40, xMax: 40, zMin: -9999, zMax: 9999 },
    });
    const svg1 = renderTrimOperation(ar1.panel, tr1);
    const svg2 = renderTrimOperation(ar2.panel, tr2);
    // After clamping, tr2.appliedBounds.zMin/zMax match the arrange
    // panel's Z extent exactly — same as tr1 (which has no Z bounds
    // request, so also falls back to panel Z). So both SVGs should
    // emit identical trim-rect widths/heights.
    const rectMatch1 = svg1.match(/<rect[^/]*width="([\d.-]+)" height="([\d.-]+)"/);
    const rectMatch2 = svg2.match(/<rect[^/]*width="([\d.-]+)" height="([\d.-]+)"/);
    expect(rectMatch1).not.toBeNull();
    expect(rectMatch2).not.toBeNull();
    expect(rectMatch1?.[1]).toBe(rectMatch2?.[1]);
    expect(rectMatch1?.[2]).toBe(rectMatch2?.[2]);
  });

  it('identity trim (rip=0) produces a rect matching the panel bbox', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    // Leave rip at 0 (default). Add a flush trim — should be identity.
    const trim: TrimPanel = {
      kind: 'trimPanel',
      id: allocateId(counter, 'trim'),
      mode: 'flush',
      status: 'ok',
    };
    timeline.push(trim);
    const out = runPipeline(timeline);
    const arrangeResult = out.results['arrange-0'] as ArrangeResult;
    const trimResult = out.results[trim.id] as TrimPanelResult;
    const svg = renderTrimOperation(arrangeResult.panel, trimResult);
    // Bench-anchored: X ∈ [-100, 0], Z ∈ [0, 400]. Axis swap: SVG X=Z
    // (extent 400, origin 0), SVG Y=X (extent 100, origin -100).
    expect(svg).toMatch(/<rect x="0" y="-100" width="400" height="100"/);
  });
});
