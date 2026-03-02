import type { AnalyzeSummary } from "@codesentinel/core";
import { evaluateRepositoryRisk } from "@codesentinel/risk-engine";
import { createSnapshot, type CodeSentinelSnapshot } from "@codesentinel/reporter";
import { collectAnalysisInputs, type AuthorIdentityCliMode } from "./run-analyze-command.js";
import type { Logger } from "./logger.js";

export type BuildAnalysisSnapshotOptions = {
  includeTrace: boolean;
  recentWindowDays?: number;
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
      ...(options.recentWindowDays === undefined ? {} : { recentWindowDays: options.recentWindowDays }),
    },
    logger,
  );
  const evaluation = evaluateRepositoryRisk(analysisInputs, { explain: options.includeTrace });

  const summary: AnalyzeSummary = {
    ...analysisInputs,
    risk: evaluation.summary,
  };

  return createSnapshot({
    analysis: summary,
    ...(evaluation.trace === undefined ? {} : { trace: evaluation.trace }),
    analysisConfig: {
      authorIdentityMode,
      includeTrace: options.includeTrace,
      recentWindowDays: analysisInputs.evolution.available
        ? analysisInputs.evolution.metrics.recentWindowDays
        : options.recentWindowDays ?? null,
    },
  });
};
