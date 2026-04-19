import { Matrix4, Vector3 } from 'three';
import { Panel } from './Panel';
import type { ArrangementOptions, PatternName } from './types';

type PatternRule = (i: number, n: number, opts: ArrangementOptions) => Matrix4;
type PatternRuleAt = (
  i: number,
  n: number,
  opts: ArrangementOptions,
  t: number,
) => Matrix4;

/**
 * Per-slice transform rules for arrangement patterns. Each returns a
 * Matrix4 applied in the slice's local frame (slice centered at origin).
 */
export const PATTERN_RULES: Record<PatternName, PatternRule> = {
  identity: () => new Matrix4(),

  flipAlternate: (i) =>
    i % 2 === 1 ? new Matrix4().makeRotationY(Math.PI) : new Matrix4(),

  rotateAlternate: (i) =>
    i % 2 === 1 ? new Matrix4().makeRotationZ(Math.PI) : new Matrix4(),

  shiftAlternate: (i, _n, opts) => {
    if (i % 2 !== 1) return new Matrix4();
    const s = opts.shift ?? 25;
    return new Matrix4().makeTranslation(s, 0, 0);
  },

  mirrorAlternate: (i) =>
    i % 2 === 1 ? new Matrix4().makeRotationX(Math.PI) : new Matrix4(),
};

/**
 * Same rules, parameterized by progress t ∈ [0, 1] for animation. At t=1
 * these match PATTERN_RULES exactly; at t=0 they're identity.
 */
export const PATTERN_RULES_AT: Record<PatternName, PatternRuleAt> = {
  identity: () => new Matrix4(),
  flipAlternate: (i, _n, _opts, t) =>
    i % 2 === 1 ? new Matrix4().makeRotationY(Math.PI * t) : new Matrix4(),
  rotateAlternate: (i, _n, _opts, t) =>
    i % 2 === 1 ? new Matrix4().makeRotationZ(Math.PI * t) : new Matrix4(),
  shiftAlternate: (i, _n, opts, t) => {
    if (i % 2 !== 1) return new Matrix4();
    const s = (opts.shift ?? 25) * t;
    return new Matrix4().makeTranslation(s, 0, 0);
  },
  mirrorAlternate: (i, _n, _opts, t) =>
    i % 2 === 1 ? new Matrix4().makeRotationX(Math.PI * t) : new Matrix4(),
};

/**
 * Apply an arrangement pattern to a list of slices, stacking them along
 * `cutNormal` with spacing `pitch`. Returns a single joined Panel (the
 * caller takes ownership and must dispose the result).
 */
export function applyArrangement(
  slices: Panel[],
  pattern: PatternName,
  cutNormal: Vector3,
  pitch: number,
  options: ArrangementOptions = {},
): Panel | null {
  const n = slices.length;
  if (n === 0) return null;
  const rule = PATTERN_RULES[pattern] ?? PATTERN_RULES.identity;
  const center = (n - 1) / 2;

  let result: Panel | null = null;
  for (let i = 0; i < n; i++) {
    const slice = slices[i];
    const bb = slice.boundingBox();
    const sc = new Vector3();
    bb.getCenter(sc);

    const toLocal = new Matrix4().makeTranslation(-sc.x, -sc.y, -sc.z);
    const ruleMat = rule(i, n, options);
    const target = cutNormal.clone().multiplyScalar((i - center) * pitch);
    const toStack = new Matrix4().makeTranslation(target.x, target.y, target.z);

    const full = new Matrix4().multiplyMatrices(toStack, ruleMat).multiply(toLocal);
    const transformed = slice.transform(full);
    result = result ? result.concat(transformed) : transformed;
  }

  if (!result) return null;

  const bb = result.boundingBox();
  const c = new Vector3();
  bb.getCenter(c);
  if (c.length() > 1e-6) {
    const centered = result.translate(-c.x, -c.y, -c.z);
    result.dispose();
    result = centered;
  }
  return result;
}
