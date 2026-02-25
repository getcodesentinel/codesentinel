import { resolve } from "node:path";
import { buildProjectGraphSummary } from "@codesentinel/code-graph";
import { analyzeDependencyExposureFromProject } from "@codesentinel/dependency-firewall";
import { analyzeRepositoryEvolutionFromGit } from "@codesentinel/git-analyzer";
import type { AnalyzeSummary } from "@codesentinel/core";

export type AuthorIdentityCliMode = "likely_merge" | "strict_email";

const resolveTargetPath = (inputPath: string | undefined, cwd: string): string =>
  resolve(cwd, inputPath ?? ".");

export const runAnalyzeCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
): Promise<string> => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  const targetPath = resolveTargetPath(inputPath, invocationCwd);

  const structural = buildProjectGraphSummary({ projectPath: targetPath });
  const evolution = analyzeRepositoryEvolutionFromGit({
    repositoryPath: targetPath,
    config: { authorIdentityMode },
  });
  const external = await analyzeDependencyExposureFromProject({ repositoryPath: targetPath });

  const summary: AnalyzeSummary = {
    structural,
    evolution,
    external,
  };

  return JSON.stringify(summary, null, 2);
};
