import type { RepositoryEvolutionSummary } from "@codesentinel/core";
import { computeRepositoryEvolutionSummary } from "../domain/evolution-metrics.js";
import {
  DEFAULT_EVOLUTION_CONFIG,
  type EvolutionComputationConfig,
} from "../domain/evolution-types.js";
import type { GitHistoryProvider } from "./git-history-provider.js";

export type AnalyzeRepositoryEvolutionInput = {
  repositoryPath: string;
  config?: Partial<EvolutionComputationConfig>;
};

const createEffectiveConfig = (
  overrides: Partial<EvolutionComputationConfig> | undefined,
): EvolutionComputationConfig => ({
  ...DEFAULT_EVOLUTION_CONFIG,
  ...overrides,
});

export const analyzeRepositoryEvolution = (
  input: AnalyzeRepositoryEvolutionInput,
  historyProvider: GitHistoryProvider,
): RepositoryEvolutionSummary => {
  if (!historyProvider.isGitRepository(input.repositoryPath)) {
    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "not_git_repository",
    };
  }

  const commits = historyProvider.getCommitHistory(input.repositoryPath);
  const config = createEffectiveConfig(input.config);

  return computeRepositoryEvolutionSummary(input.repositoryPath, commits, config);
};
