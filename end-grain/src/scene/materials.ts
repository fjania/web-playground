import {
  CanvasTexture,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';

function makeEndGrainTex(base: string, ring: string): CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, s, s);
  for (let i = 12; i >= 1; i--) {
    x.beginPath();
    x.arc(s * 0.48, s * 0.52, (i / 12) * s * 0.45, 0, Math.PI * 2);
    x.strokeStyle = ring;
    x.lineWidth = 1.2;
    x.globalAlpha = 0.25 + (i / 12) * 0.15;
    x.stroke();
  }
  x.globalAlpha = 1;
  return new CanvasTexture(c);
}

function makeSideMat(base: string, grain: string): MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 30; i++) {
    const px = Math.random() * 256;
    x.beginPath();
    x.moveTo(px, 0);
    for (let y = 0; y < 256; y += 10) {
      x.lineTo(px + (Math.random() - 0.5) * 4, y);
    }
    x.strokeStyle = grain;
    x.lineWidth = 0.8 + Math.random();
    x.globalAlpha = 0.1 + Math.random() * 0.15;
    x.stroke();
  }
  return new MeshStandardMaterial({ map: new CanvasTexture(c), roughness: 0.65 });
}

/**
 * Build a 6-material array suitable for a box: [side, side, end, end, side, side].
 * The end-grain texture goes on the ±Y faces; side grain wraps the rest.
 */
export function makeWoodMats(
  base: string,
  ring: string,
  grain: string,
): MeshStandardMaterial[] {
  const e = new MeshStandardMaterial({
    map: makeEndGrainTex(base, ring),
    roughness: 0.7,
  });
  const s = makeSideMat(base, grain);
  return [s, s, e, e, s, s];
}

export const SPECIES_DEFS: Record<string, MeshStandardMaterial[]> = {
  maple: makeWoodMats('#e4cc8f', '#b5a06a', '#c4aa70'),
  walnut: makeWoodMats('#3d2416', '#2a1a0e', '#4a2e1a'),
  cherry: makeWoodMats('#c97050', '#8a3018', '#a8503a'),
  padauk: makeWoodMats('#c84020', '#8a2010', '#a83018'),
  purpleheart: makeWoodMats('#5a2a6a', '#3a1545', '#4a2055'),
};

export const SPECIES_LIST: string[] = Object.keys(SPECIES_DEFS);

/** Hex swatch colors matching each species' base material (for UI chips). */
export const SPECIES_HEX: Record<string, string> = {
  maple: '#e4cc8f',
  walnut: '#3d2416',
  cherry: '#c97050',
  padauk: '#c84020',
  purpleheart: '#5a2a6a',
};

/** Map any material (side or end) back to its species name for hover lookup. */
export const matSpecies: Map<Material, string> = new Map();
for (const [name, mats] of Object.entries(SPECIES_DEFS)) {
  mats.forEach((m) => matSpecies.set(m, name));
}

/** Primary (side) material per species — used for normal panel rendering. */
export const speciesMaterials: Record<string, MeshStandardMaterial> = Object.fromEntries(
  SPECIES_LIST.map((name) => [name, SPECIES_DEFS[name][0]]),
);

/**
 * Semi-transparent variant per species — used to render offcut panels
 * dimly beside the kept slices.
 */
export const offcutMats: Record<string, MeshStandardMaterial> = {};
for (const sp of SPECIES_LIST) {
  const m = speciesMaterials[sp].clone();
  m.transparent = true;
  m.opacity = 0.25;
  m.depthWrite = false;
  m.flatShading = true;
  offcutMats[sp] = m;
}

/** Re-export DoubleSide + MeshBasicMaterial for highlights so callers keep one import. */
export { DoubleSide, MeshBasicMaterial };
