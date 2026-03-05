import type { AnalyzeSummary } from "@codesentinel/core";
import { computeRepositoryHealthSummary } from "@codesentinel/health-engine";
import { evaluateRepositoryRisk } from "@codesentinel/risk-engine";
import { createSnapshot, type CodeSentinelSnapshot } from "@codesentinel/reporter";
import {
  collectAnalysisInputs,
  resolveHealthConfigForProfile,
  resolveRiskConfigForProfile,
  type AuthorIdentityCliMode,
  type ScoringProfileCliMode,
} from "./run-analyze-command.js";
import type { Logger } from "./logger.js";

export type BuildAnalysisSnapshotOptions = {
  includeTrace: boolean;
  recentWindowDays?: number;
  scoringProfile?: ScoringProfileCliMode;
};

export const buildAnalysisSnapshot = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: BuildAnalysisSnapshotOptions,
  logger: Logger,
): Promise<CodeSentinelSnapshot> => {
  const analysisInputs = await collectAnalysisInputs(
    inputPath,
    authorIdentityMode,
    {
      ...(options.recentWindowDays === undefined
        ? {}
        : { recentWindowDays: options.recentWindowDays }),
    },
    logger,
  );
  const riskConfig = resolveRiskConfigForProfile(options.scoringProfile);
  const healthConfig = resolveHealthConfigForProfile(options.scoringProfile);
  const evaluation = evaluateRepositoryRisk(
    {
      structural: analysisInputs.structural,
      evolution: analysisInputs.evolution,
      external: analysisInputs.external,
      ...(riskConfig === undefined ? {} : { config: riskConfig }),
    },
    { explain: options.includeTrace },
  );

  const summary: AnalyzeSummary = {
    structural: analysisInputs.structural,
    evolution: analysisInputs.evolution,
    external: analysisInputs.external,
    risk: evaluation.summary,
    health: computeRepositoryHealthSummary({
      structural: analysisInputs.structural,
      evolution: analysisInputs.evolution,
      ...(healthConfig === undefined ? {} : { config: healthConfig }),
    }),
  };

  return createSnapshot({
    analysis: summary,
    ...(evaluation.trace === undefined ? {} : { trace: evaluation.trace }),
    analysisConfig: {
      authorIdentityMode,
      includeTrace: options.includeTrace,
      scoringProfile: options.scoringProfile ?? "default",
      recentWindowDays: analysisInputs.evolution.available
        ? analysisInputs.evolution.metrics.recentWindowDays
        : (options.recentWindowDays ?? null),
    },
  });
};
