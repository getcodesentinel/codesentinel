import type {
  GraphAnalysisSummary,
  HealthDimension,
  HealthDimensionTrace,
  HealthEvidenceRef,
  HealthFactorTrace,
  HealthIssue,
  RepositoryEvolutionSummary,
  RepositoryHealthSummary,
} from "@codesentinel/core";
import { average, clamp01, concentration, round4 } from "../domain/math.js";

export type ComputeRepositoryHealthSummaryInput = {
  structural: GraphAnalysisSummary;
  evolution: RepositoryEvolutionSummary;
};

type HealthIssueWithImpact = HealthIssue & {
  impact: number;
};

type FactorSpec = {
  factorId: string;
  penalty: number;
  rawMetrics: Readonly<Record<string, number | null>>;
  normalizedMetrics: Readonly<Record<string, number | null>>;
  weight: number;
  evidence: readonly HealthEvidenceRef[];
};

const DIMENSION_WEIGHTS: Readonly<Record<HealthDimension, number>> = {
  modularity: 0.35,
  changeHygiene: 0.3,
  testHealth: 0.2,
  ownershipDistribution: 0.15,
};

const HEALTH_TRACE_VERSION = "1" as const;

const toPercentage = (normalizedHealth: number): number => round4(clamp01(normalizedHealth) * 100);

const dampenForSmallSamples = (
  penalty: number,
  sampleSize: number,
  warmupSize: number,
  minimumWeight = 0.35,
): number => {
  const reliability = clamp01(sampleSize / Math.max(1, warmupSize));
  const dampeningWeight = minimumWeight + (1 - minimumWeight) * reliability;
  return clamp01(penalty) * dampeningWeight;
};

const topPercentShare = (values: readonly number[], fraction: number): number => {
  const positive = values.filter((value) => value > 0).sort((a, b) => b - a);
  if (positive.length === 0) {
    return 0;
  }

  const topCount = Math.max(1, Math.ceil(positive.length * clamp01(fraction)));
  const total = positive.reduce((sum, value) => sum + value, 0);
  const topTotal = positive.slice(0, topCount).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }

  return clamp01(topTotal / total);
};

const normalizedEntropy = (weights: readonly number[]): number => {
  const positive = weights.filter((value) => value > 0);
  if (positive.length <= 1) {
    return 0;
  }

  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }

  const entropy = positive.reduce((sum, value) => {
    const p = value / total;
    return sum - p * Math.log(p);
  }, 0);
  return clamp01(entropy / Math.log(positive.length));
};

const toFactorTrace = (spec: FactorSpec): HealthFactorTrace => ({
  factorId: spec.factorId,
  contribution: round4(spec.penalty * spec.weight * 100),
  penalty: round4(spec.penalty),
  rawMetrics: spec.rawMetrics,
  normalizedMetrics: spec.normalizedMetrics,
  weight: round4(spec.weight),
  evidence: spec.evidence,
});

const createDimensionTrace = (
  dimension: HealthDimension,
  health: number,
  factors: readonly FactorSpec[],
): HealthDimensionTrace => ({
  dimension,
  normalizedScore: round4(clamp01(health)),
  score: toPercentage(health),
  factors: factors.map((factor) => toFactorTrace(factor)),
});

const filePaths = (structural: GraphAnalysisSummary): readonly string[] =>
  structural.files.map((file) => file.relativePath);

const normalizePath = (value: string): string => value.replaceAll("\\", "/").toLowerCase();

const isTestPath = (path: string): boolean => {
  const normalized = normalizePath(path);
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/test/") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.")
  );
};

const isSourcePath = (path: string): boolean => {
  if (path.endsWith(".d.ts")) {
    return false;
  }
  return !isTestPath(path);
};

const hasTestDirectory = (paths: readonly string[]): boolean =>
  paths.some((path) => {
    const normalized = normalizePath(path);
    return (
      normalized.includes("/__tests__/") ||
      normalized.includes("/tests/") ||
      normalized.includes("/test/")
    );
  });

const moduleNameFromPath = (path: string): string => {
  const normalized = path.replaceAll("\\", "/");
  const firstSegment = normalized.split("/")[0] ?? normalized;
  return firstSegment.length === 0 ? normalized : firstSegment;
};

const pushIssue = (
  issues: HealthIssueWithImpact[],
  issue: Omit<HealthIssueWithImpact, "severity"> & { severity?: HealthIssue["severity"] },
): void => {
  issues.push({
    ...issue,
    severity: issue.severity ?? "warn",
  });
};

const weightedPenalty = (factors: readonly FactorSpec[]): number =>
  clamp01(factors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0));

export const computeRepositoryHealthSummary = (
  input: ComputeRepositoryHealthSummaryInput,
): RepositoryHealthSummary => {
  const issues: HealthIssueWithImpact[] = [];
  const sourceFileSet = new Set(input.structural.files.map((file) => file.relativePath));

  const sourceFileCount = Math.max(1, input.structural.files.length);
  const structuralEdges = input.structural.edges;

  const cycleSets = input.structural.cycles
    .map((cycle) => new Set(cycle.nodes))
    .filter((set) => set.size >= 2);

  const cycleNodeSet = new Set<string>();
  for (const cycleSet of cycleSets) {
    for (const node of cycleSet) {
      cycleNodeSet.add(node);
    }
  }

  const edgesInsideCycles = structuralEdges.filter((edge) =>
    cycleSets.some((cycleSet) => cycleSet.has(edge.from) && cycleSet.has(edge.to)),
  ).length;

  const cycleEdgeRatio =
    structuralEdges.length === 0 ? 0 : clamp01(edgesInsideCycles / structuralEdges.length);
  const cycleNodeRatio = clamp01(cycleNodeSet.size / sourceFileCount);
  const cycleDensityPenalty = clamp01(
    clamp01(cycleEdgeRatio / 0.2) * 0.75 + clamp01(cycleNodeRatio / 0.35) * 0.25,
  );

  const fanInConcentration = concentration(input.structural.files.map((file) => file.fanIn));
  const fanOutConcentration = concentration(input.structural.files.map((file) => file.fanOut));
  const fanConcentration = average([fanInConcentration, fanOutConcentration]);

  const centralityPressure = input.structural.files.map((file) => file.fanIn + file.fanOut);
  const centralityConcentration = concentration(centralityPressure);

  let structuralHotspotOverlap = 0;
  if (input.evolution.available) {
    const evolutionSourceFiles = input.evolution.files.filter((file) =>
      sourceFileSet.has(file.filePath),
    );
    const topStructuralCount = Math.max(1, Math.ceil(sourceFileCount * 0.1));
    const topChangeCount = Math.max(1, Math.ceil(Math.max(1, evolutionSourceFiles.length) * 0.1));

    const topStructural = new Set(
      [...input.structural.files]
        .map((file) => ({
          filePath: file.relativePath,
          pressure: file.fanIn + file.fanOut,
        }))
        .sort((a, b) => b.pressure - a.pressure || a.filePath.localeCompare(b.filePath))
        .slice(0, topStructuralCount)
        .map((item) => item.filePath),
    );

    const topChange = new Set(
      [...evolutionSourceFiles]
        .sort((a, b) => b.churnTotal - a.churnTotal || a.filePath.localeCompare(b.filePath))
        .slice(0, topChangeCount)
        .map((item) => item.filePath),
    );

    const overlapCount = [...topStructural].filter((filePath) => topChange.has(filePath)).length;
    structuralHotspotOverlap =
      topStructural.size === 0 || topChange.size === 0
        ? 0
        : clamp01(overlapCount / Math.min(topStructural.size, topChange.size));
  }

  const modularityFactors: readonly FactorSpec[] = [
    {
      factorId: "health.modularity.cycle_density",
      penalty: cycleDensityPenalty,
      rawMetrics: {
        cycleCount: input.structural.metrics.cycleCount,
        cycleEdgeRatio: round4(cycleEdgeRatio),
        cycleNodeRatio: round4(cycleNodeRatio),
      },
      normalizedMetrics: {
        cycleDensityPenalty: round4(cycleDensityPenalty),
      },
      weight: 0.4,
      evidence: [{ kind: "repository_metric", metric: "structural.cycleEdgeRatio" }],
    },
    {
      factorId: "health.modularity.fan_concentration",
      penalty: fanConcentration,
      rawMetrics: {
        fanInConcentration: round4(fanInConcentration),
        fanOutConcentration: round4(fanOutConcentration),
      },
      normalizedMetrics: {
        fanConcentration: round4(fanConcentration),
      },
      weight: 0.25,
      evidence: [{ kind: "repository_metric", metric: "structural.files.fanIn/fanOut" }],
    },
    {
      factorId: "health.modularity.centrality_concentration",
      penalty: centralityConcentration,
      rawMetrics: {
        centralityConcentration: round4(centralityConcentration),
      },
      normalizedMetrics: {
        centralityConcentration: round4(centralityConcentration),
      },
      weight: 0.2,
      evidence: [{ kind: "repository_metric", metric: "structural.centralityPressure" }],
    },
    {
      factorId: "health.modularity.hotspot_overlap",
      penalty: structuralHotspotOverlap,
      rawMetrics: {
        structuralHotspotOverlap: round4(structuralHotspotOverlap),
      },
      normalizedMetrics: {
        structuralHotspotOverlap: round4(structuralHotspotOverlap),
      },
      weight: 0.15,
      evidence: [{ kind: "repository_metric", metric: "structural.evolution.hotspotOverlap" }],
    },
  ];

  const modularityPenalty = dampenForSmallSamples(
    weightedPenalty(modularityFactors),
    sourceFileCount,
    8,
    0.45,
  );

  if (cycleDensityPenalty >= 0.35) {
    const firstCycle = input.structural.cycles[0];
    pushIssue(issues, {
      id: "health.modularity.cycle_density",
      ruleId: "graph.cycle_density",
      signal: "structural.cycleEdgeRatio",
      dimension: "modularity",
      target:
        firstCycle?.nodes
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .join(" -> ") ?? input.structural.targetPath,
      message:
        "Dependencies inside cycles consume a high share of graph edges, reducing refactor flexibility.",
      severity: cycleDensityPenalty >= 0.7 ? "error" : "warn",
      evidenceMetrics: {
        cycleCount: input.structural.metrics.cycleCount,
        cycleEdgeRatio: round4(cycleEdgeRatio),
        cycleNodeRatio: round4(cycleNodeRatio),
      },
      impact: round4(modularityPenalty * 0.35),
    });
  }

  if (centralityConcentration >= 0.5) {
    const hottest = [...input.structural.files]
      .map((file) => ({
        path: file.relativePath,
        pressure: file.fanIn + file.fanOut,
      }))
      .sort((a, b) => b.pressure - a.pressure || a.path.localeCompare(b.path))[0];

    pushIssue(issues, {
      id: "health.modularity.centrality_concentration",
      ruleId: "graph.centrality_concentration",
      signal: "structural.centralityPressure",
      dimension: "modularity",
      target: hottest?.path ?? input.structural.targetPath,
      message:
        "Dependency flow is concentrated in a narrow set of files, creating architectural bottlenecks.",
      evidenceMetrics: {
        fanConcentration: round4(fanConcentration),
        centralityConcentration: round4(centralityConcentration),
      },
      impact: round4(modularityPenalty * 0.25),
    });
  }

  if (structuralHotspotOverlap >= 0.5) {
    pushIssue(issues, {
      id: "health.modularity.hotspot_overlap",
      ruleId: "graph.hotspot_overlap",
      signal: "structural.evolution.hotspotOverlap",
      dimension: "modularity",
      target: input.structural.targetPath,
      message:
        "Structural hubs overlap with top churn hotspots, making change pressure harder to isolate.",
      evidenceMetrics: {
        structuralHotspotOverlap: round4(structuralHotspotOverlap),
      },
      impact: round4(modularityPenalty * 0.2),
    });
  }

  let churnConcentrationPenalty = 0;
  let volatilityConcentrationPenalty = 0;
  let coChangeClusterPenalty = 0;
  let top10PercentFilesChurnShare = 0;
  let top10PercentFilesVolatilityShare = 0;
  let denseCoChangePairRatio = 0;

  if (input.evolution.available) {
    const evolutionSourceFiles = input.evolution.files.filter((file) =>
      sourceFileSet.has(file.filePath),
    );
    const evolutionFileCount = evolutionSourceFiles.length;

    top10PercentFilesChurnShare = topPercentShare(
      evolutionSourceFiles.map((file) => file.churnTotal),
      0.1,
    );
    top10PercentFilesVolatilityShare = topPercentShare(
      evolutionSourceFiles.map((file) => file.recentVolatility),
      0.1,
    );

    const sourcePairs = input.evolution.coupling.pairs.filter(
      (pair) => sourceFileSet.has(pair.fileA) && sourceFileSet.has(pair.fileB),
    );
    const maxPairs = (evolutionFileCount * (evolutionFileCount - 1)) / 2;
    const densePairs = sourcePairs.filter((pair) => pair.couplingScore >= 0.55);
    denseCoChangePairRatio = maxPairs <= 0 ? 0 : clamp01(densePairs.length / maxPairs);
    const couplingScoreConcentration = concentration(sourcePairs.map((pair) => pair.couplingScore));

    churnConcentrationPenalty = dampenForSmallSamples(
      clamp01((top10PercentFilesChurnShare - 0.35) / 0.55),
      evolutionFileCount,
      12,
      0.3,
    );
    volatilityConcentrationPenalty = dampenForSmallSamples(
      clamp01((top10PercentFilesVolatilityShare - 0.35) / 0.55),
      evolutionFileCount,
      12,
      0.3,
    );

    const coChangeRaw = average([
      clamp01(denseCoChangePairRatio / 0.2),
      couplingScoreConcentration,
    ]);
    coChangeClusterPenalty = dampenForSmallSamples(coChangeRaw, sourcePairs.length, 20, 0.35);

    if (churnConcentrationPenalty >= 0.35) {
      const mostChurn = [...evolutionSourceFiles].sort(
        (a, b) => b.churnTotal - a.churnTotal || a.filePath.localeCompare(b.filePath),
      )[0];
      pushIssue(issues, {
        id: "health.change_hygiene.churn_concentration",
        ruleId: "git.churn_distribution",
        signal: "evolution.top10PercentFilesChurnShare",
        dimension: "changeHygiene",
        target: mostChurn?.filePath ?? input.structural.targetPath,
        message: "A small slice of files carries most churn, reducing change predictability.",
        evidenceMetrics: {
          top10PercentFilesChurnShare: round4(top10PercentFilesChurnShare),
        },
        impact: round4(churnConcentrationPenalty * 0.4),
      });
    }

    if (volatilityConcentrationPenalty >= 0.35) {
      const volatileFile = [...evolutionSourceFiles].sort(
        (a, b) => b.recentVolatility - a.recentVolatility || a.filePath.localeCompare(b.filePath),
      )[0];
      pushIssue(issues, {
        id: "health.change_hygiene.volatility_concentration",
        ruleId: "git.volatility_distribution",
        signal: "evolution.top10PercentFilesVolatilityShare",
        dimension: "changeHygiene",
        target: volatileFile?.filePath ?? input.structural.targetPath,
        message: "Recent volatility is concentrated, increasing review and release uncertainty.",
        evidenceMetrics: {
          top10PercentFilesVolatilityShare: round4(top10PercentFilesVolatilityShare),
        },
        impact: round4(volatilityConcentrationPenalty * 0.3),
      });
    }

    if (coChangeClusterPenalty >= 0.35) {
      const strongestPair = [...sourcePairs].sort(
        (a, b) =>
          b.couplingScore - a.couplingScore ||
          `${a.fileA}|${a.fileB}`.localeCompare(`${b.fileA}|${b.fileB}`),
      )[0];

      pushIssue(issues, {
        id: "health.change_hygiene.dense_co_change_clusters",
        ruleId: "git.co_change_clusters",
        signal: "evolution.denseCoChangePairRatio",
        dimension: "changeHygiene",
        target:
          strongestPair === undefined
            ? input.structural.targetPath
            : `${strongestPair.fileA}<->${strongestPair.fileB}`,
        message: "Dense co-change clusters suggest wider coordination scope per change.",
        evidenceMetrics: {
          denseCoChangePairRatio: round4(denseCoChangePairRatio),
        },
        impact: round4(coChangeClusterPenalty * 0.3),
      });
    }
  }

  const changeHygieneFactors: readonly FactorSpec[] = [
    {
      factorId: "health.change_hygiene.churn_concentration",
      penalty: churnConcentrationPenalty,
      rawMetrics: {
        top10PercentFilesChurnShare: round4(top10PercentFilesChurnShare),
      },
      normalizedMetrics: {
        churnConcentrationPenalty: round4(churnConcentrationPenalty),
      },
      weight: 0.4,
      evidence: [{ kind: "repository_metric", metric: "evolution.top10PercentFilesChurnShare" }],
    },
    {
      factorId: "health.change_hygiene.volatility_concentration",
      penalty: volatilityConcentrationPenalty,
      rawMetrics: {
        top10PercentFilesVolatilityShare: round4(top10PercentFilesVolatilityShare),
      },
      normalizedMetrics: {
        volatilityConcentrationPenalty: round4(volatilityConcentrationPenalty),
      },
      weight: 0.3,
      evidence: [
        {
          kind: "repository_metric",
          metric: "evolution.top10PercentFilesVolatilityShare",
        },
      ],
    },
    {
      factorId: "health.change_hygiene.dense_co_change_clusters",
      penalty: coChangeClusterPenalty,
      rawMetrics: {
        denseCoChangePairRatio: round4(denseCoChangePairRatio),
      },
      normalizedMetrics: {
        coChangeClusterPenalty: round4(coChangeClusterPenalty),
      },
      weight: 0.3,
      evidence: [{ kind: "repository_metric", metric: "evolution.denseCoChangePairRatio" }],
    },
  ];

  const changeHygienePenalty = input.evolution.available
    ? weightedPenalty(changeHygieneFactors)
    : 0.12;

  const paths = filePaths(input.structural);
  const testFiles = paths.filter((path) => isTestPath(path)).length;
  const sourceFiles = paths.filter((path) => isSourcePath(path)).length;
  const testRatio = sourceFiles <= 0 ? 1 : testFiles / sourceFiles;
  const testingDirectoryPresent = hasTestDirectory(paths);

  const testPresencePenalty = sourceFiles <= 0 ? 0 : testFiles === 0 ? 1 : 0;
  const testRatioPenalty = sourceFiles <= 0 ? 0 : 1 - clamp01(testRatio / 0.25);
  const testingDirectoryPenalty = sourceFiles <= 0 ? 0 : testingDirectoryPresent ? 0 : 0.35;

  const testHealthFactors: readonly FactorSpec[] = [
    {
      factorId: "health.test_health.test_file_presence",
      penalty: testPresencePenalty,
      rawMetrics: {
        sourceFiles,
        testFiles,
      },
      normalizedMetrics: {
        testPresencePenalty: round4(testPresencePenalty),
      },
      weight: 0.4,
      evidence: [{ kind: "repository_metric", metric: "tests.filePresence" }],
    },
    {
      factorId: "health.test_health.test_to_source_ratio",
      penalty: testRatioPenalty,
      rawMetrics: {
        testToSourceRatio: round4(testRatio),
      },
      normalizedMetrics: {
        testRatioPenalty: round4(testRatioPenalty),
      },
      weight: 0.45,
      evidence: [{ kind: "repository_metric", metric: "tests.testToSourceRatio" }],
    },
    {
      factorId: "health.test_health.testing_directory_presence",
      penalty: testingDirectoryPenalty,
      rawMetrics: {
        testingDirectoryPresent: testingDirectoryPresent ? 1 : 0,
      },
      normalizedMetrics: {
        testingDirectoryPenalty: round4(testingDirectoryPenalty),
      },
      weight: 0.15,
      evidence: [{ kind: "repository_metric", metric: "tests.directoryPresence" }],
    },
  ];

  const testHealthPenalty = dampenForSmallSamples(
    weightedPenalty(testHealthFactors),
    sourceFiles,
    10,
    0.3,
  );

  if (sourceFiles > 0 && testFiles === 0) {
    pushIssue(issues, {
      id: "health.test_health.low_test_presence",
      ruleId: "tests.file_presence",
      signal: "tests.filePresence",
      dimension: "testHealth",
      target: input.structural.targetPath,
      message: `No test files detected for ${sourceFiles} source file(s).`,
      severity: sourceFiles >= 12 ? "error" : "warn",
      evidenceMetrics: {
        sourceFiles,
        testFiles,
        testToSourceRatio: round4(testRatio),
      },
      impact: round4(testHealthPenalty * 0.45),
    });
  }

  if (sourceFiles > 0 && testRatio < 0.12) {
    pushIssue(issues, {
      id: "health.test_health.low_test_ratio",
      ruleId: "tests.ratio",
      signal: "tests.testToSourceRatio",
      dimension: "testHealth",
      target: input.structural.targetPath,
      message: "Test-to-source ratio is low; long-term change confidence may degrade.",
      evidenceMetrics: {
        sourceFiles,
        testFiles,
        testToSourceRatio: round4(testRatio),
      },
      impact: round4(testHealthPenalty * 0.35),
    });
  }

  if (input.evolution.available) {
    const evolutionSourceFiles = input.evolution.files.filter((file) =>
      sourceFileSet.has(file.filePath),
    );
    const authorTotals = new Map<string, number>();
    const moduleTotals = new Map<string, number>();
    const moduleAuthors = new Map<string, Map<string, number>>();

    let singleContributorFiles = 0;
    let trackedFiles = 0;

    for (const file of evolutionSourceFiles) {
      if (file.commitCount <= 0 || file.authorDistribution.length === 0) {
        continue;
      }

      trackedFiles += 1;
      const dominantShare = clamp01(file.authorDistribution[0]?.share ?? 0);
      if (file.authorDistribution.length === 1 || dominantShare >= 0.9) {
        singleContributorFiles += 1;
      }

      for (const author of file.authorDistribution) {
        const commits = Math.max(0, author.commits);
        if (commits <= 0) {
          continue;
        }

        const moduleName = moduleNameFromPath(file.filePath);
        const moduleAuthorTotals = moduleAuthors.get(moduleName) ?? new Map<string, number>();
        if (moduleAuthors.has(moduleName) === false) {
          moduleAuthors.set(moduleName, moduleAuthorTotals);
        }

        authorTotals.set(author.authorId, (authorTotals.get(author.authorId) ?? 0) + commits);
        moduleTotals.set(moduleName, (moduleTotals.get(moduleName) ?? 0) + commits);
        moduleAuthorTotals.set(
          author.authorId,
          (moduleAuthorTotals.get(author.authorId) ?? 0) + commits,
        );
      }
    }

    const totalAuthorCommits = [...authorTotals.values()].reduce((sum, value) => sum + value, 0);
    const highestAuthorCommits = [...authorTotals.values()].sort((a, b) => b - a)[0] ?? 0;
    const topAuthorCommitShare =
      totalAuthorCommits <= 0 ? 0 : clamp01(highestAuthorCommits / totalAuthorCommits);

    const filesWithSingleContributorRatio =
      trackedFiles === 0 ? 0 : clamp01(singleContributorFiles / trackedFiles);

    const authorEntropy = normalizedEntropy([...authorTotals.values()]);

    let dominatedModules = 0;
    let trackedModules = 0;
    for (const [moduleName, moduleCommitTotal] of moduleTotals.entries()) {
      if (moduleCommitTotal < 5) {
        continue;
      }

      const perModuleAuthors = moduleAuthors.get(moduleName);
      if (perModuleAuthors === undefined) {
        continue;
      }

      trackedModules += 1;
      const topAuthorModuleCommits = [...perModuleAuthors.values()].sort((a, b) => b - a)[0] ?? 0;
      const moduleTopShare =
        moduleCommitTotal <= 0 ? 0 : topAuthorModuleCommits / moduleCommitTotal;
      if (moduleTopShare >= 0.8) {
        dominatedModules += 1;
      }
    }

    const modulesDominatedBySingleContributorRatio =
      trackedModules === 0 ? 0 : clamp01(dominatedModules / trackedModules);

    const ownershipSampleSize = trackedFiles;
    const ownershipCommitVolume = totalAuthorCommits;

    const ownershipReliability = average([
      clamp01(ownershipSampleSize / 12),
      clamp01(ownershipCommitVolume / 180),
    ]);

    const topAuthorPenalty = clamp01((topAuthorCommitShare - 0.55) / 0.4);
    const singleContributorPenalty = clamp01((filesWithSingleContributorRatio - 0.35) / 0.6);
    const entropyPenalty = clamp01((0.75 - authorEntropy) / 0.75);
    const moduleDominancePenalty = clamp01((modulesDominatedBySingleContributorRatio - 0.4) / 0.6);

    const ownershipBasePenalty = weightedPenalty([
      {
        factorId: "health.ownership.top_author_commit_share",
        penalty: topAuthorPenalty,
        rawMetrics: {
          topAuthorCommitShare: round4(topAuthorCommitShare),
        },
        normalizedMetrics: {
          topAuthorPenalty: round4(topAuthorPenalty),
        },
        weight: 0.35,
        evidence: [{ kind: "repository_metric", metric: "ownership.topAuthorCommitShare" }],
      },
      {
        factorId: "health.ownership.files_with_single_contributor_ratio",
        penalty: singleContributorPenalty,
        rawMetrics: {
          filesWithSingleContributorRatio: round4(filesWithSingleContributorRatio),
        },
        normalizedMetrics: {
          singleContributorPenalty: round4(singleContributorPenalty),
        },
        weight: 0.25,
        evidence: [
          {
            kind: "repository_metric",
            metric: "ownership.filesWithSingleContributorRatio",
          },
        ],
      },
      {
        factorId: "health.ownership.author_entropy",
        penalty: entropyPenalty,
        rawMetrics: {
          authorEntropy: round4(authorEntropy),
        },
        normalizedMetrics: {
          authorEntropyPenalty: round4(entropyPenalty),
        },
        weight: 0.25,
        evidence: [{ kind: "repository_metric", metric: "ownership.authorEntropy" }],
      },
      {
        factorId: "health.ownership.module_single_author_dominance",
        penalty: moduleDominancePenalty,
        rawMetrics: {
          modulesDominatedBySingleContributorRatio: round4(
            modulesDominatedBySingleContributorRatio,
          ),
        },
        normalizedMetrics: {
          moduleDominancePenalty: round4(moduleDominancePenalty),
        },
        weight: 0.15,
        evidence: [{ kind: "repository_metric", metric: "ownership.moduleDominance" }],
      },
    ]);

    const ownershipDistributionPenalty = clamp01(
      ownershipBasePenalty * (0.3 + 0.7 * ownershipReliability),
    );

    const ownershipDistributionFactors: readonly FactorSpec[] = [
      {
        factorId: "health.ownership.top_author_commit_share",
        penalty: topAuthorPenalty,
        rawMetrics: {
          topAuthorCommitShare: round4(topAuthorCommitShare),
        },
        normalizedMetrics: {
          topAuthorPenalty: round4(topAuthorPenalty),
          ownershipReliability: round4(ownershipReliability),
        },
        weight: 0.35,
        evidence: [{ kind: "repository_metric", metric: "ownership.topAuthorCommitShare" }],
      },
      {
        factorId: "health.ownership.files_with_single_contributor_ratio",
        penalty: singleContributorPenalty,
        rawMetrics: {
          filesWithSingleContributorRatio: round4(filesWithSingleContributorRatio),
        },
        normalizedMetrics: {
          singleContributorPenalty: round4(singleContributorPenalty),
        },
        weight: 0.25,
        evidence: [
          {
            kind: "repository_metric",
            metric: "ownership.filesWithSingleContributorRatio",
          },
        ],
      },
      {
        factorId: "health.ownership.author_entropy",
        penalty: entropyPenalty,
        rawMetrics: {
          authorEntropy: round4(authorEntropy),
        },
        normalizedMetrics: {
          authorEntropyPenalty: round4(entropyPenalty),
        },
        weight: 0.25,
        evidence: [{ kind: "repository_metric", metric: "ownership.authorEntropy" }],
      },
      {
        factorId: "health.ownership.module_single_author_dominance",
        penalty: moduleDominancePenalty,
        rawMetrics: {
          modulesDominatedBySingleContributorRatio: round4(
            modulesDominatedBySingleContributorRatio,
          ),
        },
        normalizedMetrics: {
          moduleDominancePenalty: round4(moduleDominancePenalty),
        },
        weight: 0.15,
        evidence: [{ kind: "repository_metric", metric: "ownership.moduleDominance" }],
      },
    ];

    if (topAuthorPenalty >= 0.35) {
      pushIssue(issues, {
        id: "health.ownership.top_author_commit_share",
        ruleId: "ownership.top_author_share",
        signal: "ownership.topAuthorCommitShare",
        dimension: "ownershipDistribution",
        target: input.structural.targetPath,
        message: "A single contributor owns most commits, concentrating repository knowledge.",
        severity: topAuthorPenalty >= 0.75 ? "error" : "warn",
        evidenceMetrics: {
          topAuthorCommitShare: round4(topAuthorCommitShare),
          authorEntropy: round4(authorEntropy),
        },
        impact: round4(ownershipDistributionPenalty * 0.4),
      });
    }

    if (singleContributorPenalty >= 0.35) {
      pushIssue(issues, {
        id: "health.ownership.single_author_dominance",
        ruleId: "ownership.file_dominance",
        signal: "ownership.filesWithSingleContributorRatio",
        dimension: "ownershipDistribution",
        target: input.structural.targetPath,
        message: "Many files are dominated by a single contributor, reducing change resilience.",
        evidenceMetrics: {
          filesWithSingleContributorRatio: round4(filesWithSingleContributorRatio),
          modulesDominatedBySingleContributorRatio: round4(
            modulesDominatedBySingleContributorRatio,
          ),
        },
        impact: round4(ownershipDistributionPenalty * 0.35),
      });
    }

    if (entropyPenalty >= 0.35) {
      pushIssue(issues, {
        id: "health.ownership.low_author_entropy",
        ruleId: "ownership.author_entropy",
        signal: "ownership.authorEntropy",
        dimension: "ownershipDistribution",
        target: input.structural.targetPath,
        message: "Contributor distribution is narrow across the repository.",
        evidenceMetrics: {
          authorEntropy: round4(authorEntropy),
          topAuthorCommitShare: round4(topAuthorCommitShare),
        },
        impact: round4(ownershipDistributionPenalty * 0.25),
      });
    }

    const modularityHealth = clamp01(1 - modularityPenalty);
    const changeHygieneHealth = clamp01(1 - changeHygienePenalty);
    const testHealthScore = clamp01(1 - testHealthPenalty);
    const ownershipDistributionHealth = clamp01(1 - ownershipDistributionPenalty);

    const normalizedScore = clamp01(
      modularityHealth * DIMENSION_WEIGHTS.modularity +
        changeHygieneHealth * DIMENSION_WEIGHTS.changeHygiene +
        testHealthScore * DIMENSION_WEIGHTS.testHealth +
        ownershipDistributionHealth * DIMENSION_WEIGHTS.ownershipDistribution,
    );

    const topIssues = [...issues]
      .sort(
        (a, b) =>
          b.impact - a.impact || a.id.localeCompare(b.id) || a.target.localeCompare(b.target),
      )
      .slice(0, 12)
      .map(({ impact: _impact, ...issue }) => issue);

    return {
      healthScore: toPercentage(normalizedScore),
      normalizedScore: round4(normalizedScore),
      dimensions: {
        modularity: toPercentage(modularityHealth),
        changeHygiene: toPercentage(changeHygieneHealth),
        testHealth: toPercentage(testHealthScore),
        ownershipDistribution: toPercentage(ownershipDistributionHealth),
      },
      topIssues,
      trace: {
        schemaVersion: HEALTH_TRACE_VERSION,
        dimensions: [
          createDimensionTrace("modularity", modularityHealth, modularityFactors),
          createDimensionTrace("changeHygiene", changeHygieneHealth, changeHygieneFactors),
          createDimensionTrace("testHealth", testHealthScore, testHealthFactors),
          createDimensionTrace(
            "ownershipDistribution",
            ownershipDistributionHealth,
            ownershipDistributionFactors,
          ),
        ],
      },
    };
  }

  const ownershipDistributionPenalty = 0.12;
  const ownershipDistributionFactors: readonly FactorSpec[] = [
    {
      factorId: "health.ownership.missing_git_history",
      penalty: ownershipDistributionPenalty,
      rawMetrics: {
        gitHistoryAvailable: 0,
      },
      normalizedMetrics: {
        ownershipDistributionPenalty: round4(ownershipDistributionPenalty),
      },
      weight: 1,
      evidence: [{ kind: "repository_metric", metric: "evolution.available" }],
    },
  ];

  const modularityHealth = clamp01(1 - modularityPenalty);
  const changeHygieneHealth = clamp01(1 - changeHygienePenalty);
  const testHealthScore = clamp01(1 - testHealthPenalty);
  const ownershipDistributionHealth = clamp01(1 - ownershipDistributionPenalty);

  const normalizedScore = clamp01(
    modularityHealth * DIMENSION_WEIGHTS.modularity +
      changeHygieneHealth * DIMENSION_WEIGHTS.changeHygiene +
      testHealthScore * DIMENSION_WEIGHTS.testHealth +
      ownershipDistributionHealth * DIMENSION_WEIGHTS.ownershipDistribution,
  );

  const topIssues = [...issues]
    .sort(
      (a, b) => b.impact - a.impact || a.id.localeCompare(b.id) || a.target.localeCompare(b.target),
    )
    .slice(0, 12)
    .map(({ impact: _impact, ...issue }) => issue);

  return {
    healthScore: toPercentage(normalizedScore),
    normalizedScore: round4(normalizedScore),
    dimensions: {
      modularity: toPercentage(modularityHealth),
      changeHygiene: toPercentage(changeHygieneHealth),
      testHealth: toPercentage(testHealthScore),
      ownershipDistribution: toPercentage(ownershipDistributionHealth),
    },
    topIssues,
    trace: {
      schemaVersion: HEALTH_TRACE_VERSION,
      dimensions: [
        createDimensionTrace("modularity", modularityHealth, modularityFactors),
        createDimensionTrace("changeHygiene", changeHygieneHealth, changeHygieneFactors),
        createDimensionTrace("testHealth", testHealthScore, testHealthFactors),
        createDimensionTrace(
          "ownershipDistribution",
          ownershipDistributionHealth,
          ownershipDistributionFactors,
        ),
      ],
    },
  };
};
