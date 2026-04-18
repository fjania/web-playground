/**
 * Preset expansion — each persistent Preset feature expands into a
 * list of PlaceEdits (or SpacerInserts, for `spacerEveryRow`) at
 * pipeline time. Expansion is deterministic and re-runs on every
 * regen; nothing is baked into AppState.timeline.
 *
 * The expanded PlaceEdits / SpacerInserts are ephemeral — they live
 * only in PipelineOutput, attributed to the source Preset via
 * ArrangeResult.appliedEditSources / appliedSpacerSources.
 *
 * Signatures match the scope in issue #20:
 *   expandPreset(preset, sliceProvenance): PlaceEdit[] | SpacerInsert[]
 *
 * `sliceProvenance` comes from the upstream CutResult — parallel to
 * the slice array, so sliceIdx indexes into both. Expanded edits
 * carry the `contributingStripIds` from this provenance at expansion
 * time, satisfying the day-one contract in v2.1 types.
 */

import type {
  PlaceEdit,
  Preset,
  SpacerInsert,
} from './types';

export interface SliceProvenanceEntry {
  sliceIdx: number;
  contributingStripIds: string[];
}

/**
 * Expand a Preset into the ephemeral PlaceEdit / SpacerInsert list
 * that Arrange actually applies. Returns a discriminated object so
 * callers can route each kind to its handler.
 */
export function expandPreset(
  preset: Preset,
  sliceProvenance: SliceProvenanceEntry[],
): { kind: 'placeEdits'; edits: PlaceEdit[] } | { kind: 'spacers'; spacers: SpacerInsert[] } {
  const N = sliceProvenance.length;

  switch (preset.preset) {
    case 'flipAlternate':
      return {
        kind: 'placeEdits',
        edits: oddIndices(N).map((i, k) =>
          makeEdit(preset, i, k, sliceProvenance[i], { kind: 'rotate', degrees: 180 }),
        ),
      };

    case 'rotateAlternate':
      return {
        kind: 'placeEdits',
        edits: oddIndices(N).map((i, k) =>
          makeEdit(preset, i, k, sliceProvenance[i], {
            kind: 'rotate',
            degrees: preset.params.degrees,
          }),
        ),
      };

    case 'mirrorAlternate':
      // For rip=0, mirrorAlternate ≡ flipAlternate in effect. At
      // rip!=0 the semantics diverge; that distinction lands with
      // the v2.12 UI work (#30). For now the expansion is the same
      // as flipAlternate — rotate 180 on odd slices.
      return {
        kind: 'placeEdits',
        edits: oddIndices(N).map((i, k) =>
          makeEdit(preset, i, k, sliceProvenance[i], { kind: 'rotate', degrees: 180 }),
        ),
      };

    case 'rotate4way':
      return {
        kind: 'placeEdits',
        edits: sliceProvenance.map((prov, i) => {
          const deg = (90 * (i % 4)) as 0 | 90 | 180 | 270;
          // deg=0 contributes an identity rotate — skip it to keep
          // the edit list tight. The cursor-slide handles missing
          // edits correctly (slice passes through).
          if (deg === 0) return null;
          return makeEdit(preset, i, i, prov, { kind: 'rotate', degrees: deg });
        }).filter((e): e is PlaceEdit => e !== null),
      };

    case 'shiftAlternate':
      return {
        kind: 'placeEdits',
        edits: oddIndices(N).map((i, k) =>
          makeEdit(preset, i, k, sliceProvenance[i], {
            kind: 'shift',
            delta: preset.params.shift,
          }),
        ),
      };

    case 'spacerEveryRow':
      return {
        kind: 'spacers',
        spacers: Array.from({ length: Math.max(0, N - 1) }, (_, i) => ({
          kind: 'spacerInsert' as const,
          id: `${preset.id}-expand-${i}`,
          arrangeId: preset.arrangeId,
          afterSliceIdx: i,
          contributingStripIds: sliceProvenance[i]?.contributingStripIds ?? [],
          species: preset.params.species,
          width: preset.params.width,
          status: 'ok' as const,
        })),
      };
  }
}

function oddIndices(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < n; i += 2) out.push(i);
  return out;
}

function makeEdit(
  preset: Preset,
  sliceIdx: number,
  k: number,
  prov: SliceProvenanceEntry,
  op: PlaceEdit['op'],
): PlaceEdit {
  return {
    kind: 'placeEdit',
    id: `${preset.id}-expand-${k}`,
    target: {
      arrangeId: preset.arrangeId,
      sliceIdx,
      contributingStripIds: [...prov.contributingStripIds],
    },
    op,
    status: 'ok',
  };
}
