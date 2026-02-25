import { resolve } from "node:path";
import { buildProjectGraphSummary } from "@codesentinel/code-graph";
import { analyzeRepositoryEvolutionFromGit } from "@codesentinel/git-analyzer";
import type { AnalyzeSummary } from "@codesentinel/core";

export type AuthorIdentityCliMode = "likely_merge" | "strict_email";

const resolveTargetPath = (inputPath: string | undefined, cwd: string): string =>
  resolve(cwd, inputPath ?? ".");

export const runAnalyzeCommand = (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
): string => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  const targetPath = resolveTargetPath(inputPath, invocationCwd);

  const structural = buildProjectGraphSummary({ projectPath: targetPath });
  const evolution = analyzeRepositoryEvolutionFromGit({
    repositoryPath: targetPath,
    config: { authorIdentityMode },
  });

  const summary: AnalyzeSummary = {
    structural,
    evolution,
  };

  return JSON.stringify(summary, null, 2);
};
