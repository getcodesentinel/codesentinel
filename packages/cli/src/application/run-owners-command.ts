import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_MIN_COMMITS, type OwnershipAudit } from "@codesentinel/ownership";
import {
  buildOwnershipAudit,
  DEFAULT_OWNERS_REF,
  DEFAULT_OWNERS_WINDOW_DAYS,
} from "./build-ownership-audit.js";
import {
  buildOwnersReport,
  evaluateOwnersThresholds,
  formatOwnersOutput,
  type OwnersOutputFormat,
  type OwnersReport,
  type OwnersThresholdConfig,
} from "./format-owners-output.js";
import { createSilentLogger, type Logger } from "./logger.js";

export {
  DEFAULT_OWNERS_ALIASES_PATH,
  DEFAULT_OWNERS_REF,
  DEFAULT_OWNERS_WINDOW_DAYS,
  OwnersConfigurationError,
} from "./build-ownership-audit.js";

/**
 * Application layer for `codesentinel owners`: reads everything the audit needs from a git ref,
 * runs the pure audit and renders it.
 *
 * The command is offline by contract. The only inputs are the repository at `--ref`, the optional
 * versioned alias map and the structural analysis of the working tree.
 */

/** ESLint-style exit codes fixed by the design, so a gate can tell "problems" from "broken". */
export const OWNERS_EXIT_CODES = {
  ok: 0,
  thresholdExceeded: 1,
  invalidConfiguration: 2,
} as const;

export const DEFAULT_OWNERS_TOP = 10;

export type OwnersCommandOptions = {
  codeownersPath?: string;
  ref?: string;
  windowDays?: number;
  minCommits?: number;
  top?: number;
  format?: OwnersOutputFormat;
  outputPath?: string;
  aliasesPath?: string;
  resolveGithub?: boolean;
  thresholds?: Partial<OwnersThresholdConfig>;
};

export type OwnersCommandResult = {
  audit: OwnershipAudit;
  report: OwnersReport;
  rendered: string;
  exitCode: number;
  trackedFileCount: number;
  outputPath?: string;
};

const DEFAULT_THRESHOLDS: OwnersThresholdConfig = {
  failOn: "none",
  maxUnownedCritical: null,
  maxGhostOwners: null,
  maxDrift: null,
};

const resolveTargetPath = (inputPath: string | undefined): string => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  return resolve(invocationCwd, inputPath ?? ".");
};

const normalizeThresholds = (
  input: Partial<OwnersThresholdConfig> | undefined,
): OwnersThresholdConfig => ({
  failOn: input?.failOn ?? DEFAULT_THRESHOLDS.failOn,
  maxUnownedCritical: input?.maxUnownedCritical ?? DEFAULT_THRESHOLDS.maxUnownedCritical,
  maxGhostOwners: input?.maxGhostOwners ?? DEFAULT_THRESHOLDS.maxGhostOwners,
  maxDrift: input?.maxDrift ?? DEFAULT_THRESHOLDS.maxDrift,
});

const resolveExitCode = (
  failOn: OwnersThresholdConfig["failOn"],
  violationCount: number,
): number => {
  if (failOn === "none" || violationCount === 0) {
    return OWNERS_EXIT_CODES.ok;
  }
  return failOn === "error" ? OWNERS_EXIT_CODES.thresholdExceeded : OWNERS_EXIT_CODES.ok;
};

export const runOwnersCommand = async (
  inputPath: string | undefined,
  options: OwnersCommandOptions = {},
  logger: Logger = createSilentLogger(),
): Promise<OwnersCommandResult> => {
  const targetPath = resolveTargetPath(inputPath);
  const ref = options.ref ?? DEFAULT_OWNERS_REF;
  const windowDays = options.windowDays ?? DEFAULT_OWNERS_WINDOW_DAYS;
  const minCommits = options.minCommits ?? DEFAULT_MIN_COMMITS;
  const top = options.top ?? DEFAULT_OWNERS_TOP;
  const format = options.format ?? "console";
  const thresholds = normalizeThresholds(options.thresholds);

  logger.info(`auditing declared ownership at ${ref} in ${targetPath}`);

  const callerWarnings: string[] = [];
  if (options.resolveGithub === true) {
    callerWarnings.push(
      "--resolve-github is not implemented in this iteration; the audit stays offline and declared owners were resolved from local history only.",
    );
    logger.warn(callerWarnings[callerWarnings.length - 1] ?? "");
  }

  const { audit, trackedFileCount } = await buildOwnershipAudit(
    targetPath,
    {
      ref,
      windowDays,
      minCommits,
      ...(options.codeownersPath === undefined ? {} : { codeownersPath: options.codeownersPath }),
      ...(options.aliasesPath === undefined ? {} : { aliasesPath: options.aliasesPath }),
      warnings: callerWarnings,
    },
    logger,
  );

  const metrics = audit.available ? audit.metrics : null;
  const violations = evaluateOwnersThresholds(metrics, thresholds);

  if (metrics === null && hasConfiguredThreshold(thresholds)) {
    logger.warn("no CODEOWNERS file was found; thresholds cannot be evaluated.");
  }
  if (violations.length > 0) {
    for (const violation of violations) {
      logger.warn(`threshold exceeded (${thresholds.failOn}): ${violation.message}`);
    }
  }

  const report = buildOwnersReport({
    audit,
    ref,
    windowDays,
    minCommits,
    trackedFileCount,
    thresholds,
    violations,
  });
  const rendered = formatOwnersOutput(report, format, top);

  if (options.outputPath !== undefined) {
    await writeFile(options.outputPath, `${rendered}\n`, "utf8");
    logger.info(`owners output written: ${options.outputPath}`);
  }

  return {
    audit,
    report,
    rendered,
    exitCode: resolveExitCode(thresholds.failOn, violations.length),
    trackedFileCount,
    ...(options.outputPath === undefined ? {} : { outputPath: options.outputPath }),
  };
};

const hasConfiguredThreshold = (thresholds: OwnersThresholdConfig): boolean =>
  thresholds.maxUnownedCritical !== null ||
  thresholds.maxGhostOwners !== null ||
  thresholds.maxDrift !== null;
