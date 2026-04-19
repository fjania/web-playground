export interface HoverInfo {
  species: string;
  volMm3: number;
  areaMm2: number;
  materials: number;
  normal: { x: number; y: number; z: number } | null;
  faceArea: number;
  sizeMm: { x: number; y: number; z: number };
  tris: number;
}

export const hoverState: { info: HoverInfo | null } = $state({ info: null });
