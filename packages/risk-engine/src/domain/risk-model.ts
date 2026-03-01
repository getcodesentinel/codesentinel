import type {
  DependencyRiskScore,
  DependencyRiskSignal,
  EvidenceRef,
  ExternalAnalysisSummary,
  FileEvolutionMetrics,
  FileRiskScore,
  FragileCluster,
  GraphAnalysisSummary,
  ModuleRiskScore,
  RepositoryEvolutionSummary,
  RepositoryRiskSummary,
  RiskFactors,
  RiskFactorFamily,
  RiskFactorTrace,
  TargetTrace,
} from "@codesentinel/core";
import type { RiskEngineConfig } from "../config.js";
import {
  average,
  toUnitInterval,
  halfLifeRisk,
  normalizeWeights,
  percentile,
  round4,
  saturatingComposite,
} from "./math.js";
import { buildQuantileScale, logScale, normalizeWithScale } from "./normalization.js";
import type { TraceCollector } from "./trace-collector.js";

type DependencyScoreComputation = {
  dependencyScores: readonly DependencyRiskScore[];
  repositoryExternalPressure: number;
  dependencyContexts: ReadonlyMap<
    string,
    {
      signalScore: number;
      stalenessRisk: number;
      maintainerConcentrationRisk: number;
      transitiveBurdenRisk: number;
      centralityRisk: number;
      chainDepthRisk: number;
      busFactorRisk: number;
      popularityDampener: number;
      rawMetrics: {
        daysSinceLastRelease: number | null;
        maintainerCount: number | null;
        transitiveCount: number;
        dependents: number;
        dependencyDepth: number;
        busFactor: number | null;
        weeklyDownloads: number | null;
      };
      confidence: number;
    }
  >;
};

type FileRiskContext = {
  file: string;
  score: number;
  normalizedScore: number;
  factors: RiskFactors;
  structuralCentrality: number;
  traceTerms: {
    structuralBase: number;
    evolutionBase: number;
    externalBase: number;
    interactionStructuralEvolution: number;
    interactionCentralInstability: number;
    interactionDependencyAmplification: number;
  };
  rawMetrics: {
    fanIn: number;
    fanOut: number;
    depth: number;
    cycleParticipation: number;
    commitCount: number | null;
    churnTotal: number | null;
    recentVolatility: number | null;
    topAuthorShare: number | null;
    busFactor: number | null;
    dependencyAffinity: number;
    repositoryExternalPressure: number;
  };
  normalizedMetrics: {
    fanInRisk: number;
    fanOutRisk: number;
    depthRisk: number;
    frequencyRisk: number;
    churnRisk: number;
    volatilityRisk: number;
    ownershipConcentrationRisk: number;
    busFactorRisk: number;
  };
};

type MetricScales = {
  commitCount: ReturnType<typeof buildQuantileScale>;
  churnTotal: ReturnType<typeof buildQuantileScale>;
  busFactor: ReturnType<typeof buildQuantileScale>;
};

type FactorTraceInput = {
  factorId: string;
  family: RiskFactorFamily;
  strength: number;
  rawMetrics: Readonly<Record<string, number | null>>;
  normalizedMetrics: Readonly<Record<string, number | null>>;
  weight: number | null;
  amplification: number | null;
  evidence: readonly EvidenceRef[];
  confidence: number;
};

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const dependencySignalWeights: Readonly<Record<DependencyRiskSignal, number>> = {
  single_maintainer: 0.3,
  abandoned: 0.3,
  high_centrality: 0.16,
  deep_chain: 0.14,
  high_fanout: 0.06,
  metadata_unavailable: 0.04,
};

const dependencySignalWeightBudget = Object.values(dependencySignalWeights).reduce(
  (sum, value) => sum + value,
  0,
);

const computeDependencySignalScore = (
  ownSignals: readonly DependencyRiskSignal[],
  inheritedSignals: readonly DependencyRiskSignal[],
  inheritedSignalMultiplier: number,
): number => {
  const ownWeight = ownSignals.reduce((sum, signal) => sum + (dependencySignalWeights[signal] ?? 0), 0);
  const inheritedWeight = inheritedSignals.reduce(
    (sum, signal) => sum + (dependencySignalWeights[signal] ?? 0),
    0,
  );

  const weightedTotal = ownWeight + inheritedWeight * inheritedSignalMultiplier;
  const maxWeightedTotal = dependencySignalWeightBudget * (1 + inheritedSignalMultiplier);

  if (maxWeightedTotal <= 0) {
    return 0;
  }

  return toUnitInterval(weightedTotal / maxWeightedTotal);
};

const clampConfidence = (value: number): number => round4(toUnitInterval(value));

const buildFactorTraces = (
  totalScore: number,
  inputs: readonly FactorTraceInput[],
): readonly RiskFactorTrace[] => {
  const positiveInputs = inputs.filter((input) => input.strength > 0);
  const strengthTotal = positiveInputs.reduce((sum, input) => sum + input.strength, 0);

  const traces = inputs.map<RiskFactorTrace>((input) => ({
    factorId: input.factorId,
    family: input.family,
    contribution: 0,
    rawMetrics: input.rawMetrics,
    normalizedMetrics: input.normalizedMetrics,
    weight: input.weight,
    amplification: input.amplification,
    evidence: input.evidence,
    confidence: clampConfidence(input.confidence),
  }));

  if (strengthTotal <= 0 || totalScore <= 0) {
    return traces;
  }

  const scored = positiveInputs.map((input) => ({
    factorId: input.factorId,
    contribution: (totalScore * input.strength) / strengthTotal,
  }));

  let distributed = 0;
  for (let index = 0; index < scored.length; index += 1) {
    const current = scored[index];
    if (current === undefined) {
      continue;
    }

    const traceIndex = traces.findIndex((trace) => trace.factorId === current.factorId);
    if (traceIndex < 0) {
      continue;
    }
    const existing = traces[traceIndex];
    if (existing === undefined) {
      continue;
    }

    if (index === scored.length - 1) {
      const remaining = round4(totalScore - distributed);
      traces[traceIndex] = {
        ...existing,
        contribution: Math.max(0, remaining),
      };
      distributed += Math.max(0, remaining);
      continue;
    }

    const rounded = round4(current.contribution);
    traces[traceIndex] = {
      ...existing,
      contribution: rounded,
    };
    distributed += rounded;
  }

  return traces;
};

const buildReductionLevers = (factors: readonly RiskFactorTrace[]): readonly { factorId: string; estimatedImpact: number }[] =>
  factors
    .filter((factor) => factor.contribution > 0)
    .sort(
      (a, b) => b.contribution - a.contribution || a.factorId.localeCompare(b.factorId),
    )
    .slice(0, 3)
    .map((factor) => ({
      factorId: factor.factorId,
      estimatedImpact: round4(factor.contribution),
    }));

const buildTargetTrace = (
  targetType: TargetTrace["targetType"],
  targetId: string,
  totalScore: number,
  normalizedScore: number,
  factors: readonly RiskFactorTrace[],
): TargetTrace => {
  const dominantFactors = [...factors]
    .filter((factor) => factor.contribution > 0)
    .sort(
      (a, b) => b.contribution - a.contribution || a.factorId.localeCompare(b.factorId),
    )
    .slice(0, 3)
    .map((factor) => factor.factorId);

  return {
    targetType,
    targetId,
    totalScore: round4(totalScore),
    normalizedScore: round4(normalizedScore),
    factors,
    dominantFactors,
    reductionLevers: buildReductionLevers(factors),
  };
};

const computeDependencyScores = (
  external: ExternalAnalysisSummary,
  config: RiskEngineConfig,
): DependencyScoreComputation => {
  if (!external.available) {
    return {
      dependencyScores: [],
      repositoryExternalPressure: 0,
      dependencyContexts: new Map(),
    };
  }

  const transitiveCounts = external.dependencies.map((dependency) =>
    logScale(dependency.transitiveDependencies.length),
  );
  const dependentCounts = external.dependencies.map((dependency) => logScale(dependency.dependents));
  const chainDepths = external.dependencies.map((dependency) => dependency.dependencyDepth);

  const transitiveScale = buildQuantileScale(
    transitiveCounts,
    config.quantileClamp.lower,
    config.quantileClamp.upper,
  );
  const dependentScale = buildQuantileScale(
    dependentCounts,
    config.quantileClamp.lower,
    config.quantileClamp.upper,
  );
  const chainDepthScale = buildQuantileScale(
    chainDepths,
    config.quantileClamp.lower,
    config.quantileClamp.upper,
  );

  const dependencyContexts = new Map<
    string,
    {
      signalScore: number;
      stalenessRisk: number;
      maintainerConcentrationRisk: number;
      transitiveBurdenRisk: number;
      centralityRisk: number;
      chainDepthRisk: number;
      busFactorRisk: number;
      popularityDampener: number;
      rawMetrics: {
        daysSinceLastRelease: number | null;
        maintainerCount: number | null;
        transitiveCount: number;
        dependents: number;
        dependencyDepth: number;
        busFactor: number | null;
        weeklyDownloads: number | null;
      };
      confidence: number;
    }
  >();

  const dependencyScores = external.dependencies
    .map<DependencyRiskScore>((dependency) => {
      const signalScore = computeDependencySignalScore(
        dependency.ownRiskSignals,
        dependency.inheritedRiskSignals,
        config.dependencySignals.inheritedSignalMultiplier,
      );

      const maintainerConcentrationRisk =
        dependency.maintainerCount === null
          ? config.dependencySignals.missingMetadataPenalty
          : toUnitInterval(1 / Math.max(1, dependency.maintainerCount));

      const stalenessRisk =
        dependency.daysSinceLastRelease === null
          ? config.dependencySignals.missingMetadataPenalty
          : halfLifeRisk(
              dependency.daysSinceLastRelease,
              config.dependencySignals.abandonedHalfLifeDays,
            );

      const transitiveBurdenRisk = normalizeWithScale(
        logScale(dependency.transitiveDependencies.length),
        transitiveScale,
      );

      const centralityRisk = normalizeWithScale(logScale(dependency.dependents), dependentScale);
      const chainDepthRisk = normalizeWithScale(dependency.dependencyDepth, chainDepthScale);

      const busFactorRisk =
        dependency.busFactor === null
          ? config.dependencySignals.missingMetadataPenalty
          : toUnitInterval(1 / Math.max(1, dependency.busFactor));

      const weights = config.dependencyFactorWeights;
      const baseScore = toUnitInterval(
        signalScore * weights.signals +
          stalenessRisk * weights.staleness +
          maintainerConcentrationRisk * weights.maintainerConcentration +
          transitiveBurdenRisk * weights.transitiveBurden +
          centralityRisk * weights.centrality +
          chainDepthRisk * weights.chainDepth +
          busFactorRisk * weights.busFactorRisk,
      );

      const hasHardRiskSignal =
        dependency.ownRiskSignals.includes("abandoned") ||
        dependency.ownRiskSignals.includes("metadata_unavailable") ||
        dependency.ownRiskSignals.includes("single_maintainer");

      const popularityDampener =
        dependency.weeklyDownloads === null || hasHardRiskSignal
          ? 1
          : 1 -
            halfLifeRisk(
              dependency.weeklyDownloads,
              config.dependencySignals.popularityHalfLifeDownloads,
            ) *
              config.dependencySignals.popularityMaxDampening;
      const normalizedScore = toUnitInterval(baseScore * popularityDampener);

      const availableMetricCount = [
        dependency.daysSinceLastRelease,
        dependency.maintainerCount,
        dependency.busFactor,
        dependency.weeklyDownloads,
      ].filter((value) => value !== null).length;
      const confidence = toUnitInterval(0.5 + availableMetricCount * 0.125);

      dependencyContexts.set(dependency.name, {
        signalScore: round4(signalScore),
        stalenessRisk: round4(stalenessRisk),
        maintainerConcentrationRisk: round4(maintainerConcentrationRisk),
        transitiveBurdenRisk: round4(transitiveBurdenRisk),
        centralityRisk: round4(centralityRisk),
        chainDepthRisk: round4(chainDepthRisk),
        busFactorRisk: round4(busFactorRisk),
        popularityDampener: round4(popularityDampener),
        rawMetrics: {
          daysSinceLastRelease: dependency.daysSinceLastRelease,
          maintainerCount: dependency.maintainerCount,
          transitiveCount: dependency.transitiveDependencies.length,
          dependents: dependency.dependents,
          dependencyDepth: dependency.dependencyDepth,
          busFactor: dependency.busFactor,
          weeklyDownloads: dependency.weeklyDownloads,
        },
        confidence: round4(confidence),
      });

      return {
        dependency: dependency.name,
        score: round4(normalizedScore * 100),
        normalizedScore: round4(normalizedScore),
        ownRiskSignals: dependency.ownRiskSignals,
        inheritedRiskSignals: dependency.inheritedRiskSignals,
      };
    })
    .sort(
      (a, b) =>
        b.normalizedScore - a.normalizedScore || a.dependency.localeCompare(b.dependency),
    );

  const normalizedValues = dependencyScores.map((score) => score.normalizedScore);
  const highDependencyRisk =
    dependencyScores.length === 0
      ? 0
      : percentile(normalizedValues, config.externalDimension.topDependencyPercentile);
  const averageDependencyRisk = average(normalizedValues);
  const depthRisk = halfLifeRisk(
    external.metrics.dependencyDepth,
    config.externalDimension.dependencyDepthHalfLife,
  );

  const repositoryExternalPressure = toUnitInterval(
    highDependencyRisk * 0.5 + averageDependencyRisk * 0.3 + depthRisk * 0.2,
  );

  return {
    dependencyScores,
    repositoryExternalPressure: round4(repositoryExternalPressure),
    dependencyContexts,
  };
};

const mapEvolutionByFile = (
  evolution: RepositoryEvolutionSummary,
): ReadonlyMap<string, FileEvolutionMetrics> => {
  if (!evolution.available) {
    return new Map<string, FileEvolutionMetrics>();
  }

  return new Map(
    evolution.files.map((fileMetrics) => [normalizePath(fileMetrics.filePath), fileMetrics]),
  );
};

const computeEvolutionScales = (
  evolutionByFile: ReadonlyMap<string, FileEvolutionMetrics>,
  config: RiskEngineConfig,
): MetricScales => {
  const evolutionFiles = [...evolutionByFile.values()];

  return {
    commitCount: buildQuantileScale(
      evolutionFiles.map((metrics) => logScale(metrics.commitCount)),
      config.quantileClamp.lower,
      config.quantileClamp.upper,
    ),
    churnTotal: buildQuantileScale(
      evolutionFiles.map((metrics) => logScale(metrics.churnTotal)),
      config.quantileClamp.lower,
      config.quantileClamp.upper,
    ),
    busFactor: buildQuantileScale(
      evolutionFiles.map((metrics) => metrics.busFactor),
      config.quantileClamp.lower,
      config.quantileClamp.upper,
    ),
  };
};

const inferModuleName = (filePath: string, config: RiskEngineConfig): string => {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/").filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return config.module.rootLabel;
  }

  const first = parts[0];
  if (first === undefined) {
    return config.module.rootLabel;
  }

  if (!config.module.commonSourceRoots.includes(first)) {
    return first;
  }

  if (parts.length <= config.module.maxPrefixSegments) {
    return first;
  }

  return parts.slice(0, config.module.maxPrefixSegments).join("/");
};

const buildFragileClusters = (
  structural: GraphAnalysisSummary,
  evolution: RepositoryEvolutionSummary,
  fileScoresByFile: ReadonlyMap<string, FileRiskScore>,
  config: RiskEngineConfig,
): readonly FragileCluster[] => {
  const clusters: FragileCluster[] = [];

  let cycleClusterCount = 0;
  for (const cycle of structural.cycles) {
    const files = [...new Set(cycle.nodes.map((node) => normalizePath(node)))].filter((filePath) =>
      fileScoresByFile.has(filePath),
    );

    if (files.length < 2) {
      continue;
    }

    files.sort((a, b) => a.localeCompare(b));

    const averageRisk = average(
      files.map((filePath) => fileScoresByFile.get(filePath)?.normalizedScore ?? 0),
    );

    const cycleSizeRisk = toUnitInterval((files.length - 1) / 5);
    const score = round4(toUnitInterval(averageRisk * 0.75 + cycleSizeRisk * 0.25) * 100);

    cycleClusterCount += 1;
    clusters.push({
      id: `cycle:${cycleClusterCount}`,
      kind: "structural_cycle",
      files,
      score,
    });
  }

  if (evolution.available && evolution.coupling.pairs.length > 0) {
    const candidates = evolution.coupling.pairs.filter(
      (pair) => pair.coChangeCommits >= config.couplingCluster.minCoChangeCommits,
    );

    const threshold = Math.max(
      config.couplingCluster.floorScore,
      percentile(
        candidates.map((pair) => pair.couplingScore),
        config.couplingCluster.percentileThreshold,
      ),
    );

    const selectedPairs = candidates
      .filter((pair) => pair.couplingScore >= threshold)
      .map((pair) => ({
        fileA: normalizePath(pair.fileA),
        fileB: normalizePath(pair.fileB),
        couplingScore: pair.couplingScore,
      }))
      .filter(
        (pair) =>
          pair.fileA !== pair.fileB &&
          fileScoresByFile.has(pair.fileA) &&
          fileScoresByFile.has(pair.fileB),
      );

    const adjacency = new Map<string, Set<string>>();
    for (const pair of selectedPairs) {
      const aNeighbors = adjacency.get(pair.fileA) ?? new Set<string>();
      aNeighbors.add(pair.fileB);
      adjacency.set(pair.fileA, aNeighbors);

      const bNeighbors = adjacency.get(pair.fileB) ?? new Set<string>();
      bNeighbors.add(pair.fileA);
      adjacency.set(pair.fileB, bNeighbors);
    }

    const visited = new Set<string>();
    let couplingClusterCount = 0;

    const orderedStarts = [...adjacency.keys()].sort((a, b) => a.localeCompare(b));
    for (const start of orderedStarts) {
      if (visited.has(start)) {
        continue;
      }

      const stack = [start];
      const files: string[] = [];

      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined || visited.has(current)) {
          continue;
        }

        visited.add(current);
        files.push(current);

        const neighbors = adjacency.get(current);
        if (neighbors === undefined) {
          continue;
        }

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }

      if (files.length < 2) {
        continue;
      }

      files.sort((a, b) => a.localeCompare(b));
      const fileSet = new Set(files);
      const componentPairs = selectedPairs.filter(
        (pair) => fileSet.has(pair.fileA) && fileSet.has(pair.fileB),
      );

      const meanFileRisk = average(
        files.map((filePath) => fileScoresByFile.get(filePath)?.normalizedScore ?? 0),
      );
      const meanCoupling = average(componentPairs.map((pair) => pair.couplingScore));

      const score = round4(toUnitInterval(meanFileRisk * 0.65 + meanCoupling * 0.35) * 100);

      couplingClusterCount += 1;
      clusters.push({
        id: `coupling:${couplingClusterCount}`,
        kind: "change_coupling",
        files,
        score,
      });
    }
  }

  return clusters.sort(
    (a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
};

export const computeRiskSummary = (
  structural: GraphAnalysisSummary,
  evolution: RepositoryEvolutionSummary,
  external: ExternalAnalysisSummary,
  config: RiskEngineConfig,
  traceCollector?: TraceCollector,
): RepositoryRiskSummary => {
  const collector = traceCollector;
  const dependencyComputation = computeDependencyScores(external, config);
  const evolutionByFile = mapEvolutionByFile(evolution);
  const evolutionScales = computeEvolutionScales(evolutionByFile, config);

  const cycleFileSet = new Set(
    structural.cycles.flatMap((cycle) => cycle.nodes.map((node) => normalizePath(node))),
  );

  const fanInScale = buildQuantileScale(
    structural.files.map((file) => logScale(file.fanIn)),
    config.quantileClamp.lower,
    config.quantileClamp.upper,
  );
  const fanOutScale = buildQuantileScale(
    structural.files.map((file) => logScale(file.fanOut)),
    config.quantileClamp.lower,
    config.quantileClamp.upper,
  );
  const depthScale = buildQuantileScale(
    structural.files.map((file) => file.depth),
    config.quantileClamp.lower,
    config.quantileClamp.upper,
  );

  const dimensionWeights = normalizeWeights(config.dimensionWeights, {
    structural: true,
    evolution: evolution.available,
    external: external.available,
  });

  const fileRiskContexts = structural.files
    .map<FileRiskContext>((file) => {
      const filePath = normalizePath(file.id);
      const inCycle = cycleFileSet.has(filePath) ? 1 : 0;

      const fanInRisk = normalizeWithScale(logScale(file.fanIn), fanInScale);
      const fanOutRisk = normalizeWithScale(logScale(file.fanOut), fanOutScale);
      const depthRisk = normalizeWithScale(file.depth, depthScale);

      const structuralWeights = config.structuralFactorWeights;
      const structuralFactor = toUnitInterval(
        fanInRisk * structuralWeights.fanIn +
          fanOutRisk * structuralWeights.fanOut +
          depthRisk * structuralWeights.depth +
          inCycle * structuralWeights.cycleParticipation,
      );

      const structuralCentrality = toUnitInterval((fanInRisk + fanOutRisk) / 2);

      let evolutionFactor = 0;
      let frequencyRisk = 0;
      let churnRisk = 0;
      let volatilityRisk = 0;
      let ownershipConcentrationRisk = 0;
      let busFactorRisk = 0;
      const evolutionMetrics = evolutionByFile.get(filePath);
      if (evolution.available && evolutionMetrics !== undefined) {
        frequencyRisk = normalizeWithScale(logScale(evolutionMetrics.commitCount), evolutionScales.commitCount);
        churnRisk = normalizeWithScale(logScale(evolutionMetrics.churnTotal), evolutionScales.churnTotal);
        volatilityRisk = toUnitInterval(evolutionMetrics.recentVolatility);
        ownershipConcentrationRisk = toUnitInterval(evolutionMetrics.topAuthorShare);
        busFactorRisk = toUnitInterval(
          1 - normalizeWithScale(evolutionMetrics.busFactor, evolutionScales.busFactor),
        );

        const evolutionWeights = config.evolutionFactorWeights;
        evolutionFactor = toUnitInterval(
          frequencyRisk * evolutionWeights.frequency +
            churnRisk * evolutionWeights.churn +
            volatilityRisk * evolutionWeights.recentVolatility +
            ownershipConcentrationRisk * evolutionWeights.ownershipConcentration +
            busFactorRisk * evolutionWeights.busFactorRisk,
        );
      }

      const dependencyAffinity = toUnitInterval(structuralCentrality * 0.6 + evolutionFactor * 0.4);
      const externalFactor = external.available
        ? toUnitInterval(dependencyComputation.repositoryExternalPressure * dependencyAffinity)
        : 0;

      const structuralBase = structuralFactor * dimensionWeights.structural;
      const evolutionBase = evolutionFactor * dimensionWeights.evolution;
      const externalBase = externalFactor * dimensionWeights.external;
      const baseline = structuralBase + evolutionBase + externalBase;

      const interactionStructuralEvolution =
        structuralFactor * evolutionFactor * config.interactionWeights.structuralEvolution;
      const interactionCentralInstability =
        structuralCentrality * evolutionFactor * config.interactionWeights.centralInstability;
      const interactionDependencyAmplification =
        externalFactor *
        Math.max(structuralFactor, evolutionFactor) *
        config.interactionWeights.dependencyAmplification;

      const interactions = [
        interactionStructuralEvolution,
        interactionCentralInstability,
        interactionDependencyAmplification,
      ];

      const normalizedScore = saturatingComposite(baseline, interactions);

      return {
        file: filePath,
        score: round4(normalizedScore * 100),
        normalizedScore: round4(normalizedScore),
        factors: {
          structural: round4(structuralFactor),
          evolution: round4(evolutionFactor),
          external: round4(externalFactor),
        },
        structuralCentrality: round4(structuralCentrality),
        traceTerms: {
          structuralBase: round4(structuralBase),
          evolutionBase: round4(evolutionBase),
          externalBase: round4(externalBase),
          interactionStructuralEvolution: round4(interactionStructuralEvolution),
          interactionCentralInstability: round4(interactionCentralInstability),
          interactionDependencyAmplification: round4(interactionDependencyAmplification),
        },
        rawMetrics: {
          fanIn: file.fanIn,
          fanOut: file.fanOut,
          depth: file.depth,
          cycleParticipation: inCycle,
          commitCount: evolutionMetrics?.commitCount ?? null,
          churnTotal: evolutionMetrics?.churnTotal ?? null,
          recentVolatility: evolutionMetrics?.recentVolatility ?? null,
          topAuthorShare: evolutionMetrics?.topAuthorShare ?? null,
          busFactor: evolutionMetrics?.busFactor ?? null,
          dependencyAffinity: round4(dependencyAffinity),
          repositoryExternalPressure: round4(dependencyComputation.repositoryExternalPressure),
        },
        normalizedMetrics: {
          fanInRisk: round4(fanInRisk),
          fanOutRisk: round4(fanOutRisk),
          depthRisk: round4(depthRisk),
          frequencyRisk: round4(frequencyRisk),
          churnRisk: round4(churnRisk),
          volatilityRisk: round4(volatilityRisk),
          ownershipConcentrationRisk: round4(ownershipConcentrationRisk),
          busFactorRisk: round4(busFactorRisk),
        },
      };
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const fileScores: FileRiskScore[] = fileRiskContexts.map((context) => ({
    file: context.file,
    score: context.score,
    normalizedScore: context.normalizedScore,
    factors: context.factors,
  }));

  if (collector !== undefined) {
    for (const context of fileRiskContexts) {
      const evidence: EvidenceRef[] = [
        { kind: "file_metric", target: context.file, metric: "fanIn" },
        { kind: "file_metric", target: context.file, metric: "fanOut" },
        { kind: "file_metric", target: context.file, metric: "depth" },
      ];

      if (context.rawMetrics.cycleParticipation > 0) {
        evidence.push({
          kind: "graph_cycle",
          cycleId: `file:${context.file}`,
          files: [context.file],
        });
      }

      const fileFactors = buildFactorTraces(context.score, [
        {
          factorId: "file.structural",
          family: "structural",
          strength: context.traceTerms.structuralBase,
          rawMetrics: {
            fanIn: context.rawMetrics.fanIn,
            fanOut: context.rawMetrics.fanOut,
            depth: context.rawMetrics.depth,
            cycleParticipation: context.rawMetrics.cycleParticipation,
          },
          normalizedMetrics: {
            fanInRisk: context.normalizedMetrics.fanInRisk,
            fanOutRisk: context.normalizedMetrics.fanOutRisk,
            depthRisk: context.normalizedMetrics.depthRisk,
            structuralFactor: context.factors.structural,
          },
          weight: dimensionWeights.structural,
          amplification: null,
          evidence,
          confidence: 1,
        },
        {
          factorId: "file.evolution",
          family: "evolution",
          strength: context.traceTerms.evolutionBase,
          rawMetrics: {
            commitCount: context.rawMetrics.commitCount,
            churnTotal: context.rawMetrics.churnTotal,
            recentVolatility: context.rawMetrics.recentVolatility,
            topAuthorShare: context.rawMetrics.topAuthorShare,
            busFactor: context.rawMetrics.busFactor,
          },
          normalizedMetrics: {
            frequencyRisk: context.normalizedMetrics.frequencyRisk,
            churnRisk: context.normalizedMetrics.churnRisk,
            volatilityRisk: context.normalizedMetrics.volatilityRisk,
            ownershipConcentrationRisk: context.normalizedMetrics.ownershipConcentrationRisk,
            busFactorRisk: context.normalizedMetrics.busFactorRisk,
            evolutionFactor: context.factors.evolution,
          },
          weight: dimensionWeights.evolution,
          amplification: null,
          evidence: [{ kind: "file_metric", target: context.file, metric: "commitCount" }],
          confidence: evolution.available ? 1 : 0,
        },
        {
          factorId: "file.external",
          family: "external",
          strength: context.traceTerms.externalBase,
          rawMetrics: {
            repositoryExternalPressure: context.rawMetrics.repositoryExternalPressure,
            dependencyAffinity: context.rawMetrics.dependencyAffinity,
          },
          normalizedMetrics: {
            externalFactor: context.factors.external,
          },
          weight: dimensionWeights.external,
          amplification: null,
          evidence: [{ kind: "repository_metric", metric: "repositoryExternalPressure" }],
          confidence: external.available ? 0.7 : 0,
        },
        {
          factorId: "file.composite.interactions",
          family: "composite",
          strength:
            context.traceTerms.interactionStructuralEvolution +
            context.traceTerms.interactionCentralInstability +
            context.traceTerms.interactionDependencyAmplification,
          rawMetrics: {
            structuralEvolutionInteraction: context.traceTerms.interactionStructuralEvolution,
            centralInstabilityInteraction: context.traceTerms.interactionCentralInstability,
            dependencyAmplificationInteraction: context.traceTerms.interactionDependencyAmplification,
          },
          normalizedMetrics: {},
          weight: null,
          amplification:
            config.interactionWeights.structuralEvolution +
            config.interactionWeights.centralInstability +
            config.interactionWeights.dependencyAmplification,
          evidence: [{ kind: "repository_metric", metric: "interactionWeights" }],
          confidence: 0.9,
        },
      ]);

      collector.record(
        buildTargetTrace("file", context.file, context.score, context.normalizedScore, fileFactors),
      );
    }
  }

  const fileScoresByFile = new Map(fileScores.map((fileScore) => [fileScore.file, fileScore]));

  const hotspotsCount = Math.min(
    config.hotspotMaxFiles,
    Math.max(config.hotspotMinFiles, Math.ceil(fileScores.length * config.hotspotTopPercent)),
  );

  const hotspots = fileScores.slice(0, hotspotsCount).map((fileScore) => ({
    file: fileScore.file,
    score: fileScore.score,
    factors: fileScore.factors,
  }));

  const moduleFiles = new Map<string, number[]>();
  for (const fileScore of fileScores) {
    const moduleName = inferModuleName(fileScore.file, config);
    const values = moduleFiles.get(moduleName) ?? [];
    values.push(fileScore.normalizedScore);
    moduleFiles.set(moduleName, values);
  }

  const moduleScores: ModuleRiskScore[] = [...moduleFiles.entries()]
    .map(([module, values]) => {
      const averageScore = average(values);
      const peakScore = values.reduce((max, value) => Math.max(max, value), 0);
      const normalizedScore = toUnitInterval(averageScore * 0.65 + peakScore * 0.35);

      return {
        module,
        score: round4(normalizedScore * 100),
        normalizedScore: round4(normalizedScore),
        fileCount: values.length,
      };
    })
    .sort((a, b) => b.score - a.score || a.module.localeCompare(b.module));

  if (collector !== undefined) {
    for (const [module, values] of moduleFiles.entries()) {
      const averageScore = average(values);
      const peakScore = values.reduce((max, value) => Math.max(max, value), 0);
      const normalizedScore = toUnitInterval(averageScore * 0.65 + peakScore * 0.35);
      const totalScore = round4(normalizedScore * 100);
      const factors = buildFactorTraces(totalScore, [
        {
          factorId: "module.average_file_risk",
          family: "composite",
          strength: averageScore * 0.65,
          rawMetrics: { averageFileRisk: round4(averageScore), fileCount: values.length },
          normalizedMetrics: { normalizedModuleRisk: round4(normalizedScore) },
          weight: 0.65,
          amplification: null,
          evidence: [{ kind: "repository_metric", metric: "moduleAggregation.average" }],
          confidence: 1,
        },
        {
          factorId: "module.peak_file_risk",
          family: "composite",
          strength: peakScore * 0.35,
          rawMetrics: { peakFileRisk: round4(peakScore), fileCount: values.length },
          normalizedMetrics: { normalizedModuleRisk: round4(normalizedScore) },
          weight: 0.35,
          amplification: null,
          evidence: [{ kind: "repository_metric", metric: "moduleAggregation.peak" }],
          confidence: 1,
        },
      ]);

      collector.record(buildTargetTrace("module", module, totalScore, normalizedScore, factors));
    }
  }

  const fragileClusters = buildFragileClusters(structural, evolution, fileScoresByFile, config);

  const externalPressures = fileScores.map((fileScore) => fileScore.factors.external);
  const pressureThreshold = Math.max(
    config.amplificationZone.pressureFloor,
    percentile(externalPressures, config.amplificationZone.percentileThreshold),
  );

  const dependencyAmplificationZones = fileScores
    .map((fileScore) => {
      const intensity = toUnitInterval(
        fileScore.factors.external * Math.max(fileScore.factors.structural, fileScore.factors.evolution),
      );
      const normalizedZoneScore = toUnitInterval(intensity * 0.7 + fileScore.normalizedScore * 0.3);

      return {
        file: fileScore.file,
        score: round4(normalizedZoneScore * 100),
        externalPressure: fileScore.factors.external,
      };
    })
    .filter((zone) => external.available && zone.externalPressure >= pressureThreshold)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, config.amplificationZone.maxZones)
    .map((zone) => ({
      ...zone,
      externalPressure: round4(zone.externalPressure),
    }));

  if (collector !== undefined && external.available) {
    const dependencyByName = new Map(external.dependencies.map((dependency) => [dependency.name, dependency]));
    for (const dependencyScore of dependencyComputation.dependencyScores) {
      const dependency = dependencyByName.get(dependencyScore.dependency);
      const context = dependencyComputation.dependencyContexts.get(dependencyScore.dependency);
      if (dependency === undefined || context === undefined) {
        continue;
      }

      const hasMetadata = context.rawMetrics.daysSinceLastRelease !== null && context.rawMetrics.maintainerCount !== null;
      const factors = buildFactorTraces(dependencyScore.score, [
        {
          factorId: "dependency.signals",
          family: "external",
          strength: context.signalScore * config.dependencyFactorWeights.signals,
          rawMetrics: {
            ownSignals: dependency.ownRiskSignals.length,
            inheritedSignals: dependency.inheritedRiskSignals.length,
          },
          normalizedMetrics: { signalScore: context.signalScore },
          weight: config.dependencyFactorWeights.signals,
          amplification: config.dependencySignals.inheritedSignalMultiplier,
          evidence: [{ kind: "dependency_metric", target: dependency.name, metric: "riskSignals" }],
          confidence: 0.95,
        },
        {
          factorId: "dependency.staleness",
          family: "external",
          strength: context.stalenessRisk * config.dependencyFactorWeights.staleness,
          rawMetrics: { daysSinceLastRelease: context.rawMetrics.daysSinceLastRelease },
          normalizedMetrics: { stalenessRisk: context.stalenessRisk },
          weight: config.dependencyFactorWeights.staleness,
          amplification: null,
          evidence: [{ kind: "dependency_metric", target: dependency.name, metric: "daysSinceLastRelease" }],
          confidence: hasMetadata ? 0.9 : 0.5,
        },
        {
          factorId: "dependency.maintainer_concentration",
          family: "external",
          strength:
            context.maintainerConcentrationRisk * config.dependencyFactorWeights.maintainerConcentration,
          rawMetrics: { maintainerCount: context.rawMetrics.maintainerCount },
          normalizedMetrics: {
            maintainerConcentrationRisk: context.maintainerConcentrationRisk,
          },
          weight: config.dependencyFactorWeights.maintainerConcentration,
          amplification: null,
          evidence: [{ kind: "dependency_metric", target: dependency.name, metric: "maintainerCount" }],
          confidence: hasMetadata ? 0.9 : 0.5,
        },
        {
          factorId: "dependency.topology",
          family: "external",
          strength:
            context.transitiveBurdenRisk * config.dependencyFactorWeights.transitiveBurden +
            context.centralityRisk * config.dependencyFactorWeights.centrality +
            context.chainDepthRisk * config.dependencyFactorWeights.chainDepth,
          rawMetrics: {
            transitiveCount: context.rawMetrics.transitiveCount,
            dependents: context.rawMetrics.dependents,
            dependencyDepth: context.rawMetrics.dependencyDepth,
          },
          normalizedMetrics: {
            transitiveBurdenRisk: context.transitiveBurdenRisk,
            centralityRisk: context.centralityRisk,
            chainDepthRisk: context.chainDepthRisk,
          },
          weight:
            config.dependencyFactorWeights.transitiveBurden +
            config.dependencyFactorWeights.centrality +
            config.dependencyFactorWeights.chainDepth,
          amplification: null,
          evidence: [{ kind: "dependency_metric", target: dependency.name, metric: "dependencyDepth" }],
          confidence: 1,
        },
        {
          factorId: "dependency.bus_factor",
          family: "external",
          strength: context.busFactorRisk * config.dependencyFactorWeights.busFactorRisk,
          rawMetrics: { busFactor: context.rawMetrics.busFactor },
          normalizedMetrics: { busFactorRisk: context.busFactorRisk },
          weight: config.dependencyFactorWeights.busFactorRisk,
          amplification: null,
          evidence: [{ kind: "dependency_metric", target: dependency.name, metric: "busFactor" }],
          confidence: context.rawMetrics.busFactor === null ? 0.5 : 0.85,
        },
        {
          factorId: "dependency.popularity_dampening",
          family: "composite",
          strength: 1 - context.popularityDampener,
          rawMetrics: { weeklyDownloads: context.rawMetrics.weeklyDownloads },
          normalizedMetrics: { popularityDampener: context.popularityDampener },
          weight: config.dependencySignals.popularityMaxDampening,
          amplification: null,
          evidence: [{ kind: "dependency_metric", target: dependency.name, metric: "weeklyDownloads" }],
          confidence: context.rawMetrics.weeklyDownloads === null ? 0.4 : 0.9,
        },
      ]);

      collector.record(
        buildTargetTrace(
          "dependency",
          dependencyScore.dependency,
          dependencyScore.score,
          dependencyScore.normalizedScore,
          factors,
        ),
      );
    }
  }

  const structuralDimension = average(fileScores.map((fileScore) => fileScore.factors.structural));
  const evolutionDimension = average(fileScores.map((fileScore) => fileScore.factors.evolution));
  const externalDimension = dependencyComputation.repositoryExternalPressure;

  const topCentralSlice = Math.max(1, Math.ceil(fileRiskContexts.length * 0.1));
  const criticalInstability = average(
    [...fileRiskContexts]
      .sort(
        (a, b) =>
          b.structuralCentrality * b.factors.evolution - a.structuralCentrality * a.factors.evolution ||
          a.file.localeCompare(b.file),
      )
      .slice(0, topCentralSlice)
      .map((context) => context.structuralCentrality * context.factors.evolution),
  );

  const dependencyAmplification = average(
    dependencyAmplificationZones.map((zone) =>
      toUnitInterval((zone.externalPressure * zone.score) / 100),
    ),
  );

  const repositoryBaseline =
    structuralDimension * dimensionWeights.structural +
    evolutionDimension * dimensionWeights.evolution +
    externalDimension * dimensionWeights.external;

  const repositoryNormalizedScore = saturatingComposite(repositoryBaseline, [
    structuralDimension * evolutionDimension * config.interactionWeights.structuralEvolution,
    criticalInstability * config.interactionWeights.centralInstability,
    dependencyAmplification * config.interactionWeights.dependencyAmplification,
  ]);

  const repositoryScore = round4(repositoryNormalizedScore * 100);

  if (collector !== undefined) {
    const repositoryFactors = buildFactorTraces(repositoryScore, [
      {
        factorId: "repository.structural",
        family: "structural",
        strength: structuralDimension * dimensionWeights.structural,
        rawMetrics: { structuralDimension: round4(structuralDimension) },
        normalizedMetrics: { dimensionWeight: round4(dimensionWeights.structural) },
        weight: dimensionWeights.structural,
        amplification: null,
        evidence: [{ kind: "repository_metric", metric: "structuralDimension" }],
        confidence: 1,
      },
      {
        factorId: "repository.evolution",
        family: "evolution",
        strength: evolutionDimension * dimensionWeights.evolution,
        rawMetrics: { evolutionDimension: round4(evolutionDimension) },
        normalizedMetrics: { dimensionWeight: round4(dimensionWeights.evolution) },
        weight: dimensionWeights.evolution,
        amplification: null,
        evidence: [{ kind: "repository_metric", metric: "evolutionDimension" }],
        confidence: evolution.available ? 1 : 0,
      },
      {
        factorId: "repository.external",
        family: "external",
        strength: externalDimension * dimensionWeights.external,
        rawMetrics: { externalDimension: round4(externalDimension) },
        normalizedMetrics: { dimensionWeight: round4(dimensionWeights.external) },
        weight: dimensionWeights.external,
        amplification: null,
        evidence: [{ kind: "repository_metric", metric: "externalDimension" }],
        confidence: external.available ? 0.8 : 0,
      },
      {
        factorId: "repository.composite.interactions",
        family: "composite",
        strength:
          structuralDimension * evolutionDimension * config.interactionWeights.structuralEvolution +
          criticalInstability * config.interactionWeights.centralInstability +
          dependencyAmplification * config.interactionWeights.dependencyAmplification,
        rawMetrics: {
          structuralEvolution: round4(
            structuralDimension * evolutionDimension * config.interactionWeights.structuralEvolution,
          ),
          centralInstability: round4(
            criticalInstability * config.interactionWeights.centralInstability,
          ),
          dependencyAmplification: round4(
            dependencyAmplification * config.interactionWeights.dependencyAmplification,
          ),
        },
        normalizedMetrics: {
          criticalInstability: round4(criticalInstability),
          dependencyAmplification: round4(dependencyAmplification),
        },
        weight: null,
        amplification:
          config.interactionWeights.structuralEvolution +
          config.interactionWeights.centralInstability +
          config.interactionWeights.dependencyAmplification,
        evidence: [{ kind: "repository_metric", metric: "interactionTerms" }],
        confidence: 0.9,
      },
    ]);

    collector.record(
      buildTargetTrace(
        "repository",
        structural.targetPath,
        repositoryScore,
        repositoryNormalizedScore,
        repositoryFactors,
      ),
    );
  }

  return {
    repositoryScore,
    normalizedScore: round4(repositoryNormalizedScore),
    hotspots,
    fragileClusters,
    dependencyAmplificationZones,
    fileScores,
    moduleScores,
    dependencyScores: dependencyComputation.dependencyScores,
  };
};
