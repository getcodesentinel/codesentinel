import type {
  DependencyRiskScore,
  DependencyRiskSignal,
  ExternalAnalysisSummary,
  FileEvolutionMetrics,
  FileRiskScore,
  FragileCluster,
  GraphAnalysisSummary,
  ModuleRiskScore,
  RepositoryEvolutionSummary,
  RepositoryRiskSummary,
  RiskFactors,
} from "@codesentinel/core";
import type { RiskEngineConfig } from "../config.js";
import {
  average,
  clamp01,
  halfLifeRisk,
  normalizeWeights,
  percentile,
  round4,
  saturatingComposite,
} from "./math.js";
import { buildQuantileScale, logScale, normalizeWithScale } from "./normalization.js";

type DependencyScoreComputation = {
  dependencyScores: readonly DependencyRiskScore[];
  repositoryExternalPressure: number;
};

type FileRiskContext = {
  file: string;
  score: number;
  normalizedScore: number;
  factors: RiskFactors;
  structuralCentrality: number;
};

type MetricScales = {
  commitCount: ReturnType<typeof buildQuantileScale>;
  churnTotal: ReturnType<typeof buildQuantileScale>;
  busFactor: ReturnType<typeof buildQuantileScale>;
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

  return clamp01(weightedTotal / maxWeightedTotal);
};

const computeDependencyScores = (
  external: ExternalAnalysisSummary,
  config: RiskEngineConfig,
): DependencyScoreComputation => {
  if (!external.available) {
    return {
      dependencyScores: [],
      repositoryExternalPressure: 0,
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
          : clamp01(1 / Math.max(1, dependency.maintainerCount));

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
          : clamp01(1 / Math.max(1, dependency.busFactor));

      const weights = config.dependencyFactorWeights;
      const normalizedScore = clamp01(
        signalScore * weights.signals +
          stalenessRisk * weights.staleness +
          maintainerConcentrationRisk * weights.maintainerConcentration +
          transitiveBurdenRisk * weights.transitiveBurden +
          centralityRisk * weights.centrality +
          chainDepthRisk * weights.chainDepth +
          busFactorRisk * weights.busFactorRisk,
      );

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

  const repositoryExternalPressure = clamp01(
    highDependencyRisk * 0.5 + averageDependencyRisk * 0.3 + depthRisk * 0.2,
  );

  return {
    dependencyScores,
    repositoryExternalPressure: round4(repositoryExternalPressure),
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

    const cycleSizeRisk = clamp01((files.length - 1) / 5);
    const score = round4(clamp01(averageRisk * 0.75 + cycleSizeRisk * 0.25) * 100);

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

      const score = round4(clamp01(meanFileRisk * 0.65 + meanCoupling * 0.35) * 100);

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
): RepositoryRiskSummary => {
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
      const structuralFactor = clamp01(
        fanInRisk * structuralWeights.fanIn +
          fanOutRisk * structuralWeights.fanOut +
          depthRisk * structuralWeights.depth +
          inCycle * structuralWeights.cycleParticipation,
      );

      const structuralCentrality = clamp01((fanInRisk + fanOutRisk) / 2);

      let evolutionFactor = 0;
      const evolutionMetrics = evolutionByFile.get(filePath);
      if (evolution.available && evolutionMetrics !== undefined) {
        const frequencyRisk = normalizeWithScale(
          logScale(evolutionMetrics.commitCount),
          evolutionScales.commitCount,
        );
        const churnRisk = normalizeWithScale(
          logScale(evolutionMetrics.churnTotal),
          evolutionScales.churnTotal,
        );
        const volatilityRisk = clamp01(evolutionMetrics.recentVolatility);
        const ownershipConcentrationRisk = clamp01(evolutionMetrics.topAuthorShare);
        const busFactorRisk = clamp01(1 - normalizeWithScale(evolutionMetrics.busFactor, evolutionScales.busFactor));

        const evolutionWeights = config.evolutionFactorWeights;
        evolutionFactor = clamp01(
          frequencyRisk * evolutionWeights.frequency +
            churnRisk * evolutionWeights.churn +
            volatilityRisk * evolutionWeights.recentVolatility +
            ownershipConcentrationRisk * evolutionWeights.ownershipConcentration +
            busFactorRisk * evolutionWeights.busFactorRisk,
        );
      }

      const dependencyAffinity = clamp01(structuralCentrality * 0.6 + evolutionFactor * 0.4);
      const externalFactor = external.available
        ? clamp01(dependencyComputation.repositoryExternalPressure * dependencyAffinity)
        : 0;

      const baseline =
        structuralFactor * dimensionWeights.structural +
        evolutionFactor * dimensionWeights.evolution +
        externalFactor * dimensionWeights.external;

      const interactions = [
        structuralFactor * evolutionFactor * config.interactionWeights.structuralEvolution,
        structuralCentrality * evolutionFactor * config.interactionWeights.centralInstability,
        externalFactor * Math.max(structuralFactor, evolutionFactor) *
          config.interactionWeights.dependencyAmplification,
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
      };
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const fileScores: FileRiskScore[] = fileRiskContexts.map((context) => ({
    file: context.file,
    score: context.score,
    normalizedScore: context.normalizedScore,
    factors: context.factors,
  }));

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
      const normalizedScore = clamp01(averageScore * 0.65 + peakScore * 0.35);

      return {
        module,
        score: round4(normalizedScore * 100),
        normalizedScore: round4(normalizedScore),
        fileCount: values.length,
      };
    })
    .sort((a, b) => b.score - a.score || a.module.localeCompare(b.module));

  const fragileClusters = buildFragileClusters(structural, evolution, fileScoresByFile, config);

  const externalPressures = fileScores.map((fileScore) => fileScore.factors.external);
  const pressureThreshold = Math.max(
    config.amplificationZone.pressureFloor,
    percentile(externalPressures, config.amplificationZone.percentileThreshold),
  );

  const dependencyAmplificationZones = fileScores
    .map((fileScore) => {
      const intensity = clamp01(
        fileScore.factors.external * Math.max(fileScore.factors.structural, fileScore.factors.evolution),
      );
      const normalizedZoneScore = clamp01(intensity * 0.7 + fileScore.normalizedScore * 0.3);

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
      clamp01((zone.externalPressure * zone.score) / 100),
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

  return {
    repositoryScore: round4(repositoryNormalizedScore * 100),
    normalizedScore: round4(repositoryNormalizedScore),
    hotspots,
    fragileClusters,
    dependencyAmplificationZones,
    fileScores,
    moduleScores,
    dependencyScores: dependencyComputation.dependencyScores,
  };
};
