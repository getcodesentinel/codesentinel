import type { EvidenceRef } from "@codesentinel/core";
import { DEFAULT_NEW_HOTSPOT_SCORE_THRESHOLD, GovernanceConfigurationError, type GateEvaluationInput, type GateEvaluationResult, type Violation, type ViolationSeverity } from "./domain.js";

const severityRank: Readonly<Record<ViolationSeverity, number>> = {
  info: 0,
  warn: 1,
  error: 2,
};

const compareSeverity = (
  left: ViolationSeverity | null,
  right: ViolationSeverity | null,
): ViolationSeverity | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }

  return severityRank[left] >= severityRank[right] ? left : right;
};

const stableSortViolations = (violations: readonly Violation[]): readonly Violation[] =>
  [...violations].sort((a, b) => {
    const severity = severityRank[b.severity] - severityRank[a.severity];
    if (severity !== 0) {
      return severity;
    }

    if (a.id !== b.id) {
      return a.id.localeCompare(b.id);
    }

    const aTarget = a.targets[0] ?? "";
    const bTarget = b.targets[0] ?? "";
    if (aTarget !== bTarget) {
      return aTarget.localeCompare(bTarget);
    }

    return a.message.localeCompare(b.message);
  });

const makeViolation = (
  id: string,
  severity: ViolationSeverity,
  message: string,
  targets: readonly string[],
  evidenceRefs: readonly EvidenceRef[],
): Violation => ({
  id,
  severity,
  message,
  targets: [...targets].sort((a, b) => a.localeCompare(b)),
  evidenceRefs,
});

const requireDiff = (input: GateEvaluationInput, gateId: string): void => {
  if (input.baseline === undefined || input.diff === undefined) {
    throw new GovernanceConfigurationError(`${gateId} requires --compare <baseline.json>`);
  }
};

const validateGateConfig = (input: GateEvaluationInput): void => {
  const config = input.gateConfig;

  if (config.maxRepoDelta !== undefined && (!Number.isFinite(config.maxRepoDelta) || config.maxRepoDelta < 0)) {
    throw new GovernanceConfigurationError("max-repo-delta must be a finite number >= 0");
  }

  if (config.maxNewHotspots !== undefined && (!Number.isInteger(config.maxNewHotspots) || config.maxNewHotspots < 0)) {
    throw new GovernanceConfigurationError("max-new-hotspots must be an integer >= 0");
  }

  if (config.maxRepoScore !== undefined && (!Number.isFinite(config.maxRepoScore) || config.maxRepoScore < 0 || config.maxRepoScore > 100)) {
    throw new GovernanceConfigurationError("max-repo-score must be a number in [0, 100]");
  }

  if (
    config.newHotspotScoreThreshold !== undefined &&
    (!Number.isFinite(config.newHotspotScoreThreshold) ||
      config.newHotspotScoreThreshold < 0 ||
      config.newHotspotScoreThreshold > 100)
  ) {
    throw new GovernanceConfigurationError("new-hotspot-score-threshold must be a number in [0, 100]");
  }
};

export const evaluateGates = (input: GateEvaluationInput): GateEvaluationResult => {
  validateGateConfig(input);

  const config = input.gateConfig;
  const violations: Violation[] = [];
  const evaluatedGates: string[] = [];

  if (config.maxRepoScore !== undefined) {
    evaluatedGates.push("max-repo-score");
    const current = input.current.analysis.risk.repositoryScore;
    if (current > config.maxRepoScore) {
      violations.push(
        makeViolation(
          "max-repo-score",
          "error",
          `Repository score ${current} exceeds configured max ${config.maxRepoScore}.`,
          [input.current.analysis.structural.targetPath],
          [{ kind: "repository_metric", metric: "repositoryScore" }],
        ),
      );
    }
  }

  if (config.maxRepoDelta !== undefined) {
    evaluatedGates.push("max-repo-delta");
    requireDiff(input, "max-repo-delta");
    const baseline = input.baseline;
    if (baseline === undefined) {
      throw new GovernanceConfigurationError("max-repo-delta requires baseline snapshot");
    }

    const delta = input.current.analysis.risk.normalizedScore - baseline.analysis.risk.normalizedScore;
    if (delta > config.maxRepoDelta) {
      violations.push(
        makeViolation(
          "max-repo-delta",
          "error",
          `Repository normalized score delta ${delta.toFixed(4)} exceeds allowed ${config.maxRepoDelta}.`,
          [input.current.analysis.structural.targetPath],
          [{ kind: "repository_metric", metric: "normalizedScore" }],
        ),
      );
    }
  }

  if (config.noNewCycles === true) {
    evaluatedGates.push("no-new-cycles");
    requireDiff(input, "no-new-cycles");
    const diff = input.diff;
    if (diff === undefined) {
      throw new GovernanceConfigurationError("no-new-cycles requires diff");
    }
    if (diff.newCycles.length > 0) {
      violations.push(
        makeViolation(
          "no-new-cycles",
          "error",
          `Detected ${diff.newCycles.length} new structural cycle(s).`,
          diff.newCycles,
          [{ kind: "repository_metric", metric: "cycleCount" }],
        ),
      );
    }
  }

  if (config.noNewHighRiskDeps === true) {
    evaluatedGates.push("no-new-high-risk-deps");
    requireDiff(input, "no-new-high-risk-deps");
    const diff = input.diff;
    if (diff === undefined) {
      throw new GovernanceConfigurationError("no-new-high-risk-deps requires diff");
    }
    if (diff.externalChanges.highRiskAdded.length > 0) {
      violations.push(
        makeViolation(
          "no-new-high-risk-deps",
          "error",
          `Detected ${diff.externalChanges.highRiskAdded.length} new high-risk dependency(ies).`,
          diff.externalChanges.highRiskAdded,
          diff.externalChanges.highRiskAdded.map((name) => ({
            kind: "dependency_metric",
            target: name,
            metric: "highRiskDependencies",
          })),
        ),
      );
    }
  }

  if (config.maxNewHotspots !== undefined) {
    evaluatedGates.push("max-new-hotspots");
    requireDiff(input, "max-new-hotspots");
    const diff = input.diff;
    if (diff === undefined) {
      throw new GovernanceConfigurationError("max-new-hotspots requires diff");
    }

    const scoreByFile = new Map(
      input.current.analysis.risk.fileScores.map((item) => [item.file, item.score]),
    );
    const threshold = config.newHotspotScoreThreshold ?? DEFAULT_NEW_HOTSPOT_SCORE_THRESHOLD;
    const counted = diff.newHotspots.filter((file) => (scoreByFile.get(file) ?? 0) >= threshold);

    if (counted.length > config.maxNewHotspots) {
      violations.push(
        makeViolation(
          "max-new-hotspots",
          "warn",
          `Detected ${counted.length} new hotspot(s) above score ${threshold}; allowed max is ${config.maxNewHotspots}.`,
          counted,
          counted.map((file) => ({ kind: "file_metric", target: file, metric: "score" })),
        ),
      );
    }
  }

  const ordered = stableSortViolations(violations);
  const highestSeverity = ordered.reduce<ViolationSeverity | null>(
    (current, violation) => compareSeverity(current, violation.severity),
    null,
  );

  const exitCode: 0 | 1 | 2 =
    highestSeverity === "error"
      ? 1
      : highestSeverity === "warn" && config.failOn === "warn"
        ? 2
        : 0;

  return {
    violations: ordered,
    highestSeverity,
    exitCode,
    evaluatedGates: [...evaluatedGates].sort((a, b) => a.localeCompare(b)),
  };
};
