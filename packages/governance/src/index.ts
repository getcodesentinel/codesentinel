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
  resolveAutoBaselineRef,
  baselineTempDirectoryName,
  type BaselineRefResolutionResult,
  type ResolveBaselineFromRefInput,
  type ResolveAutoBaselineRefInput,
} from "./baseline-ref.js";
export {
  BaselineAutoResolutionError,
  resolveAutoBaseline,
  type BaselineAutoResolution,
  type BaselineAutoResolutionAttempt,
  type BaselineAutoResolutionStrategy,
  type BaselineAutoGitAdapter,
  type ResolveAutoBaselineInput,
} from "./baseline-auto-resolver.js";
