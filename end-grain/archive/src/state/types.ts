import type { PatternName, StripDef } from '../domain/types';

/** Build a stable id like 'cut-0', 'join-1'. Incremented by the factory. */
export type PassId = string;

export type ArrangementMode = 'pattern' | 'custom';

/**
 * Configuration for a "cut" pass — takes an upstream Panel, produces a
 * list of slices (+ offcuts) and an arrangement Panel based on pattern +
 * options. The rip/bevel/pitch control the cutting plane; mode +
 * pattern/shift control what the pipeline does with the slices.
 */
export interface CutPass {
  kind: 'cut';
  id: PassId;
  rip: number;     // -90..90 degrees
  bevel: number;   //  45..90 degrees
  pitch: number;   // slice thickness in mm
  showOffcuts: boolean;
  mode: ArrangementMode;
  pattern: PatternName;
  shift: number;   // used when pattern === 'shiftAlternate'
}

export type PassConfig = CutPass;

/**
 * Top-level app state — the craftsman's choice of starting strips plus
 * the sequence of passes applied to the resulting panel.
 */
export interface AppState {
  /** Ordered strip list feeding the first panel. */
  strips: StripDef[];
  /** Uniform strip height (Y) in mm — shared across all entries. */
  stripHeight: number;
  /** Uniform strip length (Z) in mm — shared across all entries. */
  stripLength: number;
  /** Pass pipeline, in order. Each one consumes the previous pass's output
   *  (or the starting panel if it's pass 0). */
  passes: PassConfig[];
}
