import { describe, it, expect } from 'vitest';
import {
  expandStrips, evaluate, finalFace, PRESETS,
  sum, buildDiagonalBands,
} from './evaluate.js';

// ─── expandStrips ───────────────────────────────────────────────────

describe('expandStrips', () => {
  it('tiles the unit by repeat count', () => {
    const strips = expandStrips({
      unit: [{ species: 'maple', width: 25 }, { species: 'walnut', width: 25 }],
      repeat: 3,
    });
    expect(strips).toHaveLength(6);
    expect(strips.map(s => s.species)).toEqual(['maple', 'walnut', 'maple', 'walnut', 'maple', 'walnut']);
  });

  it('appends tail after repeats', () => {
    const strips = expandStrips({
      unit: [{ species: 'maple', width: 50 }, { species: 'walnut', width: 6 }],
      repeat: 2,
      tail: [{ species: 'maple', width: 50 }],
    });
    expect(strips).toHaveLength(5);
    expect(strips[4].species).toBe('maple');
  });

  it('handles repeat=1 with no tail', () => {
    const strips = expandStrips({
      unit: [{ species: 'cherry', width: 30 }],
      repeat: 1,
    });
    expect(strips).toHaveLength(1);
  });
});

// ─── Individual operations via presets ───────────────────────────────

describe('checkerboard preset', () => {
  const snaps = evaluate(
    PRESETS.checkerboard.stripPattern,
    PRESETS.checkerboard.operations,
    PRESETS.checkerboard.stockThickness,
  );

  it('produces 6 snapshots (glueup, crosscut, stack, rotate, flip, glueup)', () => {
    expect(snaps).toHaveLength(6);
  });

  it('step 0 (glueup): panel with 8 vertical strip bands', () => {
    const ws = snaps[0].workState;
    expect(ws.kind).toBe('panel');
    expect(ws.workpiece.face.rects).toHaveLength(8);
    expect(ws.workpiece.grainDir).toBe('long-grain');
    expect(ws.workpiece.face.width).toBe(200);
  });

  it('step 1 (crosscut): 8 identical slices', () => {
    const ws = snaps[1].workState;
    expect(ws.kind).toBe('slices');
    expect(ws.slices).toHaveLength(8);
    expect(ws.slices[0].face.height).toBe(35);
  });

  it('step 2 (stack): slices arranged with direction', () => {
    const ws = snaps[2].workState;
    expect(ws.kind).toBe('slices');
    expect(ws.direction).toBe('vertical');
  });

  it('step 3 (rotate90): face height = stockThickness, grainDir = end-grain', () => {
    const ws = snaps[3].workState;
    expect(ws.slices[0].face.height).toBe(25);
    expect(ws.slices[0].grainDir).toBe('end-grain');
    expect(ws.slices[0].thickness).toBe(35);
  });

  it('step 4 (flipAlternate): odd slices have reversed species order by X position', () => {
    const ws = snaps[4].workState;
    const byX = rects => [...rects].sort((a, b) => a.x - b.x).map(r => r.species);
    const even = byX(ws.slices[0].face.rects);
    const odd = byX(ws.slices[1].face.rects);
    expect(even[0]).toBe('maple');
    expect(odd[0]).toBe('walnut');
  });

  it('final face: 200×200, 64 cells (8×8)', () => {
    const face = finalFace(snaps);
    expect(face.width).toBe(200);
    expect(face.height).toBe(200);
    expect(face.rects).toHaveLength(64);
  });

  it('final face has alternating species in a 2D checkerboard', () => {
    const face = finalFace(snaps);
    const cellAt = (col, row) => {
      const cellW = 25, cellH = 25;
      return face.rects.find(r =>
        Math.abs(r.x - col * cellW) < 1 && Math.abs(r.y - row * cellH) < 1
      );
    };
    expect(cellAt(0, 0).species).toBe('maple');
    expect(cellAt(1, 0).species).toBe('walnut');
    expect(cellAt(0, 1).species).toBe('walnut');
    expect(cellAt(1, 1).species).toBe('maple');
  });
});

describe('brick preset', () => {
  const snaps = evaluate(
    PRESETS.brick.stripPattern,
    PRESETS.brick.operations,
    PRESETS.brick.stockThickness,
  );

  it('produces 7 snapshots', () => {
    expect(snaps).toHaveLength(7);
  });

  it('step 0 (glueup): 9 strips (4 × [maple,walnut] + tail maple)', () => {
    const ws = snaps[0].workState;
    expect(ws.workpiece.face.rects).toHaveLength(9);
  });

  it('step 4 (shiftAlternate): odd slices have shifted rects', () => {
    const ws = snaps[4].workState;
    expect(ws.slices).toHaveLength(7);
    const even = ws.slices[0].face.rects;
    const odd = ws.slices[1].face.rects;
    // Shift wraps rects at the edge, splitting some → more rects
    expect(odd.length).toBeGreaterThan(even.length);
  });

  it('step 5 (insertStrips): 13 slices (7 originals + 6 mortar inserts)', () => {
    const ws = snaps[5].workState;
    expect(ws.slices).toHaveLength(13);
    // Mortar inserts are at odd indices now (between original slices)
    const insert = ws.slices[1];
    expect(insert.face.height).toBe(4);
    expect(insert.face.rects[0].species).toBe('walnut');
  });

  it('final face: 274×199, all rects inside bounds', () => {
    const face = finalFace(snaps);
    expect(face.width).toBe(274);
    expect(face.height).toBe(199);
    for (const r of face.rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.01);
      expect(r.x + r.w).toBeLessThanOrEqual(face.width + 0.01);
    }
  });

  it('final face has both maple (brick) and walnut (mortar)', () => {
    const face = finalFace(snaps);
    const species = new Set(face.rects.map(r => r.species));
    expect(species.has('maple')).toBe(true);
    expect(species.has('walnut')).toBe(true);
  });
});

describe('chevron preset', () => {
  const snaps = evaluate(
    PRESETS.chevron.stripPattern,
    PRESETS.chevron.operations,
    PRESETS.chevron.stockThickness,
  );

  it('produces 7 snapshots', () => {
    expect(snaps).toHaveLength(7);
  });

  it('step 1 (crosscut 45°): slices have polys clipped from the panel face', () => {
    const ws = snaps[1].workState;
    expect(ws.slices[0].face.polys.length).toBeGreaterThan(0);
    expect(ws.slices[0]._cutAngle).toBe(45);
    expect(ws.slices[0].grainDir).toBe('long-grain');
  });

  it('step 4 (flipAlternate): odd slices have reversed diagonal direction', () => {
    const ws = snaps[4].workState;
    const even = ws.slices[0].face.polys;
    const odd = ws.slices[1].face.polys;
    expect(even.length).toBeGreaterThan(0);
    expect(odd.length).toBeGreaterThan(0);
    // The polygon vertices should differ between even and odd slices
    const evenFirstPt = JSON.stringify(even[0].points);
    const oddFirstPt = JSON.stringify(odd[0].points);
    expect(evenFirstPt).not.toBe(oddFirstPt);
  });

  it('step 5 (glueup horizontal): assembles slices into a panel', () => {
    const ws = snaps[5].workState;
    expect(ws.kind).toBe('panel');
    expect(ws.workpiece.face.polys.length).toBeGreaterThan(0);
  });

  it('final face: has polys (diagonal bands), reasonable dimensions', () => {
    const face = finalFace(snaps);
    expect(face.polys.length).toBeGreaterThan(0);
    expect(face.width).toBeGreaterThan(100);
    expect(face.height).toBeGreaterThan(10);
  });

  it('final face has both walnut and maple species', () => {
    const face = finalFace(snaps);
    const species = new Set(face.polys.map(p => p.species));
    expect(species.has('walnut')).toBe(true);
    expect(species.has('maple')).toBe(true);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────

describe('operation validation', () => {
  it('throws on unknown operation type', () => {
    expect(() => evaluate(
      { unit: [{ species: 'maple', width: 25 }], repeat: 1 },
      [{ type: 'glueup' }, { type: 'bogus' }],
    )).toThrow('unknown operation');
  });

  it('throws if crosscut applied to slices', () => {
    expect(() => evaluate(
      { unit: [{ species: 'maple', width: 25 }], repeat: 2 },
      [
        { type: 'glueup' },
        { type: 'crosscut', angle: 0, sliceThickness: 25, sliceCount: 4 },
        { type: 'crosscut', angle: 0, sliceThickness: 10, sliceCount: 2 },
      ],
    )).toThrow('crosscut requires a panel');
  });
});

// ─── buildDiagonalBands helper ──────────────────────────────────────

describe('buildDiagonalBands', () => {
  it('produces non-empty polygons for a simple 2-strip pattern', () => {
    const strips = [
      { species: 'maple', width: 30 },
      { species: 'walnut', width: 30 },
    ];
    const polys = buildDiagonalBands(strips, 40, 60, false);
    expect(polys.length).toBeGreaterThan(0);
    for (const p of polys) {
      expect(p.points.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('flipped bands produce different geometry than non-flipped', () => {
    const strips = [{ species: 'maple', width: 20 }, { species: 'walnut', width: 20 }];
    const normal = buildDiagonalBands(strips, 40, 40, false);
    const flipped = buildDiagonalBands(strips, 40, 40, true);
    expect(JSON.stringify(normal)).not.toBe(JSON.stringify(flipped));
  });
});
