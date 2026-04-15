export { Panel } from './Panel';
export type { Segment } from './Panel';
export { initManifold, getManifold } from './manifold';
export {
  planeNormal,
  panelExtentAlongNormal,
  classifyNormals,
  perpAxes,
  checkJoinCompat,
  stageMatrixAtProgress,
  buildJoinStages,
} from './operations';
export { PATTERN_RULES, PATTERN_RULES_AT, applyArrangement } from './patterns';
export type {
  Species,
  StripDef,
  FaceSelection,
  NormalRelation,
  FlipAxis,
  JoinCompat,
  JoinStage,
  PatternName,
  ArrangementOptions,
} from './types';
