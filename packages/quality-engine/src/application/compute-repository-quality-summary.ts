import type {
  GraphAnalysisSummary,
  QualityIssue,
  RepositoryEvolutionSummary,
  RepositoryQualitySummary,
} from "@codesentinel/core";
import { average, clamp01, concentration, round4 } from "../domain/math.js";

export type ComputeRepositoryQualitySummaryInput = {
  structural: GraphAnalysisSummary;
  evolution: RepositoryEvolutionSummary;
  todoFixmeCount?: number;
};

type QualityIssueWithImpact = QualityIssue & {
  impact: number;
};

const DIMENSION_WEIGHTS = {
  modularity: 0.45,
  changeHygiene: 0.35,
  testHealth: 0.2,
} as const;

const TODO_FIXME_MAX_IMPACT = 0.08;

const toPercentage = (normalizedQuality: number): number =>
  round4(clamp01(normalizedQuality) * 100);

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
  issues: QualityIssueWithImpact[],
  issue: Omit<QualityIssueWithImpact, "severity"> & { severity?: QualityIssue["severity"] },
): void => {
  issues.push({
    ...issue,
    severity: issue.severity ?? "warn",
  });
};

export const computeRepositoryQualitySummary = (
  input: ComputeRepositoryQualitySummaryInput,
): RepositoryQualitySummary => {
  const issues: QualityIssueWithImpact[] = [];
  const sourceFileSet = new Set(input.structural.files.map((file) => file.relativePath));

  const cycleCount = input.structural.metrics.cycleCount;
  const cycleSizeAverage =
    input.structural.cycles.length === 0
      ? 0
      : average(input.structural.cycles.map((cycle) => cycle.nodes.length));
  const cyclePenalty = clamp01(cycleCount / 6) * 0.7 + clamp01((cycleSizeAverage - 2) / 8) * 0.3;
  if (cycleCount > 0) {
    pushIssue(issues, {
      id: "quality.modularity.structural_cycles",
      dimension: "modularity",
      target:
        input.structural.cycles[0]?.nodes
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .join(" -> ") ?? input.structural.targetPath,
      message: `${cycleCount} structural cycle(s) increase coupling and refactor cost.`,
      severity: cycleCount >= 3 ? "error" : "warn",
      impact: round4(cyclePenalty * 0.6),
    });
  }

  const fanInConcentration = concentration(input.structural.files.map((file) => file.fanIn));
  const fanOutConcentration = concentration(input.structural.files.map((file) => file.fanOut));
  const centralityConcentration = average([fanInConcentration, fanOutConcentration]);
  if (centralityConcentration >= 0.5) {
    const hottest = [...input.structural.files]
      .map((file) => ({
        path: file.relativePath,
        pressure: file.fanIn + file.fanOut,
      }))
      .sort((a, b) => b.pressure - a.pressure || a.path.localeCompare(b.path))[0];

    pushIssue(issues, {
      id: "quality.modularity.centrality_concentration",
      dimension: "modularity",
      target: hottest?.path ?? input.structural.targetPath,
      message: "Fan-in/fan-out pressure is concentrated in a small set of files.",
      impact: round4(centralityConcentration * 0.5),
    });
  }

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
        id: "quality.change_hygiene.churn_concentration",
        dimension: "changeHygiene",
        target: mostChurn?.filePath ?? input.structural.targetPath,
        message: "Churn is concentrated in a narrow part of the codebase.",
        impact: round4(churnConcentration * 0.45),
      });
    }

    if (volatilityConcentration >= 0.45) {
      const volatileFile = [...evolutionSourceFiles].sort(
        (a, b) => b.recentVolatility - a.recentVolatility || a.filePath.localeCompare(b.filePath),
      )[0];
      pushIssue(issues, {
        id: "quality.change_hygiene.volatility_concentration",
        dimension: "changeHygiene",
        target: volatileFile?.filePath ?? input.structural.targetPath,
        message: "Recent volatility is concentrated in files that change frequently.",
        impact: round4(volatilityConcentration * 0.4),
      });
    }

    if (couplingDensity >= 0.35 || couplingIntensity >= 0.45) {
      const strongestPair = [...sourcePairs].sort(
        (a, b) =>
          b.couplingScore - a.couplingScore ||
          `${a.fileA}|${a.fileB}`.localeCompare(`${b.fileA}|${b.fileB}`),
      )[0];
      pushIssue(issues, {
        id: "quality.change_hygiene.coupling_density",
        dimension: "changeHygiene",
        target:
          strongestPair === undefined
            ? input.structural.targetPath
            : `${strongestPair.fileA}<->${strongestPair.fileB}`,
        message: "Co-change relationships are dense, increasing coordination overhead.",
        impact: round4(average([couplingDensity, couplingIntensity]) * 0.35),
      });
    }
  }

  const modularityPenalty = clamp01(cyclePenalty * 0.55 + centralityConcentration * 0.45);
  const changeHygienePenalty = input.evolution.available
    ? clamp01(
        churnConcentration * 0.4 +
          volatilityConcentration * 0.35 +
          couplingDensity * 0.15 +
          couplingIntensity * 0.1,
      )
    : 0.25;

  const paths = filePaths(input.structural);
  const testFiles = paths.filter((path) => isTestPath(path)).length;
  const sourceFiles = paths.filter((path) => isSourcePath(path)).length;
  const testRatio = sourceFiles <= 0 ? 1 : testFiles / sourceFiles;

  const testPresencePenalty = sourceFiles <= 0 ? 0 : 1 - clamp01(testRatio / 0.3);
  if (sourceFiles > 0 && testRatio < 0.2) {
    pushIssue(issues, {
      id: "quality.test_health.low_test_presence",
      dimension: "testHealth",
      target: input.structural.targetPath,
      message: `Detected ${testFiles} test file(s) for ${sourceFiles} source file(s).`,
      severity: testRatio === 0 ? "error" : "warn",
      impact: round4(testPresencePenalty * 0.5),
    });
  }

  const todoFixmeCount = Math.max(0, input.todoFixmeCount ?? 0);
  const todoFixmePenalty = clamp01(todoFixmeCount / 120) * TODO_FIXME_MAX_IMPACT;
  if (todoFixmeCount > 0) {
    pushIssue(issues, {
      id: "quality.change_hygiene.todo_fixme_load",
      dimension: "changeHygiene",
      target: input.structural.targetPath,
      message: `Found ${todoFixmeCount} TODO/FIXME marker(s); cleanup debt is accumulating.`,
      impact: round4(todoFixmePenalty * 0.2),
    });
  }

  const modularityQuality = clamp01(1 - modularityPenalty);
  const changeHygieneQuality = clamp01(1 - clamp01(changeHygienePenalty + todoFixmePenalty));
  const testHealthQuality = clamp01(1 - testPresencePenalty);

  const normalizedScore = clamp01(
    modularityQuality * DIMENSION_WEIGHTS.modularity +
      changeHygieneQuality * DIMENSION_WEIGHTS.changeHygiene +
      testHealthQuality * DIMENSION_WEIGHTS.testHealth,
  );

  const topIssues = [...issues]
    .sort(
      (a, b) => b.impact - a.impact || a.id.localeCompare(b.id) || a.target.localeCompare(b.target),
    )
    .slice(0, 8)
    .map(({ impact: _impact, ...issue }) => issue);

  return {
    qualityScore: toPercentage(normalizedScore),
    normalizedScore: round4(normalizedScore),
    dimensions: {
      modularity: toPercentage(modularityQuality),
      changeHygiene: toPercentage(changeHygieneQuality),
      testHealth: toPercentage(testHealthQuality),
    },
    topIssues,
  };
};
