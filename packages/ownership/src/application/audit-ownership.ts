import type {
  DeclaredOwner,
  FileOwnershipAudit,
  OwnershipAudit,
  ParsedCodeowners,
} from "../domain/codeowners.js";
import { declaredOwnerKey } from "../domain/codeowners.js";
import {
  classifyOwnershipStatus,
  isCriticalFile,
  resolveCriticalityPolicy,
} from "../domain/classify.js";
import type { CriticalityEvidence, CriticalityPolicyOptions } from "../domain/classify.js";
import { isActiveOwnerResolution, isVerifiableOwnerResolution } from "../domain/identity.js";
import type { OwnerAliases, OwnershipAuthor } from "../domain/identity.js";
import {
  computeOwnershipMetrics,
  sortFileOwnershipAudits,
  summarizeGhostOwners,
} from "../domain/metrics.js";
import type { GhostOwnerCandidate } from "../domain/metrics.js";
import { createCodeownersMatcher } from "../domain/matcher.js";
import { createIdentityResolver, isBotAuthor } from "./resolve-identities.js";

/** Design default: at least two lifetime commits touching the file before a verdict is worth anything. */
export const DEFAULT_MIN_COMMITS = 2;

const NO_CODEOWNERS_WARNING = "No CODEOWNERS file was found; the ownership audit is unavailable.";

export type OwnershipFileEvidence = {
  filePath: string;
  /** Lifetime commits touching the file. */
  commits: number;
  /** Commits touching the file inside the activity window. */
  recentCommits: number;
  /** Lifetime commits per author. Bots never count as owner activity. */
  authors?: readonly OwnershipAuthor[];
  /** Commits per author inside the activity window. */
  recentAuthors?: readonly OwnershipAuthor[];
  lastCommitUnix?: number | null;
  busFactor?: number | null;
  /** Structural signals, already computed by the caller. Never imported from `code-graph`. */
  criticality?: CriticalityEvidence;
};

export type AuditOwnershipInput = {
  /** `null` when no CODEOWNERS file was found; the audit degrades to `available: false`. */
  codeowners: ParsedCodeowners | null;
  /** Universe of files, from `git ls-files` on the audited ref. */
  trackedFiles: readonly string[];
  /** Per-file history projected onto the lifetime and activity-window horizons. */
  evidence?: readonly OwnershipFileEvidence[];
  /** Identity aliases from `.codesentinel/owners.json`, already parsed by the caller. */
  aliases?: OwnerAliases;
  /** Minimum commits per file before a verdict is emitted. Defaults to `DEFAULT_MIN_COMMITS`. */
  minCommits?: number;
  /** Fan-in threshold for criticality. Defaults to `DEFAULT_FAN_IN_CRITICALITY_THRESHOLD`. */
  fanInCriticalityThreshold?: number;
  /** Warnings produced by the caller (for example, alias file problems), appended as-is. */
  warnings?: readonly string[];
};

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Commits per non-bot author id, so duplicated evidence rows cannot skew the top author. */
const aggregateAuthors = (authors: readonly OwnershipAuthor[]): Map<string, number> => {
  const commitsByAuthor = new Map<string, number>();
  for (const author of authors) {
    if (isBotAuthor(author)) continue;
    commitsByAuthor.set(
      author.authorId,
      (commitsByAuthor.get(author.authorId) ?? 0) + author.commits,
    );
  }
  return commitsByAuthor;
};

const pickTopAuthor = (
  commitsByAuthor: ReadonlyMap<string, number>,
): { topAuthorId: string; topAuthorShare: number } | null => {
  let best: { id: string; commits: number } | null = null;
  let total = 0;

  for (const [authorId, commits] of commitsByAuthor) {
    total += commits;
    if (
      best === null ||
      commits > best.commits ||
      (commits === best.commits && authorId < best.id)
    ) {
      best = { id: authorId, commits };
    }
  }

  if (best === null || total <= 0) return null;
  return { topAuthorId: best.id, topAuthorShare: roundTo(best.commits / total, 4) };
};

const countDistinct = (values: readonly string[]): number => new Set(values).size;

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/**
 * Crosses declared ownership (CODEOWNERS) with observed ownership across two horizons.
 *
 * Lifetime history decides whether there is enough evidence and identifies the owner of a dormant
 * file. Window activity decides whether a declared owner is still active; a file untouched in the
 * window is never a ghost, because silence there is not proof of abandonment. Pure and offline: it
 * receives the tracked file list, per-file history and structural signals already computed
 * elsewhere, and returns a fully ordered, deterministic audit. No filesystem, no network, no clock.
 * Two runs over the same input produce byte-identical JSON.
 *
 * `ghosted` is only emitted for a file with window activity when every declared owner is
 * verifiable (no unexpanded team, no stale alias map) and none of them shows activity in the
 * window. Otherwise the file is `unknown` and the reason appears in `warnings`.
 */
export const auditOwnership = (input: AuditOwnershipInput): OwnershipAudit => {
  const callerWarnings = input.warnings ?? [];

  if (input.codeowners === null) {
    return {
      available: false,
      reason: "codeowners_not_found",
      warnings: [...callerWarnings, NO_CODEOWNERS_WARNING],
    };
  }

  const codeowners: ParsedCodeowners = input.codeowners;
  const minCommits = input.minCommits ?? DEFAULT_MIN_COMMITS;
  const criticalityOptions: CriticalityPolicyOptions =
    input.fanInCriticalityThreshold === undefined
      ? {}
      : { fanInThreshold: input.fanInCriticalityThreshold };

  const trackedFiles = [...new Set(input.trackedFiles)].sort(compareText);
  const trackedFileSet = new Set(trackedFiles);

  const evidenceByPath = new Map<string, OwnershipFileEvidence>();
  const warnings: string[] = [...callerWarnings];
  let duplicatedEvidence = 0;
  let evidenceOutsideUniverse = 0;

  for (const item of input.evidence ?? []) {
    if (!trackedFileSet.has(item.filePath)) {
      evidenceOutsideUniverse += 1;
      continue;
    }
    if (evidenceByPath.has(item.filePath)) {
      duplicatedEvidence += 1;
      continue;
    }
    evidenceByPath.set(item.filePath, item);
  }

  const evidenceItems = trackedFiles
    .map((filePath) => evidenceByPath.get(filePath))
    .filter((item): item is OwnershipFileEvidence => item !== undefined);

  const policy = resolveCriticalityPolicy(
    evidenceItems.map((item) => item.criticality ?? {}),
    criticalityOptions,
  );
  const matcher = createCodeownersMatcher(codeowners.entries);
  const resolveOwner = createIdentityResolver(input.aliases ?? {});

  const files: FileOwnershipAudit[] = [];
  const ghostCandidates: GhostOwnerCandidate[] = [];
  const teamKeys = new Set<string>();
  const unresolvedAliasKeys = new Set<string>();
  let filesWithoutAuthorEvidence = 0;

  for (const filePath of trackedFiles) {
    const item = evidenceByPath.get(filePath);
    const entry = matcher(filePath);
    const declared: readonly DeclaredOwner[] = entry?.owners ?? [];
    const authors = item?.authors ?? [];
    const recentAuthors = item?.recentAuthors ?? [];
    const commits = item?.commits ?? 0;
    const recentCommits = item?.recentCommits ?? 0;

    const lifetimeResolutions = declared.map((owner) => resolveOwner(owner, authors));
    const recentResolutions = declared.map((owner) => resolveOwner(owner, recentAuthors));
    const usesLifetimeHorizon = recentCommits === 0;
    const resolutions = usesLifetimeHorizon ? lifetimeResolutions : recentResolutions;
    const horizonAuthors = usesLifetimeHorizon ? authors : recentAuthors;
    const dormant = usesLifetimeHorizon && commits > 0;

    for (const resolution of resolutions) {
      if (resolution.kind === "team_unverified") teamKeys.add(declaredOwnerKey(resolution.owner));
      if (resolution.kind === "alias_unresolved") {
        unresolvedAliasKeys.add(declaredOwnerKey(resolution.owner));
      }
    }

    const commitsByAuthor = aggregateAuthors(horizonAuthors);
    const top = pickTopAuthor(commitsByAuthor);
    const hasAuthorEvidence = commitsByAuthor.size > 0;
    const isCritical = isCriticalFile(item?.criticality, policy);

    const status = classifyOwnershipStatus({
      declaredCount: declared.length,
      isCritical,
      commits,
      recentCommits,
      minCommits,
      topAuthorId: top?.topAuthorId ?? null,
      hasAuthorEvidence,
      resolutions,
    });

    if (declared.length > 0 && commits >= minCommits && !hasAuthorEvidence) {
      filesWithoutAuthorEvidence += 1;
    }

    if (declared.length > 0 && commits >= minCommits && recentCommits > 0) {
      for (const resolution of recentResolutions) {
        if (!isActiveOwnerResolution(resolution) && isVerifiableOwnerResolution(resolution)) {
          ghostCandidates.push({ owner: resolution.owner, filePath });
        }
      }
    }

    files.push({
      filePath,
      declared,
      matchLine: entry === null ? null : entry.line,
      status,
      observed: {
        commits,
        recentCommits,
        dormant,
        authors: countDistinct(authors.map((author) => author.authorId)),
        topAuthorId: top?.topAuthorId ?? null,
        topAuthorShare: top?.topAuthorShare ?? null,
        busFactor: item?.busFactor ?? null,
        lastCommitUnix: item?.lastCommitUnix ?? null,
      },
      criticality: {
        fanIn: item?.criticality?.fanIn ?? null,
        isHotspot: item?.criticality?.isHotspot === true,
        riskScore: item?.criticality?.riskScore ?? null,
        isCritical,
      },
    });
  }

  const sortedFiles = sortFileOwnershipAudits(files);
  const ghostOwners = summarizeGhostOwners(ghostCandidates);

  if (!policy.structuralDataAvailable) {
    warnings.push(
      "No structural analysis available: criticality falls back to hotspots and churn (p90).",
    );
  }
  if (teamKeys.size > 0) {
    warnings.push(
      `${plural(teamKeys.size, "team owner", "team owners")} cannot be verified offline; ` +
        "teams are never reported as ghost owners.",
    );
  }
  if (unresolvedAliasKeys.size > 0) {
    warnings.push(
      `${plural(unresolvedAliasKeys.size, "declared owner has", "declared owners have")} identity ` +
        "aliases that were not observed in the relevant history; their files are never reported as ghost owners.",
    );
  }
  if (filesWithoutAuthorEvidence > 0) {
    warnings.push(
      `${plural(filesWithoutAuthorEvidence, "declared file has", "declared files have")} commits ` +
        "but no human author evidence; they are reported as unknown.",
    );
  }
  if (duplicatedEvidence > 0) {
    warnings.push(
      `Ignored ${plural(duplicatedEvidence, "duplicate file evidence entry", "duplicate file evidence entries")}: ` +
        "the first entry per path wins.",
    );
  }
  if (evidenceOutsideUniverse > 0) {
    warnings.push(
      `Ignored ${plural(evidenceOutsideUniverse, "file evidence entry", "file evidence entries")} ` +
        "outside the tracked universe.",
    );
  }

  const metrics = computeOwnershipMetrics({
    files: sortedFiles,
    trackedFileCount: trackedFiles.length,
    ghostOwnerCount: ghostOwners.length,
  });

  return {
    available: true,
    codeowners,
    metrics,
    ghostOwners,
    files: sortedFiles,
    warnings,
  };
};
