/**
 * Operation I/O signatures for the linear pipeline.
 *
 * Every pipeline op consumes one upstream value of a declared kind
 * (`panel` or `slices`) and produces one value of a declared kind.
 * The Workbench renderer consults this registry when binding an
 * operation's Input tile to "the nearest upstream feature that
 * produces the type I need." Without it, renderers would have to
 * hardcode stage ids ("compose-0", "first cut"), which is how the
 * multi-Cut tile-binding bugs crept in.
 *
 * Adding a new operation is a two-step change:
 *   1. Add the feature type + executor (pipeline.ts).
 *   2. Add its signature row here.
 * The renderer's upstream walkers pick it up automatically — no new
 * "firstFooResult" helpers per kind.
 */
import type { CutResult, Feature, FeatureResult, PanelSnapshot } from './types';

/**
 * The typed values that flow between operations. Extend as new
 * operation kinds introduce new I/O shapes.
 */
export type IOKind = 'panel' | 'slices';

export interface OpSignature {
  /** null means this op is a source (produces without consuming). */
  input: IOKind | null;
  output: IOKind;
}

/**
 * One row per Feature.kind. `null` entries mark features that are
 * not standalone pipeline stages (PlaceEdit, Preset, SpacerInsert
 * attach to an Arrange; they have no I/O signature of their own).
 */
export const OP_SIGNATURES: Record<Feature['kind'], OpSignature | null> = {
  composeStrips: { input: null, output: 'panel' },
  cut: { input: 'panel', output: 'slices' },
  arrange: { input: 'slices', output: 'panel' },
  trimPanel: { input: 'panel', output: 'panel' },
  placeEdit: null,
  preset: null,
  spacerInsert: null,
};

/**
 * Typed extractors — pull the declared output payload out of a
 * FeatureResult. Paired with OP_SIGNATURES.output so call sites
 * never have to guess which field on the result carries the value.
 */
export function extractPanel(r: FeatureResult): PanelSnapshot | undefined {
  return 'panel' in r ? r.panel : undefined;
}

export function extractSlices(r: FeatureResult): PanelSnapshot[] | undefined {
  if ('slices' in r && Array.isArray((r as CutResult).slices)) {
    return (r as CutResult).slices;
  }
  return undefined;
}
