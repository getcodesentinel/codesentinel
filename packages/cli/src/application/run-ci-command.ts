import { readFile, writeFile } from "node:fs/promises";
import {
  BaselineRefResolutionError,
  GovernanceConfigurationError,
  evaluateGates,
  renderCheckMarkdown,
  resolveBaselineSnapshotFromRef,
  type GateConfig,
  type GateEvaluationResult,
} from "@codesentinel/governance";
import { relative, resolve } from "node:path";
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
  baselineRef?: string;
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

const isPathOutsideBase = (value: string): boolean => {
  return value === ".." || value.startsWith("../") || value.startsWith("..\\");
};

export const runCiCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  options: RunCiCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<CiCommandResult> => {
  if (options.baselinePath !== undefined && options.baselineRef !== undefined) {
    throw new GovernanceConfigurationError(
      "baseline configuration is ambiguous: use either --baseline or --baseline-ref",
    );
  }

  const resolvedTargetPath = resolve(inputPath ?? process.cwd());

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

  if (options.baselineRef !== undefined) {
    logger.info(`resolving baseline from git ref: ${options.baselineRef}`);
    try {
      const resolved = await resolveBaselineSnapshotFromRef({
        repositoryPath: resolvedTargetPath,
        baselineRef: options.baselineRef,
        analyzeWorktree: async (worktreePath, repositoryRoot) => {
          const relativeTargetPath = relative(repositoryRoot, resolvedTargetPath);
          if (isPathOutsideBase(relativeTargetPath)) {
            throw new GovernanceConfigurationError(
              `target path is outside git repository root: ${resolvedTargetPath}`,
            );
          }

          const baselineTargetPath =
            relativeTargetPath.length === 0 || relativeTargetPath === "."
              ? worktreePath
              : resolve(worktreePath, relativeTargetPath);

          return buildAnalysisSnapshot(
            baselineTargetPath,
            authorIdentityMode,
            { includeTrace: options.includeTrace },
            logger,
          );
        },
      });
      baseline = resolved.baselineSnapshot;
      logger.info(`baseline ref resolved to ${resolved.resolvedSha}`);
    } catch (error) {
      if (error instanceof BaselineRefResolutionError) {
        throw new GovernanceConfigurationError(
          `unable to resolve baseline ref '${options.baselineRef}': ${error.message}`,
        );
      }
      throw error;
    }
    diff = compareSnapshots(current, baseline);
  } else if (options.baselinePath !== undefined) {
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
