import { describe, it, expect, expectTypeOf } from 'vitest';

import {
  allocateId,
  createIdCounter,
  peekNextId,
} from '../../src/v2/state/ids';
import { defaultTimeline } from '../../src/v2/state/defaultTimeline';
import type {
  ArrangeResult,
  ComposeStripsResult,
  CutResult,
  Feature,
  FeatureResult,
  PanelSnapshot,
  PlaceEdit,
  PlaceEditOp,
  PlaceEditResult,
  PlaceEditTarget,
  Preset,
  PresetResult,
  SpacerInsert,
  SpacerInsertResult,
  Status,
} from '../../src/v2/state/types';

// ---------------------------------------------------------------------------
// defaultTimeline()
// ---------------------------------------------------------------------------

describe('defaultTimeline', () => {
  it('returns [ComposeStrips, Cut, Arrange] with documented defaults', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);

    expect(timeline).toHaveLength(3);

    const [compose, cut, arrange] = timeline;

    // ComposeStrips
    expect(compose.kind).toBe('composeStrips');
    if (compose.kind !== 'composeStrips') throw new Error('narrowing');
    expect(compose.id).toBe('compose-0');
    expect(compose.stripHeight).toBe(50);
    expect(compose.stripLength).toBe(400);
    expect(compose.status).toBe('ok');
    expect(compose.strips).toHaveLength(2);
    expect(compose.strips[0]).toMatchObject({
      stripId: 'strip-0',
      species: 'maple',
      width: 50,
    });
    expect(compose.strips[1]).toMatchObject({
      stripId: 'strip-1',
      species: 'walnut',
      width: 50,
    });

    // Cut
    expect(cut.kind).toBe('cut');
    if (cut.kind !== 'cut') throw new Error('narrowing');
    expect(cut.id).toBe('cut-0');
    expect(cut.rip).toBe(0);
    expect(cut.bevel).toBe(90);
    expect(cut.pitch).toBe(50);
    expect(cut.showOffcuts).toBe(false);
    expect(cut.status).toBe('ok');

    // Arrange
    expect(arrange.kind).toBe('arrange');
    if (arrange.kind !== 'arrange') throw new Error('narrowing');
    expect(arrange.id).toBe('arrange-0');
    expect(arrange.layout).toBe('cursor-slide');
    expect(arrange.status).toBe('ok');
    expect((arrange as unknown as Record<string, unknown>).placements).toBeUndefined();
  });

  it('advances the shared counter so a second allocation gets strip-2', () => {
    const counter = createIdCounter();
    defaultTimeline(counter);
    expect(allocateId(counter, 'strip')).toBe('strip-2');
    expect(allocateId(counter, 'cut')).toBe('cut-1');
    expect(allocateId(counter, 'arrange')).toBe('arrange-1');
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip — the serialisability invariant
// ---------------------------------------------------------------------------

describe('JSON round-trip', () => {
  it('defaultTimeline roundtrips without loss', () => {
    const counter = createIdCounter();
    const timeline = defaultTimeline(counter);
    const roundtripped = JSON.parse(JSON.stringify(timeline));
    expect(roundtripped).toEqual(timeline);
  });

  it('counter roundtrips without loss', () => {
    const counter = createIdCounter();
    defaultTimeline(counter);
    allocateId(counter, 'edit');
    allocateId(counter, 'spacer');
    const roundtripped = JSON.parse(JSON.stringify(counter));
    expect(roundtripped).toEqual(counter);
  });

  it('roundtrips one of every Feature kind', () => {
    const samples: Feature[] = [
      {
        kind: 'composeStrips',
        id: 'compose-0',
        strips: [
          { stripId: 'strip-0', species: 'maple', width: 50 },
          { stripId: 'strip-1', species: 'walnut', width: 50 },
        ],
        stripHeight: 50,
        stripLength: 400,
        status: 'ok',
      },
      {
        kind: 'cut',
        id: 'cut-0',
        rip: 0,
        bevel: 90,
        spacingMode: 'pitch',
        pitch: 50,
        slices: 8,
        showOffcuts: false,
        status: 'warning',
        statusReason: 'pitch below kerf width',
      },
      {
        kind: 'arrange',
        id: 'arrange-0',
        layout: 'cursor-slide',
        status: 'ok',
      },
      {
        kind: 'placeEdit',
        id: 'edit-0',
        target: {
          arrangeId: 'arrange-0',
          sliceIdx: 3,
          contributingStripIds: ['strip-0', 'strip-1'],
        },
        op: { kind: 'rotate', degrees: 180 },
        status: 'ok',
      },
      {
        kind: 'preset',
        id: 'preset-0',
        arrangeId: 'arrange-0',
        preset: 'shiftAlternate',
        params: { shift: 25 },
        status: 'ok',
      },
      {
        kind: 'preset',
        id: 'preset-1',
        arrangeId: 'arrange-0',
        preset: 'spacerEveryRow',
        params: { species: 'walnut', width: 5 },
        status: 'ok',
      },
      {
        kind: 'spacerInsert',
        id: 'spacer-0',
        arrangeId: 'arrange-0',
        afterSliceIdx: 2,
        contributingStripIds: ['strip-0'],
        species: 'walnut',
        width: 5,
        status: 'ok',
      },
    ];

    for (const f of samples) {
      expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    }
  });

  it('roundtrips one of every FeatureResult kind', () => {
    const panel: PanelSnapshot = {
      bbox: { min: [0, 0, 0], max: [100, 50, 400] },
      volumes: [
        {
          species: 'maple',
          bbox: { min: [0, 0, 0], max: [50, 50, 400] },
          contributingStripIds: ['strip-0'],
          contributingSliceIds: [],
          topFace: [
            { x: 0, z: 0 },
            { x: 50, z: 0 },
            { x: 50, z: 400 },
            { x: 0, z: 400 },
          ],
          bottomFace: [
            { x: 0, z: 0 },
            { x: 50, z: 0 },
            { x: 50, z: 400 },
            { x: 0, z: 400 },
          ],
        },
        {
          species: 'walnut',
          bbox: { min: [50, 0, 0], max: [100, 50, 400] },
          contributingStripIds: ['strip-1'],
          contributingSliceIds: [],
          topFace: [
            { x: 50, z: 0 },
            { x: 100, z: 0 },
            { x: 100, z: 400 },
            { x: 50, z: 400 },
          ],
          bottomFace: [
            { x: 50, z: 0 },
            { x: 100, z: 0 },
            { x: 100, z: 400 },
            { x: 50, z: 400 },
          ],
        },
      ],
    };

    const samples: FeatureResult[] = [
      { featureId: 'compose-0', status: 'ok', panel } satisfies ComposeStripsResult,
      {
        featureId: 'cut-0',
        status: 'ok',
        slices: [panel, panel],
        offcuts: [],
        sliceProvenance: [
          { sliceIdx: 0, contributingStripIds: ['strip-0', 'strip-1'] },
          { sliceIdx: 1, contributingStripIds: ['strip-0', 'strip-1'] },
        ],
      } satisfies CutResult,
      {
        featureId: 'arrange-0',
        status: 'ok',
        panel,
        appliedEditCount: 1,
        appliedEditSources: ['preset-0'],
        appliedSpacerCount: 0,
        appliedSpacerSources: [],
      } satisfies ArrangeResult,
      {
        featureId: 'preset-0',
        status: 'ok',
        expandedPlaceEdits: [],
      } satisfies PresetResult,
      {
        featureId: 'preset-1',
        status: 'ok',
        expandedSpacers: [],
      } satisfies PresetResult,
      { featureId: 'edit-0', status: 'ok' } satisfies PlaceEditResult,
      { featureId: 'spacer-0', status: 'ok' } satisfies SpacerInsertResult,
    ];

    for (const r of samples) {
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });
});

// ---------------------------------------------------------------------------
// ID allocator
// ---------------------------------------------------------------------------

describe('allocateId', () => {
  it('produces strip-0..strip-99 monotonically for 100 sequential allocations', () => {
    const counter = createIdCounter();
    const ids = Array.from({ length: 100 }, () => allocateId(counter, 'strip'));
    for (let i = 0; i < 100; i++) {
      expect(ids[i]).toBe(`strip-${i}`);
    }
  });

  it('does not reuse ids after deletion', () => {
    const counter = createIdCounter();
    // Fake a timeline of 100 strips, delete #50 (simulated — the
    // allocator never sees deletions; the counter just keeps climbing).
    const allocated = Array.from({ length: 100 }, () =>
      allocateId(counter, 'strip'),
    );
    expect(allocated[50]).toBe('strip-50');

    const next = allocateId(counter, 'strip');
    expect(next).toBe('strip-100');
    expect(next).not.toBe('strip-50');
  });

  it('keeps per-prefix counters independent', () => {
    const counter = createIdCounter();
    expect(allocateId(counter, 'strip')).toBe('strip-0');
    expect(allocateId(counter, 'cut')).toBe('cut-0');
    expect(allocateId(counter, 'strip')).toBe('strip-1');
    expect(allocateId(counter, 'arrange')).toBe('arrange-0');
    expect(allocateId(counter, 'edit')).toBe('edit-0');
    expect(allocateId(counter, 'cut')).toBe('cut-1');
  });

  it('peekNextId does not bump the counter', () => {
    const counter = createIdCounter();
    expect(peekNextId(counter, 'strip')).toBe('strip-0');
    expect(peekNextId(counter, 'strip')).toBe('strip-0');
    expect(allocateId(counter, 'strip')).toBe('strip-0');
    expect(peekNextId(counter, 'strip')).toBe('strip-1');
  });
});

// ---------------------------------------------------------------------------
// Compile-time type checks — these don't "run" but fail the build
// if the discriminated unions ever drift.
// ---------------------------------------------------------------------------

describe('compile-time type shapes', () => {
  it('PlaceEditTarget accepts an optional contributingStripIds', () => {
    const withProv: PlaceEditTarget = {
      arrangeId: 'arrange-0',
      sliceIdx: 0,
      contributingStripIds: ['strip-0'],
    };
    const withoutProv: PlaceEditTarget = {
      arrangeId: 'arrange-0',
      sliceIdx: 0,
    };
    expect(withProv.contributingStripIds).toEqual(['strip-0']);
    expect(withoutProv.contributingStripIds).toBeUndefined();
  });

  it('PlaceEditOp covers reorder | rotate | shift', () => {
    const reorder: PlaceEditOp = { kind: 'reorder', newIdx: 2 };
    const rotate: PlaceEditOp = { kind: 'rotate', degrees: 90 };
    const shift: PlaceEditOp = { kind: 'shift', delta: 12.5 };
    expect([reorder.kind, rotate.kind, shift.kind]).toEqual([
      'reorder',
      'rotate',
      'shift',
    ]);
  });

  it('Preset variants type-check their params', () => {
    const flip: Preset = {
      kind: 'preset',
      id: 'preset-0',
      arrangeId: 'arrange-0',
      preset: 'flipAlternate',
      params: {},
      status: 'ok',
    };
    const rotate: Preset = {
      kind: 'preset',
      id: 'preset-1',
      arrangeId: 'arrange-0',
      preset: 'rotateAlternate',
      params: { degrees: 270 },
      status: 'ok',
    };
    const mirror: Preset = {
      kind: 'preset',
      id: 'preset-2',
      arrangeId: 'arrange-0',
      preset: 'mirrorAlternate',
      params: {},
      status: 'ok',
    };
    const rot4: Preset = {
      kind: 'preset',
      id: 'preset-3',
      arrangeId: 'arrange-0',
      preset: 'rotate4way',
      params: {},
      status: 'ok',
    };
    const shift: Preset = {
      kind: 'preset',
      id: 'preset-4',
      arrangeId: 'arrange-0',
      preset: 'shiftAlternate',
      params: { shift: 25 },
      status: 'ok',
    };
    const spacer: Preset = {
      kind: 'preset',
      id: 'preset-5',
      arrangeId: 'arrange-0',
      preset: 'spacerEveryRow',
      params: { species: 'walnut', width: 5 },
      status: 'ok',
    };

    // Narrowing on `preset` gives us the right params type.
    if (rotate.preset === 'rotateAlternate') {
      expectTypeOf(rotate.params.degrees).toEqualTypeOf<90 | 180 | 270>();
    }
    if (shift.preset === 'shiftAlternate') {
      expectTypeOf(shift.params.shift).toEqualTypeOf<number>();
    }
    if (spacer.preset === 'spacerEveryRow') {
      expectTypeOf(spacer.params.width).toEqualTypeOf<number>();
    }

    expect([flip, rotate, mirror, rot4, shift, spacer]).toHaveLength(6);
  });

  it('every Feature type carries a status field', () => {
    const counter = createIdCounter();
    for (const f of defaultTimeline(counter)) {
      const s: Status = f.status;
      expect(s).toBe('ok');
    }
  });

  it('SpacerInsert captures optional contributingStripIds', () => {
    const s: SpacerInsert = {
      kind: 'spacerInsert',
      id: 'spacer-0',
      arrangeId: 'arrange-0',
      afterSliceIdx: 3,
      species: 'walnut',
      width: 5,
      status: 'ok',
    };
    expect(s.contributingStripIds).toBeUndefined();

    const sProv: SpacerInsert = { ...s, contributingStripIds: ['strip-0'] };
    expect(sProv.contributingStripIds).toEqual(['strip-0']);
  });

  it('PlaceEdit type-checks end-to-end', () => {
    const edit: PlaceEdit = {
      kind: 'placeEdit',
      id: 'edit-0',
      target: { arrangeId: 'arrange-0', sliceIdx: 1 },
      op: { kind: 'rotate', degrees: 180 },
      status: 'ok',
    };
    expect(edit.kind).toBe('placeEdit');
  });
});
