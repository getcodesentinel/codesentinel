import { readFile, writeFile } from "node:fs/promises";
import {
  compareSnapshots,
  createReport,
  formatReport,
  parseSnapshot,
  type CodeSentinelReport,
  type ReportFormat,
} from "@codesentinel/reporter";
import { type AuthorIdentityCliMode, type ScoringProfileCliMode } from "./run-analyze-command.js";
import { createSilentLogger, type Logger } from "./logger.js";
import { buildAnalysisSnapshot } from "./build-analysis-snapshot.js";

export type ReportCommandOptions = {
  format: ReportFormat;
  comparePath?: string;
  outputPath?: string;
  snapshotPath?: string;
  includeTrace: boolean;
  recentWindowDays?: number;
  scoringProfile?: ScoringProfileCliMode;
};

export const runReportCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: ReportCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<{ report: CodeSentinelReport; rendered: string }> => {
  logger.info("building analysis snapshot");
  const current = await buildAnalysisSnapshot(
    inputPath,
    authorIdentityMode,
    {
      includeTrace: options.includeTrace,
      ...(options.scoringProfile === undefined ? {} : { scoringProfile: options.scoringProfile }),
      ...(options.recentWindowDays === undefined
        ? {}
        : { recentWindowDays: options.recentWindowDays }),
    },
    logger,
  );

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
