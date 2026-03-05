import { readFile, writeFile } from "node:fs/promises";
import {
  GovernanceConfigurationError,
  evaluateGates,
  renderCheckMarkdown,
  renderCheckText,
  type GateConfig,
  type GateEvaluationResult,
} from "@codesentinel/governance";
import { compareSnapshots, parseSnapshot, type CodeSentinelSnapshot } from "@codesentinel/reporter";
import { buildAnalysisSnapshot } from "./build-analysis-snapshot.js";
import { createSilentLogger, type Logger } from "./logger.js";
import type { AuthorIdentityCliMode, ScoringProfileCliMode } from "./run-analyze-command.js";

export type CheckOutputFormat = "json" | "text" | "md";

export type RunCheckCommandOptions = {
  baselinePath?: string;
  includeTrace: boolean;
  recentWindowDays?: number;
  scoringProfile?: ScoringProfileCliMode;
  gateConfig: GateConfig;
  outputFormat: CheckOutputFormat;
  outputPath?: string;
};

export type CheckCommandResult = {
  current: CodeSentinelSnapshot;
  baseline?: CodeSentinelSnapshot;
  diff?: ReturnType<typeof compareSnapshots>;
  gateResult: GateEvaluationResult;
  rendered: string;
};

const formatCheckResult = (result: CheckCommandResult, format: CheckOutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(
      {
        current: result.current,
        ...(result.baseline === undefined ? {} : { baseline: result.baseline }),
        ...(result.diff === undefined ? {} : { diff: result.diff }),
        violations: result.gateResult.violations,
        evaluatedGates: result.gateResult.evaluatedGates,
        highestSeverity: result.gateResult.highestSeverity,
        exitCode: result.gateResult.exitCode,
      },
      null,
      2,
    );
  }

  if (format === "md") {
    return renderCheckMarkdown(result.current, result.gateResult);
  }

  return renderCheckText(result.current, result.gateResult);
};

export const runCheckCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: RunCheckCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<CheckCommandResult> => {
  logger.info("building current snapshot for check");
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

  const rendered = formatCheckResult(
    {
      current,
      ...(baseline === undefined ? {} : { baseline }),
      ...(diff === undefined ? {} : { diff }),
      gateResult,
      rendered: "",
    },
    options.outputFormat,
  );

  if (options.outputPath !== undefined) {
    await writeFile(options.outputPath, rendered, "utf8");
    logger.info(`check output written: ${options.outputPath}`);
  }

  return {
    current,
    ...(baseline === undefined ? {} : { baseline }),
    ...(diff === undefined ? {} : { diff }),
    gateResult,
    rendered,
  };
};

export { GovernanceConfigurationError };
