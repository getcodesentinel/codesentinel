import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

/**
 * The owners config is versioned, so it is read from the audited ref when it is tracked there.
 * Otherwise the working-tree copy is used and the degradation is reported, because an alias map
 * that silently changes identity results is exactly the kind of hidden input this command avoids.
 */
const readOwnersConfig = async (
  snapshot: RepositorySnapshot,
  aliasesPath: string,
): Promise<OwnersConfigSource> => {
  const normalized = normalizeRepositoryPath(aliasesPath);
  const tracked = snapshot.trackedFiles.includes(normalized);

  if (tracked) {
    const text = readTextAtRef(snapshot.repositoryPath, snapshot.ref, normalized);
    const parsed = parseOwnersConfig(text);
    return {
      aliases: parsed.aliases,
      ignoreAuthors: parsed.ignoreAuthors,
      warnings: parsed.warnings,
    };
  }

  const workingTreePath = resolve(snapshot.repositoryPath, normalized);
  if (existsSync(workingTreePath)) {
    const text = await readFile(workingTreePath, "utf8");
    const parsed = parseOwnersConfig(text);
    return {
      aliases: parsed.aliases,
      ignoreAuthors: parsed.ignoreAuthors,
      warnings: [
        ...parsed.warnings,
        `Identity aliases were read from the working tree because "${normalized}" is not tracked at "${snapshot.ref}".`,
      ],
    };
  }

  return { aliases: {}, ignoreAuthors: [], warnings: [] };
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
