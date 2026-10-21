import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildProjectGraphSummary } from "@codesentinel/code-graph";
import {
  CODEOWNERS_CANDIDATE_PATHS,
  CodeownersError,
  DEFAULT_MIN_COMMITS,
  auditOwnership,
  discoverCodeowners,
  parseCodeowners,
  parseOwnerAliases,
  type OwnerAliases,
  type OwnershipAudit,
  type OwnershipFileEvidence,
  type ParsedCodeowners,
} from "@codesentinel/ownership";
import {
  OwnersGitError,
  collectOwnershipEvidence,
  normalizeRepositoryPath,
  readRepositorySnapshot,
  readTextAtRef,
  type RepositorySnapshot,
} from "./owners-git.js";
import {
  buildOwnersReport,
  evaluateOwnersThresholds,
  formatOwnersOutput,
  type OwnersOutputFormat,
  type OwnersReport,
  type OwnersThresholdConfig,
} from "./format-owners-output.js";
import { createSilentLogger, type Logger } from "./logger.js";

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

export const DEFAULT_OWNERS_WINDOW_DAYS = 90;
export const DEFAULT_OWNERS_TOP = 10;
export const DEFAULT_OWNERS_REF = "HEAD";
export const DEFAULT_OWNERS_ALIASES_PATH = ".codesentinel/owners.json";

export class OwnersConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnersConfigurationError";
  }
}

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

const readSnapshot = (targetPath: string, ref: string): RepositorySnapshot => {
  try {
    return readRepositorySnapshot(targetPath, ref);
  } catch (error) {
    if (error instanceof OwnersGitError) {
      throw new OwnersConfigurationError(error.message);
    }
    throw error;
  }
};

type ReadCodeownersInput = {
  snapshot: RepositorySnapshot;
  explicitPath: string | undefined;
};

const readCodeowners = (input: ReadCodeownersInput): ParsedCodeowners | null => {
  const trackedFileSet = new Set(input.snapshot.trackedFiles);
  const explicitPath =
    input.explicitPath === undefined ? null : normalizeRepositoryPath(input.explicitPath);

  const selection =
    explicitPath === null
      ? discoverCodeowners(
          CODEOWNERS_CANDIDATE_PATHS.filter((candidate) => trackedFileSet.has(candidate)),
        )
      : { source: explicitPath, ignoredSources: [] as readonly string[] };

  if (selection === null) {
    return null;
  }
  if (!trackedFileSet.has(selection.source)) {
    throw new OwnersConfigurationError(
      `CODEOWNERS file "${selection.source}" is not tracked at ref "${input.snapshot.ref}".`,
    );
  }

  const text = readTextAtRef(input.snapshot.repositoryPath, input.snapshot.ref, selection.source);
  return parseCodeowners(text, {
    source: selection.source,
    ignoredSources: selection.ignoredSources,
  });
};

type OwnerAliasesSource = {
  aliases: OwnerAliases;
  warnings: readonly string[];
};

/**
 * The alias map is versioned, so it is read from the audited ref when it is tracked there.
 * Otherwise the working-tree copy is used and the degradation is reported, because an alias map
 * that silently changes identity results is exactly the kind of hidden input this command avoids.
 */
const readOwnerAliases = async (
  snapshot: RepositorySnapshot,
  aliasesPath: string,
): Promise<OwnerAliasesSource> => {
  const normalized = normalizeRepositoryPath(aliasesPath);
  const tracked = snapshot.trackedFiles.includes(normalized);

  if (tracked) {
    const text = readTextAtRef(snapshot.repositoryPath, snapshot.ref, normalized);
    const parsed = parseOwnerAliases(text);
    return { aliases: parsed.aliases, warnings: parsed.warnings };
  }

  const workingTreePath = resolve(snapshot.repositoryPath, normalized);
  if (existsSync(workingTreePath)) {
    const text = await readFile(workingTreePath, "utf8");
    const parsed = parseOwnerAliases(text);
    return {
      aliases: parsed.aliases,
      warnings: [
        ...parsed.warnings,
        `Identity aliases were read from the working tree because "${normalized}" is not tracked at "${snapshot.ref}".`,
      ],
    };
  }

  return { aliases: {}, warnings: [] };
};

/**
 * Structural fan-in is optional enrichment: when the project cannot be parsed the audit degrades to
 * the churn fallback and says so in its warnings rather than inventing criticality.
 */
const collectFanInByPath = (
  projectPath: string,
  logger: Logger,
): ReadonlyMap<string, number> | null => {
  try {
    const structural = buildProjectGraphSummary({ projectPath });
    const fanIn = new Map<string, number>();
    for (const file of structural.files) {
      fanIn.set(normalizeRepositoryPath(file.relativePath), file.fanIn);
    }
    return fanIn;
  } catch (error) {
    logger.warn(
      `structural analysis unavailable, criticality falls back to churn: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
};

const withFanIn = (
  evidence: readonly OwnershipFileEvidence[],
  fanInByPath: ReadonlyMap<string, number> | null,
): readonly OwnershipFileEvidence[] => {
  if (fanInByPath === null) {
    return evidence;
  }

  return evidence.map((item) => {
    const fanIn = fanInByPath.get(item.filePath);
    if (fanIn === undefined) {
      return item;
    }
    return { ...item, criticality: { ...item.criticality, fanIn } };
  });
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
  const snapshot = readSnapshot(targetPath, ref);

  const callerWarnings: string[] = [];
  if (options.resolveGithub === true) {
    callerWarnings.push(
      "--resolve-github is not implemented in this iteration; the audit stays offline and declared owners were resolved from local history only.",
    );
    logger.warn(callerWarnings[callerWarnings.length - 1] ?? "");
  }

  let parsedCodeowners: ParsedCodeowners | null;
  try {
    parsedCodeowners = readCodeowners({
      snapshot,
      explicitPath: options.codeownersPath,
    });
  } catch (error) {
    if (error instanceof CodeownersError) {
      throw new OwnersConfigurationError(error.message);
    }
    throw error;
  }

  const aliasSource = await readOwnerAliases(
    snapshot,
    options.aliasesPath ?? DEFAULT_OWNERS_ALIASES_PATH,
  );

  const collectedEvidence = collectOwnershipEvidence(snapshot, windowDays);
  logger.debug(
    `ownership evidence: ${collectedEvidence.files.length} files with history, window since ${collectedEvidence.sinceUnix} of ${snapshot.trackedFiles.length} tracked`,
  );

  const fanInByPath = collectFanInByPath(snapshot.repositoryPath, logger);
  const evidence = withFanIn(collectedEvidence.files, fanInByPath);

  const audit = auditOwnership({
    codeowners: parsedCodeowners,
    trackedFiles: snapshot.trackedFiles,
    evidence,
    aliases: aliasSource.aliases,
    minCommits,
    warnings: [...callerWarnings, ...aliasSource.warnings],
  });

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
    trackedFileCount: snapshot.trackedFiles.length,
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
    trackedFileCount: snapshot.trackedFiles.length,
    ...(options.outputPath === undefined ? {} : { outputPath: options.outputPath }),
  };
};

const hasConfiguredThreshold = (thresholds: OwnersThresholdConfig): boolean =>
  thresholds.maxUnownedCritical !== null ||
  thresholds.maxGhostOwners !== null ||
  thresholds.maxDrift !== null;
