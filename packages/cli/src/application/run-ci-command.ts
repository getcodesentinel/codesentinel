import { readFile, writeFile } from "node:fs/promises";
import {
  GovernanceConfigurationError,
  evaluateGates,
  renderCheckMarkdown,
  type GateConfig,
  type GateEvaluationResult,
} from "@codesentinel/governance";
import {
  compareSnapshots,
  createReport,
  formatReport,
  parseSnapshot,
  type CodeSentinelSnapshot,
} from "@codesentinel/reporter";
import { buildAnalysisSnapshot } from "./build-analysis-snapshot.js";
import { createSilentLogger, type Logger } from "./logger.js";
import type { AuthorIdentityCliMode } from "./run-analyze-command.js";

export type RunCiCommandOptions = {
  baselinePath?: string;
  snapshotPath?: string;
  reportPath?: string;
  jsonOutputPath?: string;
  includeTrace: boolean;
  gateConfig: GateConfig;
};

export type CiCommandResult = {
  current: CodeSentinelSnapshot;
  baseline?: CodeSentinelSnapshot;
  diff?: ReturnType<typeof compareSnapshots>;
  gateResult: GateEvaluationResult;
  markdownSummary: string;
  machineReadable: {
    current: CodeSentinelSnapshot;
    baseline?: CodeSentinelSnapshot;
    diff?: ReturnType<typeof compareSnapshots>;
    violations: GateEvaluationResult["violations"];
    highestSeverity: GateEvaluationResult["highestSeverity"];
    exitCode: GateEvaluationResult["exitCode"];
  };
};

export const runCiCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: RunCiCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<CiCommandResult> => {
  logger.info("building current snapshot");
  const current = await buildAnalysisSnapshot(
    inputPath,
    authorIdentityMode,
    { includeTrace: options.includeTrace },
    logger,
  );

  if (options.snapshotPath !== undefined) {
    await writeFile(options.snapshotPath, JSON.stringify(current, null, 2), "utf8");
    logger.info(`snapshot written: ${options.snapshotPath}`);
  }

  let baseline: CodeSentinelSnapshot | undefined;
  let diff: ReturnType<typeof compareSnapshots> | undefined;

  if (options.baselinePath !== undefined) {
    logger.info(`loading baseline snapshot: ${options.baselinePath}`);
    const baselineRaw = await readFile(options.baselinePath, "utf8");
    try {
      baseline = parseSnapshot(baselineRaw);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid baseline snapshot";
      throw new GovernanceConfigurationError(`invalid baseline snapshot: ${message}`);
    }
    diff = compareSnapshots(current, baseline);
  }

  const gateResult = evaluateGates({
    current,
    ...(baseline === undefined ? {} : { baseline }),
    ...(diff === undefined ? {} : { diff }),
    gateConfig: options.gateConfig,
  });

  const report = createReport(current, diff);
  const reportMarkdown = formatReport(report, "md");
  const ciMarkdown = renderCheckMarkdown(current, gateResult);
  const markdownSummary = `${reportMarkdown}\n\n${ciMarkdown}`;

  if (options.reportPath !== undefined) {
    await writeFile(options.reportPath, markdownSummary, "utf8");
    logger.info(`report written: ${options.reportPath}`);
  }

  const machineReadable = {
    current,
    ...(baseline === undefined ? {} : { baseline }),
    ...(diff === undefined ? {} : { diff }),
    violations: gateResult.violations,
    highestSeverity: gateResult.highestSeverity,
    exitCode: gateResult.exitCode,
  };

  if (options.jsonOutputPath !== undefined) {
    await writeFile(options.jsonOutputPath, JSON.stringify(machineReadable, null, 2), "utf8");
    logger.info(`ci machine output written: ${options.jsonOutputPath}`);
  }

  return {
    current,
    ...(baseline === undefined ? {} : { baseline }),
    ...(diff === undefined ? {} : { diff }),
    gateResult,
    markdownSummary,
    machineReadable,
  };
};

export { GovernanceConfigurationError };
