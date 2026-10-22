import { writeFile } from "node:fs/promises";
import {
  buildTrendReport,
  formatTrendOutput,
  type TrendOutputFormat,
  type TrendReport,
} from "./format-trend-output.js";
import { createSilentLogger, type Logger } from "./logger.js";
import { readTrendSnapshots } from "./read-trend-snapshots.js";

export { TrendConfigurationError } from "./read-trend-snapshots.js";

/**
 * Application layer for `codesentinel trend`: discovers snapshot artifacts, builds the stable
 * payload and renders it. The command never writes history into the repository.
 */

export const TREND_EXIT_CODES = {
  ok: 0,
  invalidConfiguration: 2,
} as const;

export type TrendCommandOptions = {
  from?: string;
  since?: string;
  last?: number;
  format?: TrendOutputFormat;
  outputPath?: string;
  now?: () => Date;
};

export type TrendCommandResult = {
  report: TrendReport;
  rendered: string;
  exitCode: number;
  outputPath?: string;
};

export const runTrendCommand = async (
  options: TrendCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<TrendCommandResult> => {
  const format = options.format ?? "console";
  const { series, warnings } = await readTrendSnapshots({
    ...(options.from === undefined ? {} : { from: options.from }),
    ...(options.since === undefined ? {} : { since: options.since }),
    ...(options.last === undefined ? {} : { last: options.last }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const report = buildTrendReport(series, warnings);
  const rendered = formatTrendOutput(report, format);
  logger.debug(`trend series: ${report.series.length} snapshot(s)`);

  if (options.outputPath !== undefined) {
    await writeFile(options.outputPath, `${rendered}\n`, "utf8");
    logger.info(`trend output written: ${options.outputPath}`);
  }

  return {
    report,
    rendered,
    exitCode: TREND_EXIT_CODES.ok,
    ...(options.outputPath === undefined ? {} : { outputPath: options.outputPath }),
  };
};
