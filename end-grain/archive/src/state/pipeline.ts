import { Vector3 } from 'three';
import { Panel } from '../domain/Panel';
import { applyArrangement, planeNormal, panelExtentAlongNormal } from '../domain';
import type { AppState, CutPass, PassConfig } from './types';

export interface CutPassResult {
  pass: CutPass;
  cutNormal: Vector3;
  slices: Panel[];
  offcuts: Panel[];
  /** null when pass is in custom mode (arrangement doesn't auto-produce a
   *  joined panel) or when there are no slices. */
  arranged: Panel | null;
  /** Input panel to this pass — used downstream for centering + cut-plane
   *  visualization sizing. */
  input: Panel;
}

function runCutPass(pass: CutPass, input: Panel): CutPassResult {
  const normal = planeNormal(pass.rip, pass.bevel);
  const normalArr: [number, number, number] = [normal.x, normal.y, normal.z];
  const extent = panelExtentAlongNormal(input, normal);
  const count = Math.max(1, Math.floor(extent / pass.pitch));
  const { slices, offcuts } = input.cutRepeated(normalArr, pass.pitch, count, 0);
  const offcutArr = Array.isArray(offcuts) ? offcuts : [];

  let arranged: Panel | null = null;
  if (pass.mode === 'pattern' && slices.length > 0) {
    arranged = applyArrangement(slices, pass.pattern, normal, pass.pitch, {
      shift: pass.shift,
    });
  }

  return { pass, cutNormal: normal, slices, offcuts: offcutArr, arranged, input };
}

/**
 * Pipeline owns the Panel lifecycle. Callers read `startingPanel` and
 * `results`; they never call `.dispose()`. `rebuild(state)` disposes the
 * previous graph and computes a fresh one in order, so a change anywhere
 * in `appState` results in one cascade (not N hand-chained rebuilds).
 */
export class Pipeline {
  private _starting: Panel | null = null;
  private _results: CutPassResult[] = [];

  get startingPanel(): Panel | null {
    return this._starting;
  }

  get results(): readonly CutPassResult[] {
    return this._results;
  }

  /** Returns the panel feeding pass `idx` (0 = starting panel). */
  inputFor(idx: number): Panel | null {
    if (idx === 0) return this._starting;
    const prev = this._results[idx - 1];
    return prev?.arranged ?? prev?.input ?? null;
  }

  /** Returns the output panel of pass `idx`, or null if pass is custom
   *  mode / no slices. Useful as the input to downstream passes. */
  outputOf(idx: number): Panel | null {
    return this._results[idx]?.arranged ?? null;
  }

  rebuild(state: AppState): void {
    this.dispose();

    this._starting = Panel.fromStripList(
      state.strips,
      state.stripHeight,
      state.stripLength,
    );

    let input: Panel = this._starting;
    for (const pass of state.passes) {
      if (pass.kind === 'cut') {
        const result = runCutPass(pass, input);
        this._results.push(result);
        input = result.arranged ?? input;
      }
    }
  }

  dispose(): void {
    // Results first (they own derived panels), then starting.
    for (const r of this._results) {
      for (const s of r.slices) s.dispose();
      for (const o of r.offcuts) o.dispose();
      r.arranged?.dispose();
    }
    this._results = [];
    this._starting?.dispose();
    this._starting = null;
  }
}

/** Placeholder so TS knows PassConfig may gain more kinds later. */
export type { PassConfig };
