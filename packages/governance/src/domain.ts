import type { EvidenceRef } from "@codesentinel/core";
import type { CodeSentinelSnapshot, SnapshotDiff } from "@codesentinel/reporter";

export type ViolationSeverity = "info" | "warn" | "error";

export type Violation = {
  id: string;
  severity: ViolationSeverity;
  message: string;
  targets: readonly string[];
  evidenceRefs: readonly EvidenceRef[];
};

export type FailOnLevel = "error" | "warn";

export type GateConfig = {
  maxRepoDelta?: number;
  noNewCycles?: boolean;
  noNewHighRiskDeps?: boolean;
  maxNewHotspots?: number;
  maxRepoScore?: number;
  newHotspotScoreThreshold?: number;
  failOn: FailOnLevel;
};

export type GateEvaluationInput = {
  current: CodeSentinelSnapshot;
  baseline?: CodeSentinelSnapshot;
  diff?: SnapshotDiff;
  gateConfig: GateConfig;
};

export type GateEvaluationResult = {
  violations: readonly Violation[];
  highestSeverity: ViolationSeverity | null;
  exitCode: 0 | 1 | 2;
  evaluatedGates: readonly string[];
};

export const EXIT_CODES = {
  ok: 0,
  errorViolation: 1,
  warnViolation: 2,
  invalidConfiguration: 3,
  internalError: 4,
} as const;

export class GovernanceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceConfigurationError";
  }
}

export const DEFAULT_NEW_HOTSPOT_SCORE_THRESHOLD = 60;
