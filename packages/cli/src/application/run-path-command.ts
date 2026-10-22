import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { CODEOWNERS_CANDIDATE_PATHS, type OwnershipAudit } from "@codesentinel/ownership";
import {
  buildReadingPath,
  DEFAULT_MAX_STEPS,
  ReadingPathError,
  type ReadingPath,
} from "@codesentinel/reading-path";
import {
  buildOwnershipAudit,
  DEFAULT_OWNERS_REF,
  DEFAULT_OWNERS_WINDOW_DAYS,
  OwnersConfigurationError,
} from "./build-ownership-audit.js";
import { formatPathOutput, type PathOutputFormat } from "./format-path-output.js";
import { createSilentLogger, type Logger } from "./logger.js";
import { normalizeRepositoryPath, readRepositoryContext } from "./owners-git.js";
import { collectStructuralEvolutionInputs } from "./run-analyze-command.js";

/**
 * Application layer for `codesentinel path`: validates the target, reuses the analysis pipeline
 * and renders a deterministic reading path. It never writes to stdout; the CLI does that.
 */

export const PATH_EXIT_CODES = {
  ok: 0,
  invalidTarget: 2,
} as const;

export class PathConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathConfigurationError";
  }
}

export const DEFAULT_PATH_WINDOW_DAYS = DEFAULT_OWNERS_WINDOW_DAYS;

export type PathCommandOptions = {
  maxSteps?: number;
  format?: PathOutputFormat;
  outputPath?: string;
  windowDays?: number;
  includeTests?: boolean;
  ref?: string;
};

export type PathCommandResult = {
  readingPath: ReadingPath;
  rendered: string;
  exitCode: number;
  repositoryPath: string;
  relativeTarget: string;
  outputPath?: string;
};

const resolveRelativeTarget = (
  repositoryPath: string,
  target: string,
  invocationCwd: string,
): string => {
  const absoluteTarget = resolve(invocationCwd, target);
  const relativeTarget = relative(repositoryPath, absoluteTarget);

  if (relativeTarget === "" || relativeTarget === ".") {
    throw new PathConfigurationError(
      `target "${target}" is the repository root; pass a module directory or a file.`,
    );
  }

  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new PathConfigurationError(
      `target "${target}" is outside the repository at "${repositoryPath}".`,
    );
  }

  if (!existsSync(absoluteTarget)) {
    throw new PathConfigurationError(`target "${target}" does not exist in the repository.`);
  }

  const stats = statSync(absoluteTarget);
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new PathConfigurationError(`target "${target}" is not a regular file or directory.`);
  }

  return normalizeRepositoryPath(relativeTarget);
};

const hasCodeownersFile = (repositoryPath: string): boolean =>
  CODEOWNERS_CANDIDATE_PATHS.some((candidate) => existsSync(join(repositoryPath, candidate)));

type ResolvedOwnership = {
  ownership: OwnershipAudit | null;
  warnings: readonly string[];
};

const resolveOwnership = async (
  repositoryPath: string,
  ref: string,
  windowDays: number,
  logger: Logger,
): Promise<ResolvedOwnership> => {
  if (!hasCodeownersFile(repositoryPath)) {
    logger.info("ownership skipped: no CODEOWNERS file found");
    return {
      ownership: null,
      warnings: ["no CODEOWNERS file found: declared owners are not reported"],
    };
  }

  let audit: OwnershipAudit;
  try {
    const result = await buildOwnershipAudit(repositoryPath, { ref, windowDays }, logger);
    audit = result.audit;
  } catch (error) {
    if (error instanceof OwnersConfigurationError) {
      throw new PathConfigurationError(error.message);
    }
    throw error;
  }

  if (!audit.available) {
    logger.info(`ownership unavailable: CODEOWNERS was not found at ${ref}`);
    return {
      ownership: audit,
      warnings: [`CODEOWNERS was not found at ${ref}: declared owners are not reported`],
    };
  }

  logger.info(`ownership report: CODEOWNERS found for ${audit.files.length} files`);
  return { ownership: audit, warnings: [] };
};

const readTestScript = async (repositoryPath: string): Promise<string | null> => {
  let raw: string;
  try {
    raw = await readFile(join(repositoryPath, "package.json"), "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) return null;
  const test = (scripts as { test?: unknown }).test;
  if (typeof test !== "string" || test.trim().length === 0) return null;
  return test;
};

const resolveTestCommand = (repositoryPath: string): string | null => {
  if (existsSync(join(repositoryPath, "pnpm-lock.yaml"))) return "pnpm test";
  if (existsSync(join(repositoryPath, "yarn.lock"))) return "yarn test";
  if (
    existsSync(join(repositoryPath, "bun.lockb")) ||
    existsSync(join(repositoryPath, "bun.lock"))
  ) {
    return "bun test";
  }
  return "npm test";
};

const collectSuggestedCommands = async (repositoryPath: string): Promise<readonly string[]> => {
  const testScript = await readTestScript(repositoryPath);
  if (testScript === null) return [];
  const command = resolveTestCommand(repositoryPath);
  return command === null ? [] : [command];
};

export const runPathCommand = async (
  target: string,
  options: PathCommandOptions = {},
  logger: Logger = createSilentLogger(),
): Promise<PathCommandResult> => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  const ref = options.ref ?? DEFAULT_OWNERS_REF;
  const windowDays = options.windowDays ?? DEFAULT_PATH_WINDOW_DAYS;
  const format = options.format ?? "console";
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const context = readRepositoryContext(invocationCwd, ref);
  if (context === null) {
    throw new PathConfigurationError(
      `"path" requires a git work tree and a ref that resolves to a commit: could not resolve "${ref}" from "${invocationCwd}".`,
    );
  }
  logger.info(`reading path repository: ${context.repositoryPath} at ${ref}`);

  const relativeTarget = resolveRelativeTarget(context.repositoryPath, target, invocationCwd);
  logger.info(`reading path target: ${relativeTarget}`);

  const { structural, evolution } = collectStructuralEvolutionInputs(
    context.repositoryPath,
    "likely_merge",
    { recentWindowDays: windowDays },
    logger,
  );

  const ownership = await resolveOwnership(context.repositoryPath, ref, windowDays, logger);

  let readingPath: ReadingPath;
  try {
    readingPath = buildReadingPath({
      target: relativeTarget,
      graph: structural,
      evolution,
      ownership: ownership.ownership,
      maxSteps,
      includeTests: options.includeTests === true,
    });
  } catch (error) {
    if (error instanceof ReadingPathError) {
      throw new PathConfigurationError(error.message);
    }
    throw error;
  }

  const commands = await collectSuggestedCommands(context.repositoryPath);
  const completedPath: ReadingPath = {
    ...readingPath,
    commands,
    warnings: [...readingPath.warnings, ...ownership.warnings],
  };
  logger.debug(
    `reading path built: steps=${completedPath.steps.length}, people=${completedPath.people.length}, commands=${completedPath.commands.length}, truncated=${completedPath.truncated}`,
  );
  logger.info(`reading path built: ${completedPath.steps.length} steps`);

  const rendered = formatPathOutput(completedPath, format);
  const absoluteOutputPath =
    options.outputPath === undefined ? undefined : resolve(invocationCwd, options.outputPath);

  if (absoluteOutputPath !== undefined) {
    await writeFile(absoluteOutputPath, `${rendered}\n`, "utf8");
    logger.info(`reading path output written: ${absoluteOutputPath}`);
  }

  return {
    readingPath: completedPath,
    rendered,
    exitCode: PATH_EXIT_CODES.ok,
    repositoryPath: context.repositoryPath,
    relativeTarget,
    ...(absoluteOutputPath === undefined ? {} : { outputPath: absoluteOutputPath }),
  };
};
