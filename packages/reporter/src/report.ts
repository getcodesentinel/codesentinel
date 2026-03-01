import type { TargetTrace } from "@codesentinel/core";
import {
  REPORT_SCHEMA_VERSION,
  factorLabel,
  round4,
  summarizeEvidence,
  toRiskTier,
  type CodeSentinelReport,
  type CodeSentinelSnapshot,
  type HotspotReportItem,
  type RenderedFactor,
  type SnapshotDiff,
} from "./domain.js";

const findTraceTarget = (
  snapshot: CodeSentinelSnapshot,
  targetType: TargetTrace["targetType"],
  targetId: string,
): TargetTrace | undefined =>
  snapshot.trace?.targets.find(
    (target) => target.targetType === targetType && target.targetId === targetId,
  );

const toRenderedFactors = (target: TargetTrace | undefined): readonly RenderedFactor[] => {
  if (target === undefined) {
    return [];
  }

  return [...target.factors]
    .sort((a, b) => b.contribution - a.contribution || a.factorId.localeCompare(b.factorId))
    .slice(0, 4)
    .map((factor) => ({
      id: factor.factorId,
      label: factorLabel(factor.factorId),
      contribution: round4(factor.contribution),
      confidence: round4(factor.confidence),
      evidence: summarizeEvidence(factor),
    }));
};

const suggestedActions = (target: TargetTrace | undefined): readonly string[] => {
  if (target === undefined) {
    return [];
  }

  const actions: string[] = [];
  for (const lever of target.reductionLevers) {
    switch (lever.factorId) {
      case "file.evolution":
      case "repository.evolution":
        actions.push("Reduce recent churn and volatile edit frequency in this area.");
        break;
      case "file.structural":
      case "repository.structural":
        actions.push("Reduce fan-in/fan-out concentration and simplify deep dependency paths.");
        break;
      case "file.composite.interactions":
      case "repository.composite.interactions":
        actions.push("Stabilize central files before concurrent structural changes.");
        break;
      case "file.external":
      case "repository.external":
        actions.push("Review external dependency pressure for this hotspot.");
        break;
      default:
        actions.push(`Reduce ${factorLabel(lever.factorId).toLowerCase()} influence.`);
        break;
    }
  }

  return [...new Set(actions)].slice(0, 3);
};

const hotspotItems = (snapshot: CodeSentinelSnapshot): readonly HotspotReportItem[] =>
  snapshot.analysis.risk.hotspots.slice(0, 10).map((hotspot) => {
    const fileScore = snapshot.analysis.risk.fileScores.find((item) => item.file === hotspot.file);
    const traceTarget = findTraceTarget(snapshot, "file", hotspot.file);
    const factors = toRenderedFactors(traceTarget);

    return {
      target: hotspot.file,
      score: hotspot.score,
      normalizedScore: fileScore?.normalizedScore ?? round4(hotspot.score / 100),
      topFactors: factors,
      suggestedActions: suggestedActions(traceTarget),
      biggestLevers: (traceTarget?.reductionLevers ?? [])
        .slice(0, 3)
        .map((lever) => `${factorLabel(lever.factorId)} (${lever.estimatedImpact})`),
    };
  });

const repositoryConfidence = (snapshot: CodeSentinelSnapshot): number | null => {
  const target = findTraceTarget(snapshot, "repository", snapshot.analysis.structural.targetPath);
  if (target === undefined || target.factors.length === 0) {
    return null;
  }

  const weight = target.factors.reduce((sum, factor) => sum + factor.contribution, 0);
  if (weight <= 0) {
    return null;
  }

  const weighted = target.factors.reduce(
    (sum, factor) => sum + factor.confidence * factor.contribution,
    0,
  );
  return round4(weighted / weight);
};

export const createReport = (
  snapshot: CodeSentinelSnapshot,
  diff?: SnapshotDiff,
): CodeSentinelReport => {
  const external = snapshot.analysis.external;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repository: {
      targetPath: snapshot.analysis.structural.targetPath,
      repositoryScore: snapshot.analysis.risk.repositoryScore,
      normalizedScore: snapshot.analysis.risk.normalizedScore,
      riskTier: toRiskTier(snapshot.analysis.risk.repositoryScore),
      confidence: repositoryConfidence(snapshot),
    },
    hotspots: hotspotItems(snapshot),
    structural: {
      cycleCount: snapshot.analysis.structural.metrics.cycleCount,
      cycles: snapshot.analysis.structural.cycles.map((cycle) =>
        [...cycle.nodes].sort((a, b) => a.localeCompare(b)).join(" -> "),
      ),
      fragileClusters: snapshot.analysis.risk.fragileClusters.map((cluster) => ({
        id: cluster.id,
        kind: cluster.kind,
        score: cluster.score,
        files: [...cluster.files].sort((a, b) => a.localeCompare(b)),
      })),
    },
    external: !external.available
      ? {
          available: false,
          reason: external.reason,
        }
      : {
          available: true,
          highRiskDependencies: [...external.highRiskDependencies].sort((a, b) => a.localeCompare(b)),
          highRiskDevelopmentDependencies: [...external.highRiskDevelopmentDependencies].sort((a, b) => a.localeCompare(b)),
          singleMaintainerDependencies: [...external.singleMaintainerDependencies].sort((a, b) => a.localeCompare(b)),
          abandonedDependencies: [...external.abandonedDependencies].sort((a, b) => a.localeCompare(b)),
        },
    appendix: {
      snapshotSchemaVersion: snapshot.schemaVersion,
      riskModelVersion: snapshot.riskModelVersion,
      timestamp: snapshot.generatedAt,
      normalization:
        "Scores are deterministic 0-100 outputs from risk-engine normalized factors and interaction terms.",
      ...(snapshot.analysisConfig === undefined ? {} : { analysisConfig: snapshot.analysisConfig }),
    },
    ...(diff === undefined ? {} : { diff }),
  };
};
