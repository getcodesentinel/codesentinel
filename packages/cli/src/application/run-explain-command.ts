import type { AnalyzeSummary, RiskTrace, TargetTrace } from "@codesentinel/core";
import { evaluateRepositoryRisk } from "@codesentinel/risk-engine";
import {
  collectAnalysisInputs,
  type AuthorIdentityCliMode,
} from "./run-analyze-command.js";
import { createSilentLogger, type Logger } from "./logger.js";

export type ExplainFormat = "text" | "json" | "md";

export type ExplainCommandOptions = {
  file?: string;
  module?: string;
  top: number;
  format: ExplainFormat;
};

export type ExplainResult = {
  summary: AnalyzeSummary;
  trace: RiskTrace;
  selectedTargets: readonly TargetTrace[];
};

const selectTargets = (
  trace: RiskTrace,
  summary: AnalyzeSummary,
  options: ExplainCommandOptions,
): readonly TargetTrace[] => {
  if (options.file !== undefined) {
    const normalized = options.file.replaceAll("\\", "/");
    return trace.targets.filter(
      (target) => target.targetType === "file" && target.targetId === normalized,
    );
  }

  if (options.module !== undefined) {
    return trace.targets.filter(
      (target) => target.targetType === "module" && target.targetId === options.module,
    );
  }

  const top = Math.max(1, options.top);
  const topFiles = summary.risk.hotspots.slice(0, top).map((entry) => entry.file);
  const fileSet = new Set(topFiles);
  return trace.targets.filter(
    (target) => target.targetType === "repository" || (target.targetType === "file" && fileSet.has(target.targetId)),
  );
};

export const runExplainCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: ExplainCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<ExplainResult> => {
  const analysisInputs = await collectAnalysisInputs(inputPath, authorIdentityMode, logger);
  logger.info("computing explainable risk summary");

  const evaluation = evaluateRepositoryRisk(analysisInputs, { explain: true });
  if (evaluation.trace === undefined) {
    throw new Error("risk trace unavailable");
  }

  const summary: AnalyzeSummary = {
    ...analysisInputs,
    risk: evaluation.summary,
  };
  logger.info(`explanation completed (repositoryScore=${summary.risk.repositoryScore})`);

  return {
    summary,
    trace: evaluation.trace,
    selectedTargets: selectTargets(evaluation.trace, summary, options),
  };
};
