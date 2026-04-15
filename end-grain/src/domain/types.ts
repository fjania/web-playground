import type { Vector3 } from 'three';

export type Species = string;

export interface StripDef {
  species: Species;
  width: number;
}

export interface FaceSelection {
  normal: Vector3;
  centroid: Vector3;
  u: Vector3;
  v: Vector3;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  width: number;
  height: number;
  planeD: number;
  rotate: boolean;
}

export type NormalRelation = 'parallel' | 'antiparallel' | 'angled';

export type FlipAxis = 'x' | 'y' | 'z' | null;

export interface JoinCompat {
  ok: boolean;
  error: string;
  needsFlipAxis: boolean;
  validFlipAxes: Array<'x' | 'y' | 'z'>;
}

export type JoinStage =
  | {
      group: 'A' | 'B' | 'BOTH';
      type: 'rotation';
      axis: Vector3;
      angle: number;
      pivot: Vector3;
      label: string;
    }
  | {
      group: 'A' | 'B' | 'BOTH';
      type: 'translation';
      delta: Vector3;
      label: string;
    };

export type PatternName =
  | 'identity'
  | 'flipAlternate'
  | 'rotateAlternate'
  | 'shiftAlternate'
  | 'mirrorAlternate';

export interface ArrangementOptions {
  shift?: number;
}
