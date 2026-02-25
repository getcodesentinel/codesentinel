import type { RepositoryEvolutionSummary } from "@codesentinel/core";
import { computeRepositoryEvolutionSummary } from "../domain/evolution-metrics.js";
import {
  DEFAULT_EVOLUTION_CONFIG,
  type EvolutionComputationConfig,
} from "../domain/evolution-types.js";
import type { GitHistoryProvider, GitHistoryProgressEvent } from "./git-history-provider.js";

export type AnalyzeRepositoryEvolutionInput = {
  repositoryPath: string;
  config?: Partial<EvolutionComputationConfig>;
};

export type EvolutionAnalysisProgressEvent =
  | { stage: "checking_git_repository" }
  | { stage: "not_git_repository" }
  | { stage: "loading_commit_history" }
  | { stage: "computing_metrics" }
  | { stage: "analysis_completed"; available: boolean }
  | ({ stage: "history"; event: GitHistoryProgressEvent });

const createEffectiveConfig = (
  overrides: Partial<EvolutionComputationConfig> | undefined,
): EvolutionComputationConfig => ({
  ...DEFAULT_EVOLUTION_CONFIG,
  ...overrides,
});

export const analyzeRepositoryEvolution = (
  input: AnalyzeRepositoryEvolutionInput,
  historyProvider: GitHistoryProvider,
  onProgress?: (event: EvolutionAnalysisProgressEvent) => void,
): RepositoryEvolutionSummary => {
  onProgress?.({ stage: "checking_git_repository" });
  if (!historyProvider.isGitRepository(input.repositoryPath)) {
    onProgress?.({ stage: "not_git_repository" });
    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "not_git_repository",
    };
  }

  onProgress?.({ stage: "loading_commit_history" });
  const commits = historyProvider.getCommitHistory(input.repositoryPath, (event) =>
    onProgress?.({ stage: "history", event }),
  );
  const config = createEffectiveConfig(input.config);
  onProgress?.({ stage: "computing_metrics" });

  const summary = computeRepositoryEvolutionSummary(input.repositoryPath, commits, config);
  onProgress?.({ stage: "analysis_completed", available: summary.available });
  return summary;
};
