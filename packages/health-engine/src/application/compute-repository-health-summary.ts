import type {
  GraphAnalysisSummary,
  HealthDimension,
  HealthDimensionTrace,
  HealthEvidenceRef,
  HealthFactorTrace,
  HealthIssue,
  HealthSignalInputs,
  RepositoryEvolutionSummary,
  RepositoryHealthSummary,
} from "@codesentinel/core";
import { average, clamp01, concentration, round4 } from "../domain/math.js";

export type ComputeRepositoryHealthSummaryInput = {
  structural: GraphAnalysisSummary;
  evolution: RepositoryEvolutionSummary;
  signals?: HealthSignalInputs;
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
  modularity: 0.2,
  changeHygiene: 0.2,
  staticAnalysis: 0.2,
  complexity: 0.15,
  duplication: 0.1,
  testHealth: 0.15,
};

const HEALTH_TRACE_VERSION = "1" as const;

const toPercentage = (normalizedHealth: number): number => round4(clamp01(normalizedHealth) * 100);

const logScaled = (value: number, scale: number): number => {
  if (scale <= 0) {
    return 0;
  }
  return clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(scale));
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

const isTestPath = (path: string): boolean => {
  const normalized = path.toLowerCase();
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("\\__tests__\\") ||
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

const pushIssue = (
  issues: HealthIssueWithImpact[],
  issue: Omit<HealthIssueWithImpact, "severity"> & { severity?: HealthIssue["severity"] },
): void => {
  issues.push({
    ...issue,
    severity: issue.severity ?? "warn",
  });
};

export const computeRepositoryHealthSummary = (
  input: ComputeRepositoryHealthSummaryInput,
): RepositoryHealthSummary => {
  const issues: HealthIssueWithImpact[] = [];
  const sourceFileSet = new Set(input.structural.files.map((file) => file.relativePath));
  const signals = input.signals;

  const cycleCount = input.structural.metrics.cycleCount;
  const cycleSizeAverage =
    input.structural.cycles.length === 0
      ? 0
      : average(input.structural.cycles.map((cycle) => cycle.nodes.length));
  const cyclePenalty = clamp01(cycleCount / 6) * 0.7 + clamp01((cycleSizeAverage - 2) / 8) * 0.3;

  const fanInConcentration = concentration(input.structural.files.map((file) => file.fanIn));
  const fanOutConcentration = concentration(input.structural.files.map((file) => file.fanOut));
  const centralityConcentration = average([fanInConcentration, fanOutConcentration]);

  if (cycleCount > 0) {
    pushIssue(issues, {
      id: "health.modularity.structural_cycles",
      ruleId: "graph.structural_cycles",
      dimension: "modularity",
      target:
        input.structural.cycles[0]?.nodes
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .join(" -> ") ?? input.structural.targetPath,
      message: `${cycleCount} structural cycle(s) increase coupling and refactor cost.`,
      severity: cycleCount >= 3 ? "error" : "warn",
      impact: round4(cyclePenalty * 0.55),
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
      dimension: "modularity",
      target: hottest?.path ?? input.structural.targetPath,
      message: "Fan-in/fan-out pressure is concentrated in a small set of files.",
      impact: round4(centralityConcentration * 0.45),
    });
  }

  const modularityFactors: readonly FactorSpec[] = [
    {
      factorId: "health.modularity.structural_cycles",
      penalty: cyclePenalty,
      rawMetrics: {
        cycleCount,
        averageCycleSize: round4(cycleSizeAverage),
      },
      normalizedMetrics: {
        cyclePenalty: round4(cyclePenalty),
      },
      weight: 0.55,
      evidence: [{ kind: "repository_metric", metric: "structural.cycles" }],
    },
    {
      factorId: "health.modularity.centrality_concentration",
      penalty: centralityConcentration,
      rawMetrics: {
        fanInConcentration: round4(fanInConcentration),
        fanOutConcentration: round4(fanOutConcentration),
      },
      normalizedMetrics: {
        centralityConcentration: round4(centralityConcentration),
      },
      weight: 0.45,
      evidence: [{ kind: "repository_metric", metric: "structural.files.fanIn/fanOut" }],
    },
  ];
  const modularityPenalty = clamp01(
    modularityFactors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0),
  );

  let churnConcentration = 0;
  let volatilityConcentration = 0;
  let couplingDensity = 0;
  let couplingIntensity = 0;

  if (input.evolution.available) {
    const evolutionSourceFiles = input.evolution.files.filter((file) =>
      sourceFileSet.has(file.filePath),
    );
    churnConcentration = concentration(evolutionSourceFiles.map((file) => file.churnTotal));
    volatilityConcentration = concentration(
      evolutionSourceFiles.map((file) => file.recentVolatility),
    );

    const fileCount = Math.max(1, evolutionSourceFiles.length);
    const maxPairs = (fileCount * (fileCount - 1)) / 2;
    const sourcePairs = input.evolution.coupling.pairs.filter(
      (pair) => sourceFileSet.has(pair.fileA) && sourceFileSet.has(pair.fileB),
    );
    couplingDensity = maxPairs <= 0 ? 0 : clamp01(sourcePairs.length / maxPairs);
    couplingIntensity = average(sourcePairs.map((pair) => pair.couplingScore));

    if (churnConcentration >= 0.45) {
      const mostChurn = [...evolutionSourceFiles].sort(
        (a, b) => b.churnTotal - a.churnTotal || a.filePath.localeCompare(b.filePath),
      )[0];
      pushIssue(issues, {
        id: "health.change_hygiene.churn_concentration",
        ruleId: "git.churn_concentration",
        dimension: "changeHygiene",
        target: mostChurn?.filePath ?? input.structural.targetPath,
        message: "Churn is concentrated in a narrow part of the codebase.",
        impact: round4(churnConcentration * 0.4),
      });
    }

    if (volatilityConcentration >= 0.45) {
      const volatileFile = [...evolutionSourceFiles].sort(
        (a, b) => b.recentVolatility - a.recentVolatility || a.filePath.localeCompare(b.filePath),
      )[0];
      pushIssue(issues, {
        id: "health.change_hygiene.volatility_concentration",
        ruleId: "git.volatility_concentration",
        dimension: "changeHygiene",
        target: volatileFile?.filePath ?? input.structural.targetPath,
        message: "Recent volatility is concentrated in files that change frequently.",
        impact: round4(volatilityConcentration * 0.3),
      });
    }

    if (couplingDensity >= 0.35 || couplingIntensity >= 0.45) {
      const strongestPair = [...sourcePairs].sort(
        (a, b) =>
          b.couplingScore - a.couplingScore ||
          `${a.fileA}|${a.fileB}`.localeCompare(`${b.fileA}|${b.fileB}`),
      )[0];
      pushIssue(issues, {
        id: "health.change_hygiene.coupling_density",
        ruleId: "git.coupling_density",
        dimension: "changeHygiene",
        target:
          strongestPair === undefined
            ? input.structural.targetPath
            : `${strongestPair.fileA}<->${strongestPair.fileB}`,
        message: "Co-change relationships are dense, increasing coordination overhead.",
        impact: round4(average([couplingDensity, couplingIntensity]) * 0.3),
      });
    }
  }

  const todoFixmeCommentCount = Math.max(0, signals?.todoFixmeCommentCount ?? 0);
  const todoFixmePenalty = logScaled(todoFixmeCommentCount, 80) * 0.08;
  if (todoFixmeCommentCount > 0) {
    pushIssue(issues, {
      id: "health.change_hygiene.todo_fixme_load",
      ruleId: "comments.todo_fixme",
      dimension: "changeHygiene",
      target: input.structural.targetPath,
      message: `Found ${todoFixmeCommentCount} TODO/FIXME comment marker(s); cleanup debt is accumulating.`,
      impact: round4(todoFixmePenalty * 0.4),
    });
  }

  const changeHygieneFactors: readonly FactorSpec[] = [
    {
      factorId: "health.change_hygiene.churn_concentration",
      penalty: churnConcentration,
      rawMetrics: {
        churnConcentration: round4(churnConcentration),
      },
      normalizedMetrics: {
        churnConcentration: round4(churnConcentration),
      },
      weight: 0.35,
      evidence: [{ kind: "repository_metric", metric: "evolution.churn" }],
    },
    {
      factorId: "health.change_hygiene.volatility_concentration",
      penalty: volatilityConcentration,
      rawMetrics: {
        volatilityConcentration: round4(volatilityConcentration),
      },
      normalizedMetrics: {
        volatilityConcentration: round4(volatilityConcentration),
      },
      weight: 0.25,
      evidence: [{ kind: "repository_metric", metric: "evolution.recentVolatility" }],
    },
    {
      factorId: "health.change_hygiene.coupling_density",
      penalty: average([couplingDensity, couplingIntensity]),
      rawMetrics: {
        couplingDensity: round4(couplingDensity),
        couplingIntensity: round4(couplingIntensity),
      },
      normalizedMetrics: {
        couplingPressure: round4(average([couplingDensity, couplingIntensity])),
      },
      weight: 0.3,
      evidence: [{ kind: "repository_metric", metric: "evolution.coupling" }],
    },
    {
      factorId: "health.change_hygiene.todo_fixme_load",
      penalty: todoFixmePenalty,
      rawMetrics: {
        todoFixmeCommentCount,
      },
      normalizedMetrics: {
        todoFixmePenalty: round4(todoFixmePenalty),
      },
      weight: 0.1,
      evidence: [{ kind: "repository_metric", metric: "comments.todo_fixme" }],
    },
  ];
  const changeHygienePenalty = input.evolution.available
    ? clamp01(changeHygieneFactors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0))
    : 0.2;

  const eslint = signals?.eslint;
  const tsc = signals?.typescript;
  const sourceCount = Math.max(1, input.structural.files.length);
  const eslintErrorRate = (eslint?.errorCount ?? 0) / sourceCount;
  const eslintWarnRate = (eslint?.warningCount ?? 0) / sourceCount;
  const tsErrorRate = (tsc?.errorCount ?? 0) / sourceCount;
  const tsWarnRate = (tsc?.warningCount ?? 0) / sourceCount;

  const staticAnalysisFactors: readonly FactorSpec[] = [
    {
      factorId: "health.static_analysis.eslint_errors",
      penalty: clamp01(eslintErrorRate / 0.5),
      rawMetrics: {
        eslintErrorCount: eslint?.errorCount ?? 0,
        eslintFilesWithIssues: eslint?.filesWithIssues ?? 0,
      },
      normalizedMetrics: {
        eslintErrorRate: round4(eslintErrorRate),
      },
      weight: 0.5,
      evidence: [{ kind: "repository_metric", metric: "eslint.errorCount" }],
    },
    {
      factorId: "health.static_analysis.eslint_warnings",
      penalty: clamp01(eslintWarnRate / 1.2),
      rawMetrics: {
        eslintWarningCount: eslint?.warningCount ?? 0,
      },
      normalizedMetrics: {
        eslintWarningRate: round4(eslintWarnRate),
      },
      weight: 0.2,
      evidence: [{ kind: "repository_metric", metric: "eslint.warningCount" }],
    },
    {
      factorId: "health.static_analysis.typescript_errors",
      penalty: clamp01(tsErrorRate / 0.35),
      rawMetrics: {
        typeScriptErrorCount: tsc?.errorCount ?? 0,
        typeScriptFilesWithDiagnostics: tsc?.filesWithDiagnostics ?? 0,
      },
      normalizedMetrics: {
        typeScriptErrorRate: round4(tsErrorRate),
      },
      weight: 0.2,
      evidence: [{ kind: "repository_metric", metric: "typescript.errorCount" }],
    },
    {
      factorId: "health.static_analysis.typescript_warnings",
      penalty: clamp01(tsWarnRate / 0.9),
      rawMetrics: {
        typeScriptWarningCount: tsc?.warningCount ?? 0,
      },
      normalizedMetrics: {
        typeScriptWarningRate: round4(tsWarnRate),
      },
      weight: 0.1,
      evidence: [{ kind: "repository_metric", metric: "typescript.warningCount" }],
    },
  ];

  const staticAnalysisPenalty = clamp01(
    staticAnalysisFactors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0),
  );

  if ((eslint?.errorCount ?? 0) > 0) {
    const topRule = [...(eslint?.ruleCounts ?? [])].sort(
      (a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId),
    )[0];

    pushIssue(issues, {
      id: "health.static_analysis.eslint_errors",
      ruleId: topRule?.ruleId ?? "eslint",
      dimension: "staticAnalysis",
      target: input.structural.targetPath,
      message:
        topRule === undefined
          ? `ESLint reported ${eslint?.errorCount ?? 0} error(s).`
          : `ESLint reported ${eslint?.errorCount ?? 0} error(s); top rule ${topRule.ruleId} (${topRule.count}).`,
      severity: "error",
      impact: round4(staticAnalysisPenalty * 0.5),
    });
  }

  if ((tsc?.errorCount ?? 0) > 0) {
    pushIssue(issues, {
      id: "health.static_analysis.typescript_errors",
      ruleId: "typescript",
      dimension: "staticAnalysis",
      target: input.structural.targetPath,
      message: `TypeScript reported ${tsc?.errorCount ?? 0} error diagnostic(s).`,
      severity: "error",
      impact: round4(staticAnalysisPenalty * 0.4),
    });
  }

  const complexity = signals?.complexity;
  const avgComplexity = complexity?.averageCyclomatic ?? 0;
  const maxComplexity = complexity?.maxCyclomatic ?? 0;
  const highComplexityRatio =
    (complexity?.analyzedFileCount ?? 0) === 0
      ? 0
      : (complexity?.highComplexityFileCount ?? 0) /
        Math.max(1, complexity?.analyzedFileCount ?? 1);

  const complexityFactors: readonly FactorSpec[] = [
    {
      factorId: "health.complexity.average_cyclomatic",
      penalty: clamp01(avgComplexity / 16),
      rawMetrics: {
        averageCyclomatic: round4(avgComplexity),
      },
      normalizedMetrics: {
        averageCyclomaticPenalty: round4(clamp01(avgComplexity / 16)),
      },
      weight: 0.4,
      evidence: [{ kind: "repository_metric", metric: "complexity.averageCyclomatic" }],
    },
    {
      factorId: "health.complexity.max_cyclomatic",
      penalty: clamp01(maxComplexity / 35),
      rawMetrics: {
        maxCyclomatic: round4(maxComplexity),
      },
      normalizedMetrics: {
        maxCyclomaticPenalty: round4(clamp01(maxComplexity / 35)),
      },
      weight: 0.35,
      evidence: [{ kind: "repository_metric", metric: "complexity.maxCyclomatic" }],
    },
    {
      factorId: "health.complexity.high_complexity_ratio",
      penalty: clamp01(highComplexityRatio / 0.35),
      rawMetrics: {
        highComplexityFileCount: complexity?.highComplexityFileCount ?? 0,
        analyzedFileCount: complexity?.analyzedFileCount ?? 0,
      },
      normalizedMetrics: {
        highComplexityRatio: round4(highComplexityRatio),
      },
      weight: 0.25,
      evidence: [{ kind: "repository_metric", metric: "complexity.highComplexityFileCount" }],
    },
  ];

  const complexityPenalty = clamp01(
    complexityFactors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0),
  );

  if (maxComplexity >= 20 || highComplexityRatio >= 0.2) {
    pushIssue(issues, {
      id: "health.complexity.high_cyclomatic",
      ruleId: "complexity.cyclomatic",
      dimension: "complexity",
      target: input.structural.targetPath,
      message: `Complexity is elevated (avg=${round4(avgComplexity)}, max=${round4(maxComplexity)}).`,
      impact: round4(complexityPenalty * 0.6),
    });
  }

  const duplication = signals?.duplication;
  const duplicatedLineRatio = duplication?.duplicatedLineRatio ?? 0;
  const duplicatedBlockCount = duplication?.duplicatedBlockCount ?? 0;
  const duplicationFactors: readonly FactorSpec[] = [
    {
      factorId: "health.duplication.line_ratio",
      penalty: clamp01(duplicatedLineRatio / 0.25),
      rawMetrics: {
        duplicatedLineRatio: round4(duplicatedLineRatio),
      },
      normalizedMetrics: {
        duplicatedLineRatioPenalty: round4(clamp01(duplicatedLineRatio / 0.25)),
      },
      weight: 0.7,
      evidence: [{ kind: "repository_metric", metric: "duplication.duplicatedLineRatio" }],
    },
    {
      factorId: "health.duplication.block_count",
      penalty: logScaled(duplicatedBlockCount, 120),
      rawMetrics: {
        duplicatedBlockCount,
        filesWithDuplication: duplication?.filesWithDuplication ?? 0,
      },
      normalizedMetrics: {
        duplicatedBlockPenalty: round4(logScaled(duplicatedBlockCount, 120)),
      },
      weight: 0.3,
      evidence: [{ kind: "repository_metric", metric: "duplication.duplicatedBlockCount" }],
    },
  ];

  const duplicationPenalty = clamp01(
    duplicationFactors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0),
  );

  if (duplicatedLineRatio >= 0.08) {
    pushIssue(issues, {
      id: "health.duplication.high_duplication",
      ruleId: "duplication.line_ratio",
      dimension: "duplication",
      target: input.structural.targetPath,
      message: `Duplication ratio is high (${toPercentage(duplicatedLineRatio)}%).`,
      impact: round4(duplicationPenalty * 0.6),
    });
  }

  const paths = filePaths(input.structural);
  const testFiles = paths.filter((path) => isTestPath(path)).length;
  const sourceFiles = paths.filter((path) => isSourcePath(path)).length;
  const testRatio = sourceFiles <= 0 ? 1 : testFiles / sourceFiles;

  const testPresencePenalty = sourceFiles <= 0 ? 0 : 1 - clamp01(testRatio / 0.35);

  const coverageSignals = signals?.coverage;
  const coverageValues = [
    coverageSignals?.lineCoverage,
    coverageSignals?.branchCoverage,
    coverageSignals?.functionCoverage,
    coverageSignals?.statementCoverage,
  ].filter((value): value is number => value !== null && value !== undefined);

  const coverageRatio = coverageValues.length === 0 ? null : average(coverageValues);
  const coveragePenalty = coverageRatio === null ? 0.2 : 1 - clamp01(coverageRatio / 0.8);

  const testHealthFactors: readonly FactorSpec[] = [
    {
      factorId: "health.test_health.test_presence",
      penalty: testPresencePenalty,
      rawMetrics: {
        sourceFiles,
        testFiles,
        testRatio: round4(testRatio),
      },
      normalizedMetrics: {
        testPresencePenalty: round4(testPresencePenalty),
      },
      weight: 0.55,
      evidence: [{ kind: "repository_metric", metric: "tests.file_ratio" }],
    },
    {
      factorId: "health.test_health.coverage",
      penalty: coveragePenalty,
      rawMetrics: {
        lineCoverage: coverageSignals?.lineCoverage ?? null,
        branchCoverage: coverageSignals?.branchCoverage ?? null,
        functionCoverage: coverageSignals?.functionCoverage ?? null,
        statementCoverage: coverageSignals?.statementCoverage ?? null,
      },
      normalizedMetrics: {
        coverageRatio: coverageRatio === null ? null : round4(coverageRatio),
        coveragePenalty: round4(coveragePenalty),
      },
      weight: 0.45,
      evidence: [{ kind: "repository_metric", metric: "coverage.summary" }],
    },
  ];

  const testHealthPenalty = clamp01(
    testHealthFactors.reduce((sum, factor) => sum + factor.penalty * factor.weight, 0),
  );

  if (sourceFiles > 0 && testRatio < 0.2) {
    pushIssue(issues, {
      id: "health.test_health.low_test_presence",
      ruleId: "tests.file_ratio",
      dimension: "testHealth",
      target: input.structural.targetPath,
      message: `Detected ${testFiles} test file(s) for ${sourceFiles} source file(s).`,
      severity: testRatio === 0 ? "error" : "warn",
      impact: round4(testHealthPenalty * 0.4),
    });
  }

  if (coverageRatio !== null && coverageRatio < 0.6) {
    pushIssue(issues, {
      id: "health.test_health.low_coverage",
      ruleId: "coverage.threshold",
      dimension: "testHealth",
      target: input.structural.targetPath,
      message: `Coverage is below threshold (${toPercentage(coverageRatio)}%).`,
      impact: round4(testHealthPenalty * 0.35),
    });
  }

  const modularityHealth = clamp01(1 - modularityPenalty);
  const changeHygieneHealth = clamp01(1 - changeHygienePenalty);
  const staticAnalysisHealth = clamp01(1 - staticAnalysisPenalty);
  const complexityHealth = clamp01(1 - complexityPenalty);
  const duplicationHealth = clamp01(1 - duplicationPenalty);
  const testHealthScore = clamp01(1 - testHealthPenalty);

  const normalizedScore = clamp01(
    modularityHealth * DIMENSION_WEIGHTS.modularity +
      changeHygieneHealth * DIMENSION_WEIGHTS.changeHygiene +
      staticAnalysisHealth * DIMENSION_WEIGHTS.staticAnalysis +
      complexityHealth * DIMENSION_WEIGHTS.complexity +
      duplicationHealth * DIMENSION_WEIGHTS.duplication +
      testHealthScore * DIMENSION_WEIGHTS.testHealth,
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
      staticAnalysis: toPercentage(staticAnalysisHealth),
      complexity: toPercentage(complexityHealth),
      duplication: toPercentage(duplicationHealth),
      testHealth: toPercentage(testHealthScore),
    },
    topIssues,
    trace: {
      schemaVersion: HEALTH_TRACE_VERSION,
      dimensions: [
        createDimensionTrace("modularity", modularityHealth, modularityFactors),
        createDimensionTrace("changeHygiene", changeHygieneHealth, changeHygieneFactors),
        createDimensionTrace("staticAnalysis", staticAnalysisHealth, staticAnalysisFactors),
        createDimensionTrace("complexity", complexityHealth, complexityFactors),
        createDimensionTrace("duplication", duplicationHealth, duplicationFactors),
        createDimensionTrace("testHealth", testHealthScore, testHealthFactors),
      ],
    },
  };
};
