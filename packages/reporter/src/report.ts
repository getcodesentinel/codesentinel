import { basename, posix } from "node:path";
import type { TargetTrace } from "@codesentinel/core";
import {
  REPORT_SCHEMA_VERSION,
  factorLabel,
  round4,
  toHealthTier,
  summarizeEvidence,
  toRiskTier,
  type CodeSentinelReport,
  type CodeSentinelSnapshot,
  type HotspotReportItem,
  type RepositoryDimensionScores,
  type RenderedFactor,
  type RiskyDependencyReportItem,
  type SnapshotDiff,
  type StructuralCycleDetail,
  type StructuralFileExtreme,
} from "./domain.js";

const toPosixDirname = (value: string): string => {
  const normalized = value.replaceAll("\\", "/");
  const directory = posix.dirname(normalized);
  return directory === "." ? "root" : directory;
};

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

const hotspotReason = (factors: readonly RenderedFactor[]): string => {
  if (factors.length === 0) {
    return "Limited trace data available for this hotspot.";
  }

  return factors
    .slice(0, 2)
    .map((factor) => `${factor.label} (${factor.contribution})`)
    .join(" + ");
};

const hotspotItems = (snapshot: CodeSentinelSnapshot): readonly HotspotReportItem[] =>
  snapshot.analysis.risk.hotspots.slice(0, 10).map((hotspot, index) => {
    const fileScore = snapshot.analysis.risk.fileScores.find((item) => item.file === hotspot.file);
    const evolutionMetrics = snapshot.analysis.evolution.available
      ? snapshot.analysis.evolution.files.find((item) => item.filePath === hotspot.file)
      : undefined;
    const traceTarget = findTraceTarget(snapshot, "file", hotspot.file);
    const factors = toRenderedFactors(traceTarget);

    return {
      rank: index + 1,
      target: hotspot.file,
      module: toPosixDirname(hotspot.file),
      score: hotspot.score,
      normalizedScore: fileScore?.normalizedScore ?? round4(hotspot.score / 100),
      commitCount: evolutionMetrics?.commitCount ?? null,
      churnTotal: evolutionMetrics?.churnTotal ?? null,
      riskContributions: hotspot.factors,
      reason: hotspotReason(factors),
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

const normalizeDependencyScope = (
  scope: string | undefined,
): RiskyDependencyReportItem["dependencyScope"] => {
  switch (scope) {
    case "prod":
    case "dev":
      return scope;
    default:
      return "unknown";
  }
};

const topStructuralFiles = (
  snapshot: CodeSentinelSnapshot,
  selector: (value: (typeof snapshot.analysis.structural.files)[number]) => number,
): readonly StructuralFileExtreme[] =>
  [...snapshot.analysis.structural.files]
    .sort((a, b) => selector(b) - selector(a) || a.relativePath.localeCompare(b.relativePath))
    .slice(0, 5)
    .map((file) => ({
      file: file.relativePath,
      module: toPosixDirname(file.relativePath),
      value: selector(file),
    }));

const cycleDetails = (snapshot: CodeSentinelSnapshot): readonly StructuralCycleDetail[] =>
  snapshot.analysis.structural.cycles.map((cycle, index) => {
    const nodes = [...cycle.nodes].sort((a, b) => a.localeCompare(b));
    return {
      id: `cycle-${index + 1}`,
      size: nodes.length,
      nodes,
      path: nodes.join(" -> "),
    };
  });

const riskyDependencies = (
  snapshot: CodeSentinelSnapshot,
): readonly RiskyDependencyReportItem[] => {
  if (!snapshot.analysis.external.available) {
    return [];
  }

  const dependencyByName = new Map(
    snapshot.analysis.external.dependencies.map((dependency) => [dependency.name, dependency]),
  );

  return snapshot.analysis.risk.dependencyScores
    .map((score) => {
      const dependency = dependencyByName.get(score.dependency);
      const riskSignals = [...new Set([...score.ownRiskSignals, ...score.inheritedRiskSignals])];

      return {
        name: score.dependency,
        score: score.score,
        normalizedScore: score.normalizedScore,
        dependencyScope: normalizeDependencyScope(dependency?.dependencyScope),
        direct: dependency?.direct ?? false,
        resolvedVersion: dependency?.resolvedVersion ?? null,
        riskSignals,
        reason:
          riskSignals.length === 0
            ? "Derived from aggregate dependency risk signals."
            : riskSignals.join(", "),
      };
    })
    .filter((dependency) => dependency.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 20);
};

const repositoryDimensionScores = (snapshot: CodeSentinelSnapshot): RepositoryDimensionScores => {
  const target = findTraceTarget(snapshot, "repository", snapshot.analysis.structural.targetPath);
  if (target === undefined) {
    return {
      structural: null,
      evolution: null,
      external: null,
      interactions: null,
    };
  }

  const structural = target.factors.find((factor) => factor.factorId === "repository.structural");
  const evolution = target.factors.find((factor) => factor.factorId === "repository.evolution");
  const external = target.factors.find((factor) => factor.factorId === "repository.external");
  const interactions = target.factors.find(
    (factor) => factor.factorId === "repository.composite.interactions",
  );

  const interactionScore =
    interactions === undefined
      ? null
      : round4(
          ((interactions.rawMetrics["structuralEvolution"] ?? 0) +
            (interactions.rawMetrics["centralInstability"] ?? 0) +
            (interactions.rawMetrics["dependencyAmplification"] ?? 0)) *
            100,
        );

  return {
    structural:
      structural === undefined
        ? null
        : round4((structural.rawMetrics["structuralDimension"] ?? 0) * 100),
    evolution:
      evolution === undefined
        ? null
        : round4((evolution.rawMetrics["evolutionDimension"] ?? 0) * 100),
    external:
      external === undefined ? null : round4((external.rawMetrics["externalDimension"] ?? 0) * 100),
    interactions: interactionScore,
  };
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
      name:
        basename(snapshot.analysis.structural.targetPath) ||
        snapshot.analysis.structural.targetPath,
      targetPath: snapshot.analysis.structural.targetPath,
      riskScore: snapshot.analysis.risk.riskScore,
      normalizedScore: snapshot.analysis.risk.normalizedScore,
      riskTier: toRiskTier(snapshot.analysis.risk.riskScore),
      healthTier: toHealthTier(snapshot.analysis.health.healthScore),
      confidence: repositoryConfidence(snapshot),
      dimensionScores: repositoryDimensionScores(snapshot),
    },
    health: snapshot.analysis.health,
    hotspots: hotspotItems(snapshot),
    structural: {
      cycleCount: snapshot.analysis.structural.metrics.cycleCount,
      cycles: snapshot.analysis.structural.cycles.map((cycle) =>
        [...cycle.nodes].sort((a, b) => a.localeCompare(b)).join(" -> "),
      ),
      cycleDetails: cycleDetails(snapshot),
      fanInOutExtremes: {
        highestFanIn: topStructuralFiles(snapshot, (file) => file.fanIn),
        highestFanOut: topStructuralFiles(snapshot, (file) => file.fanOut),
        deepestFiles: topStructuralFiles(snapshot, (file) => file.depth),
      },
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
          highRiskDependencies: [...external.highRiskDependencies].sort((a, b) =>
            a.localeCompare(b),
          ),
          highRiskDevelopmentDependencies: [...external.highRiskDevelopmentDependencies].sort(
            (a, b) => a.localeCompare(b),
          ),
          singleMaintainerDependencies: [...external.singleMaintainerDependencies].sort((a, b) =>
            a.localeCompare(b),
          ),
          abandonedDependencies: [...external.abandonedDependencies].sort((a, b) =>
            a.localeCompare(b),
          ),
          riskyDependencies: riskyDependencies(snapshot),
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
