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
  type FileOwnershipReportItem,
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
      recentCommitCount: evolutionMetrics?.recentCommitCount ?? null,
      recentVolatility: evolutionMetrics?.recentVolatility ?? null,
      churnTotal: evolutionMetrics?.churnTotal ?? null,
      ownerCount: evolutionMetrics?.authorDistributionByCommits.length ?? null,
      topAuthorShareByCommits: evolutionMetrics?.topAuthorShareByCommits ?? null,
      busFactorByCommits: evolutionMetrics?.busFactorByCommits ?? null,
      authorDistributionByCommits: evolutionMetrics?.authorDistributionByCommits ?? [],
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

const structuralArchitectureMetrics = (snapshot: CodeSentinelSnapshot) => {
  const metrics = snapshot.analysis.structural.metrics;
  const nodeCount = metrics.nodeCount;
  const edgeCount = metrics.edgeCount;
  const maxPossibleEdges = nodeCount <= 1 ? 0 : nodeCount * (nodeCount - 1);
  const couplingDensity = maxPossibleEdges === 0 ? 0 : round4((edgeCount / maxPossibleEdges) * 100);
  const entryPointCount = snapshot.analysis.structural.files.filter(
    (file) => file.fanIn === 0 && file.fanOut > 0,
  ).length;

  return {
    nodeCount,
    edgeCount,
    graphDepth: metrics.graphDepth,
    maxFanIn: metrics.maxFanIn,
    maxFanOut: metrics.maxFanOut,
    couplingDensity,
    entryPointCount,
  };
};

const structuralModuleAnatomy = (snapshot: CodeSentinelSnapshot) => {
  const moduleMap = new Map<
    string,
    { module: string; dependencyCount: number; fanIn: number; fanOut: number; depth: number }
  >();

  for (const file of snapshot.analysis.structural.files) {
    const module = toPosixDirname(file.relativePath);
    const current = moduleMap.get(module) ?? {
      module,
      dependencyCount: 0,
      fanIn: 0,
      fanOut: 0,
      depth: 0,
    };

    current.dependencyCount += file.directDependencies.length;
    current.fanIn = Math.max(current.fanIn, file.fanIn);
    current.fanOut = Math.max(current.fanOut, file.fanOut);
    current.depth = Math.max(current.depth, file.depth);
    moduleMap.set(module, current);
  }

  return [...moduleMap.values()]
    .sort(
      (a, b) =>
        b.dependencyCount - a.dependencyCount ||
        b.fanIn - a.fanIn ||
        b.depth - a.depth ||
        a.module.localeCompare(b.module),
    )
    .slice(0, 5);
};

const average = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : round4(values.reduce((sum, value) => sum + value, 0) / values.length);

const toPercent = (value: number): number => round4(value * 100);
const LEGACY_NO_ACTIVE_OWNER_DAYS = 180;
const MODULE_KNOWLEDGE_LABEL_PRIORITY = {
  siloed: 0,
  sparse: 1,
  distributed: 2,
} as const;

const fileOwnershipItems = (
  files: Extract<CodeSentinelSnapshot["analysis"]["evolution"], { available: true }>["files"],
): Extract<CodeSentinelReport["changeOwnership"], { available: true }>["fileOwnership"] => {
  const labelPriority = {
    singleMaintainer: 0,
    concentrated: 1,
    shared: 2,
  } as const;

  return files
    .filter((file) => file.commitCount > 0 && file.authorDistributionByCommits.length > 0)
    .map((file) => {
      const ownershipLabel: FileOwnershipReportItem["ownershipLabel"] =
        file.authorDistributionByCommits.length <= 1
          ? "singleMaintainer"
          : file.topAuthorShareByCommits > 0.6
            ? "concentrated"
            : "shared";

      return {
        filePath: file.filePath,
        module: toPosixDirname(file.filePath),
        commitCount: file.commitCount,
        churnTotal: file.churnTotal,
        ownershipLabel,
        topAuthorShareByCommits: file.topAuthorShareByCommits,
        busFactorByCommits: file.busFactorByCommits,
        authorDistributionByCommits: file.authorDistributionByCommits,
        topAuthorShareByChurn: file.topAuthorShareByChurn,
        busFactorByChurn: file.busFactorByChurn,
        authorDistributionByChurn: file.authorDistributionByChurn,
      };
    })
    .sort(
      (a, b) =>
        labelPriority[a.ownershipLabel] - labelPriority[b.ownershipLabel] ||
        b.topAuthorShareByCommits - a.topAuthorShareByCommits ||
        b.commitCount - a.commitCount ||
        a.filePath.localeCompare(b.filePath),
    );
};

const changeOwnershipSummary = (
  snapshot: CodeSentinelSnapshot,
): CodeSentinelReport["changeOwnership"] => {
  if (!snapshot.analysis.evolution.available) {
    return {
      available: false,
      reason: snapshot.analysis.evolution.reason,
    };
  }

  const evolution = snapshot.analysis.evolution;
  const files = evolution.files;
  const ownershipReadyFiles = files.filter(
    (file) => file.topAuthorShareByCommits !== null && file.authorDistributionByCommits.length > 0,
  );

  const sharedOwnershipCount = ownershipReadyFiles.filter(
    (file) => file.authorDistributionByCommits.length >= 2 && file.topAuthorShareByCommits <= 0.6,
  ).length;
  const concentratedOwnershipCount = ownershipReadyFiles.filter(
    (file) => file.authorDistributionByCommits.length >= 2 && file.topAuthorShareByCommits > 0.6,
  ).length;
  const singleMaintainerCount = ownershipReadyFiles.filter(
    (file) => file.authorDistributionByCommits.length <= 1,
  ).length;
  const headCommitTimestamp = evolution.metrics.headCommitTimestamp;
  const legacyNoActiveOwnerCount = ownershipReadyFiles.filter(
    (file) =>
      file.commitCount > 0 &&
      file.lastCommitTimestamp !== null &&
      headCommitTimestamp !== null &&
      headCommitTimestamp - file.lastCommitTimestamp >= LEGACY_NO_ACTIVE_OWNER_DAYS * 86_400,
  ).length;
  const ownershipDivisor = ownershipReadyFiles.length || 0;

  const moduleKnowledgeMap = new Map<
    string,
    {
      module: string;
      totalCommits: number;
      recentCommits: number;
      authors: Set<string>;
      weightedTopAuthorShare: number;
      weight: number;
    }
  >();

  for (const file of files) {
    const module = toPosixDirname(file.filePath);
    const current = moduleKnowledgeMap.get(module) ?? {
      module,
      totalCommits: 0,
      recentCommits: 0,
      authors: new Set<string>(),
      weightedTopAuthorShare: 0,
      weight: 0,
    };

    current.totalCommits += file.commitCount;
    current.recentCommits += file.recentCommitCount;
    for (const author of file.authorDistributionByCommits) {
      current.authors.add(author.authorId);
    }

    current.weightedTopAuthorShare += file.topAuthorShareByCommits * Math.max(1, file.commitCount);
    current.weight += Math.max(1, file.commitCount);
    moduleKnowledgeMap.set(module, current);
  }

  const moduleKnowledge = [...moduleKnowledgeMap.values()]
    .map((entry) => {
      const topAuthorShareByCommits =
        entry.weight <= 0 ? 0 : round4(entry.weightedTopAuthorShare / entry.weight);
      const activeAuthors = entry.authors.size;
      const ownershipLabel: "distributed" | "sparse" | "siloed" =
        activeAuthors <= 1 || topAuthorShareByCommits >= 0.85
          ? "siloed"
          : activeAuthors <= 2 || topAuthorShareByCommits >= 0.65
            ? "sparse"
            : "distributed";

      return {
        module: entry.module,
        totalCommits: entry.totalCommits,
        recentCommits: entry.recentCommits,
        activeAuthors,
        topAuthorShareByCommits,
        ownershipLabel,
      };
    })
    .sort(
      (a, b) =>
        MODULE_KNOWLEDGE_LABEL_PRIORITY[a.ownershipLabel] -
          MODULE_KNOWLEDGE_LABEL_PRIORITY[b.ownershipLabel] ||
        b.totalCommits - a.totalCommits ||
        a.module.localeCompare(b.module),
    )
    .slice(0, 8);

  const coChangePairs = [...evolution.coupling.pairs]
    .sort(
      (a, b) =>
        b.couplingScore - a.couplingScore ||
        b.coChangeCommits - a.coChangeCommits ||
        a.fileA.localeCompare(b.fileA) ||
        a.fileB.localeCompare(b.fileB),
    )
    .slice(0, 5)
    .map((pair) => ({
      fileA: pair.fileA,
      fileB: pair.fileB,
      coChangeCommits: pair.coChangeCommits,
      couplingScore: round4(pair.couplingScore),
    }));

  return {
    available: true,
    metrics: {
      totalCommits: evolution.metrics.totalCommits,
      totalFiles: evolution.metrics.totalFiles,
      recentWindowDays: evolution.metrics.recentWindowDays,
      meanBusFactorByCommits: average(
        files.map((file) => file.busFactorByCommits).filter((value) => value !== null),
      ),
      averageRecentVolatility: average(files.map((file) => toPercent(file.recentVolatility))),
      sharedOwnershipPercent:
        ownershipDivisor === 0 ? null : round4((sharedOwnershipCount / ownershipDivisor) * 100),
      concentratedOwnershipPercent:
        ownershipDivisor === 0
          ? null
          : round4((concentratedOwnershipCount / ownershipDivisor) * 100),
      singleMaintainerPercent:
        ownershipDivisor === 0 ? null : round4((singleMaintainerCount / ownershipDivisor) * 100),
      legacyNoActiveOwnerPercent:
        ownershipDivisor === 0 ? null : round4((legacyNoActiveOwnerCount / ownershipDivisor) * 100),
    },
    recentActivity: evolution.recentActivity ?? [],
    coChangePairs,
    moduleKnowledge,
    fileOwnership: fileOwnershipItems(files),
  };
};

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
        transitiveDependencyCount: dependency?.transitiveDependencies.length ?? 0,
        dependentCount: dependency?.dependents ?? 0,
        fanOut: dependency?.fanOut ?? 0,
        dependencyDepth: dependency?.dependencyDepth ?? 0,
        weeklyDownloads: dependency?.weeklyDownloads ?? null,
        maintainerCount: dependency?.maintainerCount ?? null,
        releaseFrequencyDays: dependency?.releaseFrequencyDays ?? null,
        daysSinceLastRelease: dependency?.daysSinceLastRelease ?? null,
        repositoryActivity30d: dependency?.repositoryActivity30d ?? null,
        busFactor: dependency?.busFactor ?? null,
        ownRiskSignals: dependency?.ownRiskSignals ?? [],
        inheritedRiskSignals: dependency?.inheritedRiskSignals ?? [],
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
      metrics: structuralArchitectureMetrics(snapshot),
      moduleAnatomy: structuralModuleAnatomy(snapshot),
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
    changeOwnership: changeOwnershipSummary(snapshot),
    external: !external.available
      ? {
          available: false,
          reason: external.reason,
        }
      : {
          available: true,
          metrics: external.metrics,
          highRiskDependencies: [...external.highRiskDependencies].sort((a, b) =>
            a.localeCompare(b),
          ),
          highRiskDevelopmentDependencies: [...external.highRiskDevelopmentDependencies].sort(
            (a, b) => a.localeCompare(b),
          ),
          transitiveExposureDependencies: [...external.transitiveExposureDependencies].sort(
            (a, b) => a.localeCompare(b),
          ),
          singleMaintainerDependencies: [...external.singleMaintainerDependencies].sort((a, b) =>
            a.localeCompare(b),
          ),
          abandonedDependencies: [...external.abandonedDependencies].sort((a, b) =>
            a.localeCompare(b),
          ),
          centralityRanking: [...external.centralityRanking].sort(
            (a, b) =>
              b.dependents - a.dependents || b.fanOut - a.fanOut || a.name.localeCompare(b.name),
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
