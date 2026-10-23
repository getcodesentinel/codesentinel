import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { buildProjectGraphSummary } from "@codesentinel/code-graph";
import {
  CODEOWNERS_CANDIDATE_PATHS,
  CodeownersError,
  DEFAULT_MIN_COMMITS,
  auditOwnership,
  discoverCodeowners,
  parseCodeowners,
  parseOwnersConfig,
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
import type { Logger } from "./logger.js";

/**
 * Shared ownership-audit pipeline for the `owners` and `report` commands.
 *
 * The command is offline by contract. The only inputs are the repository at `--ref`, the optional
 * versioned alias map and the structural analysis of the working tree.
 */

export const DEFAULT_OWNERS_WINDOW_DAYS = 90;
export const DEFAULT_OWNERS_REF = "HEAD";
export const DEFAULT_OWNERS_ALIASES_PATH = ".codesentinel/owners.json";

export class OwnersConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnersConfigurationError";
  }
}

export type BuildOwnershipAuditOptions = {
  codeownersPath?: string;
  ref?: string;
  windowDays?: number;
  minCommits?: number;
  aliasesPath?: string;
  ignoreAuthors?: readonly string[];
  warnings?: readonly string[];
};

export type OwnershipAuditResult = {
  audit: OwnershipAudit;
  trackedFileCount: number;
  repositoryPath: string;
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

type OwnersConfigSource = {
  aliases: OwnerAliases;
  ignoreAuthors: readonly string[];
  warnings: readonly string[];
};

type ResolvedAliasesPath = {
  /** Repository-relative form when the file belongs to the audited repository, otherwise null. */
  repositoryRelativePath: string | null;
  /** Path named in warnings. */
  displayPath: string;
  /** Absolute path to read when the file is not tracked at the ref. */
  diskPath: string;
};

/**
 * Absolute paths inside the audited repository are mapped back to the repository-relative form so
 * the tracked-at-ref read still applies. Absolute paths outside the repository are read directly.
 */
const resolveAliasesPath = (repositoryPath: string, aliasesPath: string): ResolvedAliasesPath => {
  if (!isAbsolute(aliasesPath)) {
    const normalized = normalizeRepositoryPath(aliasesPath);
    return {
      repositoryRelativePath: normalized,
      displayPath: normalized,
      diskPath: resolve(repositoryPath, normalized),
    };
  }

  const absolutePath = resolve(aliasesPath);
  const relativePath = relative(repositoryPath, absolutePath);
  const insideRepository = !relativePath.startsWith("..") && !isAbsolute(relativePath);

  if (insideRepository) {
    const normalized = normalizeRepositoryPath(relativePath);
    return {
      repositoryRelativePath: normalized,
      displayPath: normalized,
      diskPath: absolutePath,
    };
  }

  return {
    repositoryRelativePath: null,
    displayPath: absolutePath,
    diskPath: absolutePath,
  };
};

const unreadableAliasesWarning = (displayPath: string, detail?: string): string =>
  detail === undefined
    ? `Identity aliases file "${displayPath}" could not be read: the audit ran without identity aliases.`
    : `Identity aliases file "${displayPath}" could not be read (${detail}): the audit ran without identity aliases.`;

/**
 * The owners config is versioned, so it is read from the audited ref when it is tracked there.
 * Otherwise the working-tree copy is used and the degradation is reported, because an alias map
 * that silently changes identity results is exactly the kind of hidden input this command avoids.
 *
 * An explicitly requested file that cannot be read is never a silent no-op: the audit proceeds
 * without aliases and says so, so a typo cannot masquerade as an unlinked identity.
 */
const readOwnersConfig = async (
  snapshot: RepositorySnapshot,
  aliasesPath: string,
  explicit: boolean,
): Promise<OwnersConfigSource> => {
  const resolved = resolveAliasesPath(snapshot.repositoryPath, aliasesPath);
  const normalized = resolved.repositoryRelativePath;

  if (normalized !== null && snapshot.trackedFiles.includes(normalized)) {
    const text = readTextAtRef(snapshot.repositoryPath, snapshot.ref, normalized);
    const parsed = parseOwnersConfig(text);
    return {
      aliases: parsed.aliases,
      ignoreAuthors: parsed.ignoreAuthors,
      warnings: parsed.warnings,
    };
  }

  if (!existsSync(resolved.diskPath)) {
    if (!explicit) {
      return { aliases: {}, ignoreAuthors: [], warnings: [] };
    }
    return {
      aliases: {},
      ignoreAuthors: [],
      warnings: [unreadableAliasesWarning(resolved.displayPath)],
    };
  }

  let text: string;
  try {
    text = await readFile(resolved.diskPath, "utf8");
  } catch (error) {
    if (!explicit) {
      throw error;
    }
    return {
      aliases: {},
      ignoreAuthors: [],
      warnings: [
        unreadableAliasesWarning(
          resolved.displayPath,
          error instanceof Error ? error.message : "unknown error",
        ),
      ],
    };
  }

  const parsed = parseOwnersConfig(text);
  const sourceWarning =
    normalized === null
      ? `Identity aliases were read from "${resolved.diskPath}", which is outside the audited repository and is not versioned with it.`
      : `Identity aliases were read from the working tree because "${normalized}" is not tracked at "${snapshot.ref}".`;

  return {
    aliases: parsed.aliases,
    ignoreAuthors: parsed.ignoreAuthors,
    warnings: [...parsed.warnings, sourceWarning],
  };
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

export const buildOwnershipAudit = async (
  targetPath: string,
  options: BuildOwnershipAuditOptions,
  logger: Logger,
): Promise<OwnershipAuditResult> => {
  const ref = options.ref ?? DEFAULT_OWNERS_REF;
  const windowDays = options.windowDays ?? DEFAULT_OWNERS_WINDOW_DAYS;
  const minCommits = options.minCommits ?? DEFAULT_MIN_COMMITS;

  const snapshot = readSnapshot(targetPath, ref);

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

  const configSource = await readOwnersConfig(
    snapshot,
    options.aliasesPath ?? DEFAULT_OWNERS_ALIASES_PATH,
    options.aliasesPath !== undefined,
  );

  const collected = collectOwnershipEvidence(snapshot, windowDays);
  logger.debug(
    `ownership evidence: ${collected.files.length} files with history, window since ${collected.sinceUnix} of ${snapshot.trackedFiles.length} tracked`,
  );

  const fanInByPath = collectFanInByPath(snapshot.repositoryPath, logger);
  const evidence = withFanIn(collected.files, fanInByPath);

  const audit = auditOwnership({
    codeowners: parsedCodeowners,
    trackedFiles: snapshot.trackedFiles,
    evidence,
    aliases: configSource.aliases,
    ignoreAuthors: [...configSource.ignoreAuthors, ...(options.ignoreAuthors ?? [])],
    minCommits,
    warnings: [...(options.warnings ?? []), ...configSource.warnings],
  });

  return {
    audit,
    trackedFileCount: snapshot.trackedFiles.length,
    repositoryPath: snapshot.repositoryPath,
  };
};
