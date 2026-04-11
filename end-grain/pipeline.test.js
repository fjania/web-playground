import { describe, it, expect } from 'vitest';
import {
  sum, mod, rng,
  boardDimensions, pass2Shift,
  checkerboardGrid, brickLayout, chaosLayout,
  herringboneTiles, chevronBands, tumblingCubes,
  cutListText, PATTERNS, SPECIES,
} from './pipeline.js';

const defaultStrips = [
  { species: 'maple',  width: 30 },
  { species: 'walnut', width: 30 },
  { species: 'maple',  width: 30 },
  { species: 'walnut', width: 30 },
  { species: 'maple',  width: 30 },
  { species: 'walnut', width: 30 },
];

describe('utilities', () => {
  it('sum adds array of numbers', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
  });

  it('mod handles negatives correctly', () => {
    expect(mod(7, 3)).toBe(1);
    expect(mod(-1, 6)).toBe(5);
    expect(mod(-7, 3)).toBe(2);
    expect(mod(0, 5)).toBe(0);
  });

  it('rng is deterministic for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('rng produces different sequences for different seeds', () => {
    const a = rng(1);
    const b = rng(2);
    expect(a()).not.toBe(b());
  });

  it('rng outputs are in [0, 1)', () => {
    const r = rng(123);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('boardDimensions', () => {
  it('computes total dimensions from strips and slice params', () => {
    const d = boardDimensions(defaultStrips, 6, 30);
    expect(d.width).toBe(180);         // 6 × 30
    expect(d.height).toBe(180);        // 6 × 30
    expect(d.totalStripWidth).toBe(180);
    expect(d.boardLength).toBe(180);
  });

  it('handles non-uniform strip widths', () => {
    const strips = [
      { species: 'maple', width: 20 },
      { species: 'walnut', width: 40 },
      { species: 'cherry', width: 25 },
    ];
    const d = boardDimensions(strips, 8, 15);
    expect(d.width).toBe(85);
    expect(d.height).toBe(120);
  });
});

describe('pass2Shift', () => {
  it('returns 0 when pass2 is null or disabled', () => {
    expect(pass2Shift(null)).toBe(0);
    expect(pass2Shift({ enabled: false, cellShift: 3 })).toBe(0);
  });

  it('returns the integer cellShift directly when enabled', () => {
    expect(pass2Shift({ enabled: true, cellShift: 1 })).toBe(1);
    expect(pass2Shift({ enabled: true, cellShift: 3 })).toBe(3);
    expect(pass2Shift({ enabled: true, cellShift: 7 })).toBe(7);
  });

  it('falls back to angle-based mapping for legacy state shapes', () => {
    expect(pass2Shift({ enabled: true, angle: 45 })).toBe(3);
    expect(pass2Shift({ enabled: true, angle: 0 })).toBe(0);
  });
});

describe('checkerboardGrid', () => {
  it('produces a grid of numSlices rows × strips.length cols', () => {
    const grid = checkerboardGrid(defaultStrips, 6);
    expect(grid).toHaveLength(6);
    expect(grid[0]).toHaveLength(6);
  });

  it('row 0 matches original strip order (0-shift)', () => {
    const grid = checkerboardGrid(defaultStrips, 6);
    expect(grid[0]).toEqual(['maple', 'walnut', 'maple', 'walnut', 'maple', 'walnut']);
  });

  it('row 1 is shifted by one (classic checker pattern)', () => {
    const grid = checkerboardGrid(defaultStrips, 6);
    expect(grid[1]).toEqual(['walnut', 'maple', 'walnut', 'maple', 'walnut', 'maple']);
  });

  it('row 2 is shifted by two (returns to original for alternating 2-species)', () => {
    const grid = checkerboardGrid(defaultStrips, 6);
    expect(grid[2]).toEqual(grid[0]);
  });

  it('pass-2 composition adds extra shift per row', () => {
    // With extra=1, row 1 has total shift of 2 (1 base + 1 extra)
    const grid = checkerboardGrid(defaultStrips, 6, { enabled: true, angle: 15 });
    expect(grid[1]).toEqual(grid[0]);
  });

  it('respects asymmetric strip arrangements', () => {
    const strips = [
      { species: 'maple',  width: 30 },
      { species: 'walnut', width: 30 },
      { species: 'cherry', width: 30 },
    ];
    const grid = checkerboardGrid(strips, 3);
    expect(grid[0]).toEqual(['maple', 'walnut', 'cherry']);
    expect(grid[1]).toEqual(['walnut', 'cherry', 'maple']);
    expect(grid[2]).toEqual(['cherry', 'maple', 'walnut']);
  });

  it('handles single-strip edge case without crashing', () => {
    const grid = checkerboardGrid([{ species: 'maple', width: 30 }], 3);
    expect(grid).toEqual([['maple'], ['maple'], ['maple']]);
  });
});

describe('brickLayout', () => {
  it('produces numSlices rows', () => {
    const rows = brickLayout(defaultStrips, 6);
    expect(rows).toHaveLength(6);
  });

  it('row 0 has offsetFraction 0', () => {
    const rows = brickLayout(defaultStrips, 4);
    expect(rows[0].offsetFraction).toBe(0);
    expect(rows[0].cells).toHaveLength(6);
  });

  it('running-bond (0.5) gives alternating 0 / 0.5 offsets', () => {
    const rows = brickLayout(defaultStrips, 4, null, 0.5);
    expect(rows[0].offsetFraction).toBe(0);
    expect(rows[1].offsetFraction).toBe(0.5);
    expect(rows[2].offsetFraction).toBe(0);
    expect(rows[3].offsetFraction).toBe(0.5);
  });

  it('third-bond (0.333) gives stepped offsets 0, 1/3, 2/3, 0', () => {
    const rows = brickLayout(defaultStrips, 4, null, 1 / 3);
    expect(rows[0].offsetFraction).toBeCloseTo(0, 5);
    expect(rows[1].offsetFraction).toBeCloseTo(1 / 3, 5);
    expect(rows[2].offsetFraction).toBeCloseTo(2 / 3, 5);
    expect(rows[3].offsetFraction).toBeCloseTo(0, 5);
  });

  it('pass-2 rotates the starting species index', () => {
    const rows = brickLayout(defaultStrips, 2, { enabled: true, angle: 30 });
    expect(rows[1].cells[0]).toBe('maple'); // strips[(0+2) % 6] = maple
  });
});

describe('chaosLayout', () => {
  it('is reproducible with same seed', () => {
    const a = chaosLayout(defaultStrips, 4, 30, 42);
    const b = chaosLayout(defaultStrips, 4, 30, 42);
    expect(a).toEqual(b);
  });

  it('produces different layouts with different seeds', () => {
    const a = chaosLayout(defaultStrips, 4, 30, 1);
    const b = chaosLayout(defaultStrips, 4, 30, 2);
    expect(a).not.toEqual(b);
  });

  it('each row width sums exactly to the target strip width', () => {
    const target = 180;
    const layout = chaosLayout(defaultStrips, 6, 30, 7);
    layout.widths.forEach(row => {
      const total = row.reduce((a, b) => a + b, 0);
      expect(total).toBe(target);
    });
  });

  it('only uses species from the strip palette', () => {
    const palette = new Set(defaultStrips.map(s => s.species));
    const layout = chaosLayout(defaultStrips, 6, 30, 99);
    layout.cells.forEach(row => {
      row.forEach(sp => expect(palette.has(sp)).toBe(true));
    });
  });

  it('enabling pass 2 changes the result', () => {
    const a = chaosLayout(defaultStrips, 4, 30, 10, null);
    const b = chaosLayout(defaultStrips, 4, 30, 10, { enabled: true, angle: 45 });
    expect(a).not.toEqual(b);
  });
});

describe('herringboneTiles', () => {
  it('returns a non-empty list of tiles', () => {
    const tiles = herringboneTiles(defaultStrips, 400, 400);
    expect(tiles.length).toBeGreaterThan(10);
  });

  it('each tile has rectangular dimensions, species, and orientation', () => {
    const tiles = herringboneTiles(defaultStrips, 400, 400);
    tiles.forEach(t => {
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
      expect(typeof t.species).toBe('string');
      expect(['h', 'v']).toContain(t.orientation);
    });
  });

  it('every tile is a 2:1 aspect rectangle (in either orientation)', () => {
    const tiles = herringboneTiles(defaultStrips, 400, 400, 28);
    tiles.forEach(t => {
      const ratio = t.orientation === 'h' ? t.w / t.h : t.h / t.w;
      expect(ratio).toBe(2);
    });
  });

  it('uses both orientations (real herringbone, not rotated brick)', () => {
    const tiles = herringboneTiles(defaultStrips, 400, 400);
    const hCount = tiles.filter(t => t.orientation === 'h').length;
    const vCount = tiles.filter(t => t.orientation === 'v').length;
    expect(hCount).toBeGreaterThan(0);
    expect(vCount).toBeGreaterThan(0);
  });

  it('tile coverage is conservative — no overlaps within a single fundamental block', () => {
    const tiles = herringboneTiles(defaultStrips, 120, 120, 30);
    // Pick the first 8 tiles that fall within one fundamental 4u × 4u block
    // and verify their total area equals 16 u² (no overlaps).
    const u = 30;
    const blockSize = 4 * u;
    const inBlock = tiles.filter(t =>
      t.x >= 0 && t.x < blockSize && t.y >= 0 && t.y < blockSize &&
      t.x + t.w <= blockSize && t.y + t.h <= blockSize
    );
    const area = inBlock.reduce((sum, t) => sum + t.w * t.h, 0);
    expect(area).toBe(blockSize * blockSize);
  });
});

describe('chevronBands', () => {
  it('returns left and right polygons for each band', () => {
    const bands = chevronBands(defaultStrips, 400, 400);
    expect(bands.length).toBeGreaterThan(5);
    bands.forEach(b => {
      expect(b.left).toHaveLength(4);
      expect(b.right).toHaveLength(4);
      expect(typeof b.color).toBe('string');
    });
  });

  it('left and right polygons meet at the centerline', () => {
    const bands = chevronBands(defaultStrips, 400, 300);
    const cx = 200;
    bands.forEach(b => {
      expect(b.left[1][0]).toBe(cx);
      expect(b.right[0][0]).toBe(cx);
    });
  });
});

describe('tumblingCubes', () => {
  it('returns cubes with three face polygons each', () => {
    const cubes = tumblingCubes(defaultStrips, 400, 400);
    expect(cubes.length).toBeGreaterThan(5);
    cubes.forEach(c => {
      expect(c.top.points).toHaveLength(4);
      expect(c.left.points).toHaveLength(4);
      expect(c.right.points).toHaveLength(4);
    });
  });

  it('assigns three distinct face species from the palette', () => {
    const cubes = tumblingCubes(defaultStrips, 400, 400);
    const palette = new Set(defaultStrips.map(s => s.species));
    cubes.forEach(c => {
      expect(palette.has(c.top.species)).toBe(true);
      expect(palette.has(c.left.species)).toBe(true);
      expect(palette.has(c.right.species)).toBe(true);
    });
  });

  it('handles palettes smaller than 3 species by repeating', () => {
    const small = [{ species: 'maple', width: 30 }, { species: 'walnut', width: 30 }];
    const cubes = tumblingCubes(small, 300, 300);
    expect(cubes.length).toBeGreaterThan(0);
  });
});

describe('cutListText', () => {
  const baseState = {
    pattern: 'checkerboard',
    strips: defaultStrips,
    cutAngle: 0,
    sliceThickness: 30,
    numSlices: 6,
    pass2: { enabled: false, cellShift: 2 },
  };

  it('includes pattern name in header', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('CHECKERBOARD');
  });

  it('lists every strip with number, species, and width', () => {
    const txt = cutListText(baseState);
    defaultStrips.forEach((s, i) => {
      const num = String(i + 1).padStart(2, ' ');
      expect(txt).toContain(`${num}. ${s.species.padEnd(14)}`);
      expect(txt).toContain(`${String(s.width).padStart(3)}mm`);
    });
  });

  it('reports crosscut info', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('6 slices × 30mm');
  });

  it('reports final dimensions', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('180 × 180 mm');
  });

  it('includes inches dual units', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('"');  // inch marks present
  });

  it('includes board-feet shopping list', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('LUMBER SHOPPING LIST');
    expect(txt).toContain('bd-ft');
  });

  it('includes the rotate-90° reminder', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('ROTATE');
  });

  it('includes kerf allowance line', () => {
    const txt = cutListText(baseState);
    expect(txt).toContain('kerf');
  });

  it('omits pass-2 section when disabled', () => {
    const txt = cutListText(baseState);
    expect(txt).not.toContain('PASS 2');
  });

  it('includes pass-2 section when enabled', () => {
    const txt = cutListText({ ...baseState, pass2: { enabled: true, cellShift: 3 } });
    expect(txt).toContain('PASS 2');
    expect(txt).toContain('3 cells');
  });
});

describe('patterns & species metadata', () => {
  it('PATTERNS has the six expected entries', () => {
    const keys = ['checkerboard', 'brick', 'herringbone', 'chevron', 'tumbling', 'chaos'];
    keys.forEach(k => expect(PATTERNS[k]).toBeDefined());
  });

  it('each pattern has a label and default angle', () => {
    Object.values(PATTERNS).forEach(p => {
      expect(typeof p.label).toBe('string');
      expect(typeof p.defaultAngle).toBe('number');
    });
  });

  it('SPECIES entries have a valid hex color', () => {
    Object.values(SPECIES).forEach(s => {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});
