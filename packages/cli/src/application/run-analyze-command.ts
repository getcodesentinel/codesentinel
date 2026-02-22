import { buildProjectGraphSummary } from "@codesentinel/code-graph";
import { resolveTargetPath } from "@codesentinel/core";

export const runAnalyzeCommand = (inputPath: string | undefined): string => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  const target = resolveTargetPath(inputPath, invocationCwd);
  const summary = buildProjectGraphSummary({ projectPath: target.absolutePath });
  return JSON.stringify(summary, null, 2);
};
