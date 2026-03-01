import { readFile, writeFile } from "node:fs/promises";
import type { AnalyzeSummary } from "@codesentinel/core";
import { evaluateRepositoryRisk } from "@codesentinel/risk-engine";
import {
  compareSnapshots,
  createReport,
  createSnapshot,
  formatReport,
  parseSnapshot,
  type CodeSentinelReport,
  type CodeSentinelSnapshot,
  type ReportFormat,
} from "@codesentinel/reporter";
import {
  collectAnalysisInputs,
  type AuthorIdentityCliMode,
} from "./run-analyze-command.js";
import { createSilentLogger, type Logger } from "./logger.js";

export type ReportCommandOptions = {
  format: ReportFormat;
  comparePath?: string;
  outputPath?: string;
  snapshotPath?: string;
  includeTrace: boolean;
};

const buildSnapshot = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  includeTrace: boolean,
  logger: Logger,
): Promise<CodeSentinelSnapshot> => {
  const analysisInputs = await collectAnalysisInputs(inputPath, authorIdentityMode, logger);
  const evaluation = evaluateRepositoryRisk(analysisInputs, { explain: includeTrace });

  const summary: AnalyzeSummary = {
    ...analysisInputs,
    risk: evaluation.summary,
  };

  return createSnapshot({
    analysis: summary,
    ...(evaluation.trace === undefined ? {} : { trace: evaluation.trace }),
    analysisConfig: {
      authorIdentityMode,
      includeTrace,
    },
  });
};

export const runReportCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: ReportCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<{ report: CodeSentinelReport; rendered: string }> => {
  logger.info("building analysis snapshot");
  const current = await buildSnapshot(inputPath, authorIdentityMode, options.includeTrace, logger);

  if (options.snapshotPath !== undefined) {
    await writeFile(options.snapshotPath, JSON.stringify(current, null, 2), "utf8");
    logger.info(`snapshot written: ${options.snapshotPath}`);
  }

  let report: CodeSentinelReport;
  if (options.comparePath === undefined) {
    report = createReport(current);
  } else {
    logger.info(`loading baseline snapshot: ${options.comparePath}`);
    const baselineRaw = await readFile(options.comparePath, "utf8");
    const baseline = parseSnapshot(baselineRaw);
    const diff = compareSnapshots(current, baseline);
    report = createReport(current, diff);
  }

  const rendered = formatReport(report, options.format);

  if (options.outputPath !== undefined) {
    await writeFile(options.outputPath, rendered, "utf8");
    logger.info(`report written: ${options.outputPath}`);
  }

  return { report, rendered };
};
