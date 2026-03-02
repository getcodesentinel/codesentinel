export {
  EXIT_CODES,
  GovernanceConfigurationError,
  DEFAULT_NEW_HOTSPOT_SCORE_THRESHOLD,
  type Violation,
  type ViolationSeverity,
  type FailOnLevel,
  type GateConfig,
  type GateEvaluationInput,
  type GateEvaluationResult,
} from "./domain.js";

export { evaluateGates } from "./evaluate-gates.js";
export { renderCheckText, renderCheckMarkdown } from "./render.js";
export {
  BaselineRefResolutionError,
  resolveBaselineSnapshotFromRef,
  baselineTempDirectoryName,
  type BaselineRefResolutionResult,
  type ResolveBaselineFromRefInput,
} from "./baseline-ref.js";
