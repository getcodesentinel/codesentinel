import type { RepositoryEvolutionSummary } from "@codesentinel/core";
import {
  analyzeRepositoryEvolution,
  type AnalyzeRepositoryEvolutionInput,
} from "./application/analyze-repository-evolution.js";
import { ExecGitCommandClient } from "./infrastructure/git-command-client.js";
import { GitCliHistoryProvider } from "./infrastructure/git-history-provider.js";

export type { AnalyzeRepositoryEvolutionInput } from "./application/analyze-repository-evolution.js";

export const analyzeRepositoryEvolutionFromGit = (
  input: AnalyzeRepositoryEvolutionInput,
): RepositoryEvolutionSummary => {
  const historyProvider = new GitCliHistoryProvider(new ExecGitCommandClient());
  return analyzeRepositoryEvolution(input, historyProvider);
};
