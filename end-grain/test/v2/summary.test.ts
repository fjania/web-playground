import { describe, it, expect } from 'vitest';
import '../setup';

import { SPECIES_COLOURS, summarize } from '../../src/v2/render/summary';
import { runPipeline } from '../../src/v2/state/pipeline';
import { defaultTimeline } from '../../src/v2/state/defaultTimeline';
import { createIdCounter, allocateId } from '../../src/v2/state/ids';
import type {
  ArrangeResult,
  ComposeStrips,
  Feature,
  PanelSnapshot,
} from '../../src/v2/state/types';

// ---------------------------------------------------------------------------
// Helpers — build canonical pattern timelines and pull the arrange snapshot.
// ---------------------------------------------------------------------------

function finalPanel(timeline: Feature[]): PanelSnapshot {
  const out = runPipeline(timeline);
  const arrange = out.results['arrange-0'] as ArrangeResult;
  return arrange.panel;
}

/**
 * Count the number of volume-rendering shapes in the SVG. After v2.3a
 * was extended with topFace polygons, summary.ts emits <polygon> for
 * volumes with topFace data and falls back to <rect> only when
 * topFace is missing. Count both so structural assertions still
 * reflect "how many volumes got rendered."
 */
function countRects(svg: string): number {
  const rects = (svg.match(/<rect /g) ?? []).length;
  const polys = (svg.match(/<polygon /g) ?? []).length;
  return rects + polys;
}

function countFillOccurrences(svg: string, colour: string): number {
  return (svg.match(new RegExp(`fill="${colour}"`, 'g')) ?? []).length;
}

// ---------------------------------------------------------------------------
// Default panel — 2 strips, no cut, no edits.
//
// Actually the default timeline runs through Compose → Cut → Arrange-identity,
// producing a reassembled panel bbox-equal to the input.
// ---------------------------------------------------------------------------

describe('summarize — default timeline', () => {
  it('emits 16 rects (8 slices × 2 strips, concat-in-place identity)', () => {
    // The default timeline runs Compose → Cut(pitch=50) → Arrange(identity).
    // Cut produces 8 slices; each carries both strips as separate volumes
    // (cut doesn't collapse segments). Arrange-identity concats without
    // merging, so the final panel has 8 × 2 = 16 volumes.
    const snap = finalPanel(defaultTimeline(createIdCounter()));
    const svg = summarize(snap);
    expect(countRects(svg)).toBe(16);
    expect(countFillOccurrences(svg, SPECIES_COLOURS.maple)).toBe(8);
    expect(countFillOccurrences(svg, SPECIES_COLOURS.walnut)).toBe(8);
  });

  it('viewBox reflects the panel bbox (X=100, Z=400)', () => {
    const snap = finalPanel(defaultTimeline(createIdCounter()));
    const svg = summarize(snap);
    expect(svg).toMatch(/viewBox="-50 -200 100 400"/);
  });

  it('emits a data-species attribute for each volume', () => {
    const snap = finalPanel(defaultTimeline(createIdCounter()));
    const svg = summarize(snap);
    expect(svg).toMatch(/data-species="maple"/);
    expect(svg).toMatch(/data-species="walnut"/);
  });

  it('is a single self-contained SVG string (xmlns declared)', () => {
    const snap = finalPanel(defaultTimeline(createIdCounter()));
    const svg = summarize(snap);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('matches the stored snapshot', () => {
    const snap = finalPanel(defaultTimeline(createIdCounter()));
    expect(summarize(snap)).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Checkerboard — 8 strips (alternating maple/walnut 25mm each) + flipAlternate.
// ---------------------------------------------------------------------------

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

describe('summarize — checkerboard', () => {
  it('emits 64 rects (8×8 grid)', () => {
    const snap = finalPanel(checkerboardTimeline());
    const svg = summarize(snap);
    expect(countRects(svg)).toBe(64);
  });

  it('evenly split between maple and walnut', () => {
    const snap = finalPanel(checkerboardTimeline());
    const svg = summarize(snap);
    expect(countFillOccurrences(svg, SPECIES_COLOURS.maple)).toBe(32);
    expect(countFillOccurrences(svg, SPECIES_COLOURS.walnut)).toBe(32);
  });

  it('viewBox reflects the 200×200 reassembled panel', () => {
    const snap = finalPanel(checkerboardTimeline());
    const svg = summarize(snap);
    expect(svg).toMatch(/viewBox="-100 -100 200 200"/);
  });

  it('matches the stored snapshot', () => {
    const snap = finalPanel(checkerboardTimeline());
    expect(summarize(snap)).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Brick final — asymmetric compose + flipAlternate + spacerEveryRow.
// ---------------------------------------------------------------------------

function brickTimeline(): Feature[] {
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
    {
      kind: 'preset',
      id: allocateId(counter, 'preset'),
      arrangeId: 'arrange-0',
      preset: 'spacerEveryRow',
      params: { species: 'walnut', width: 5 },
      status: 'ok',
    },
  ];
}

describe('summarize — brick', () => {
  it('emits one rect per slice-strip volume plus one per mortar spacer', () => {
    // 7 strips × 8 slices = 56 slice-strip volumes. 7 mortar spacers = 7
    // spacer volumes. Total = 63.
    const snap = finalPanel(brickTimeline());
    const svg = summarize(snap);
    expect(countRects(svg)).toBe(63);
  });

  it('walnut fills = 3 per slice × 8 slices + 7 mortar = 31', () => {
    // Slices have 3 walnut strips (x=5mm mortar bits between maple);
    // mortar spacers add 7 more. Total walnut fills = 24 + 7 = 31.
    const snap = finalPanel(brickTimeline());
    const svg = summarize(snap);
    expect(countFillOccurrences(svg, SPECIES_COLOURS.walnut)).toBe(31);
  });

  it('Z extent = 400 (original) + 7×5 mortar = 435', () => {
    const snap = finalPanel(brickTimeline());
    const svg = summarize(snap);
    // Panel isn't re-centered when spacers extend it — min-Z stays
    // at the input's -200, extent grows to 435 (spacers pushed
    // slices along +Z).
    expect(svg).toMatch(/viewBox="-95 -200 190 435"/);
  });

  it('matches the stored snapshot', () => {
    const snap = finalPanel(brickTimeline());
    expect(summarize(snap)).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Mitred identity — rip=30°, no edits. Bbox-level sanity only;
// parallelogram fidelity is not provided by the bbox-only snapshot.
// ---------------------------------------------------------------------------

describe('summarize — mitred identity (rip=30°)', () => {
  it('emits one rect per upstream volume (bbox-level rendering)', () => {
    const counter = createIdCounter();
    const t = defaultTimeline(counter);
    const cut = t[1];
    if (cut.kind !== 'cut') throw new Error('narrow');
    cut.rip = 30;

    const snap = finalPanel(t);
    const svg = summarize(snap);
    // 2 strips × N slices → 2N volumes. The panel's concat-in-place
    // identity path preserves every upstream segment. Exact count
    // depends on slice count; assert non-empty.
    expect(countRects(svg)).toBeGreaterThan(0);
    expect(countRects(svg)).toBe(snap.volumes.length);
  });

  it('matches the stored snapshot (captures bbox-level approximation)', () => {
    const counter = createIdCounter();
    const t = defaultTimeline(counter);
    const cut = t[1];
    if (cut.kind !== 'cut') throw new Error('narrow');
    cut.rip = 30;
    expect(summarize(finalPanel(t))).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('summarize — edge cases', () => {
  it('handles an empty panel gracefully (zero rects)', () => {
    const svg = summarize({ bbox: { min: [0, 0, 0], max: [0, 0, 0] }, volumes: [] });
    expect(svg).toMatch(/viewBox="0 0 0 0"/);
    expect(countRects(svg)).toBe(0);
  });

  it('is deterministic — same snapshot yields identical string', () => {
    const snap = finalPanel(defaultTimeline(createIdCounter()));
    const a = summarize(snap);
    const b = summarize(snap);
    expect(a).toBe(b);
  });
});
