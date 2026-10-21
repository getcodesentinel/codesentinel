import { declaredOwnerKey } from "./codeowners.js";
import type { DeclaredOwner, FileOwnershipAudit, OwnershipAuditMetrics } from "./codeowners.js";
import { ownershipStatusRank } from "./classify.js";

/** At most three sample paths per ghost owner, as specified in the design. */
export const GHOST_OWNER_SAMPLE_PATHS = 3;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Percentages are rounded to two decimals so the JSON stays stable and readable. */
export const percentOf = (part: number, total: number): number =>
  total === 0 ? 0 : roundTo((part / total) * 100, 2);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareNullableDescending = (a: number | null, b: number | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
};

/**
 * Report order, part of the determinism contract: severity rank, then criticality descending,
 * then `fanIn`, then `riskScore`, then the path as the final tie-breaker.
 */
export const compareFileOwnershipAudits = (
  a: FileOwnershipAudit,
  b: FileOwnershipAudit,
): number => {
  const byStatus = ownershipStatusRank(a.status) - ownershipStatusRank(b.status);
  if (byStatus !== 0) return byStatus;

  const byCritical = Number(b.criticality.isCritical) - Number(a.criticality.isCritical);
  if (byCritical !== 0) return byCritical;

  const byFanIn = compareNullableDescending(a.criticality.fanIn, b.criticality.fanIn);
  if (byFanIn !== 0) return byFanIn;

  const byRiskScore = compareNullableDescending(a.criticality.riskScore, b.criticality.riskScore);
  if (byRiskScore !== 0) return byRiskScore;

  return compareText(a.filePath, b.filePath);
};

export const sortFileOwnershipAudits = (
  files: readonly FileOwnershipAudit[],
): readonly FileOwnershipAudit[] => [...files].sort(compareFileOwnershipAudits);

/** Module = first path segment; files at the repository root belong to the "." module. */
export const moduleOfPath = (filePath: string): string => {
  const separator = filePath.indexOf("/");
  return separator === -1 ? "." : filePath.slice(0, separator);
};

const countSingleOwnerModules = (files: readonly FileOwnershipAudit[]): number => {
  const ownersByModule = new Map<string, Set<string>>();
  for (const file of files) {
    const module = moduleOfPath(file.filePath);
    const owners = ownersByModule.get(module) ?? new Set<string>();
    for (const owner of file.declared) owners.add(declaredOwnerKey(owner));
    ownersByModule.set(module, owners);
  }

  let singleOwnerModules = 0;
  for (const owners of ownersByModule.values()) {
    if (owners.size === 1) singleOwnerModules += 1;
  }
  return singleOwnerModules;
};

export type OwnershipMetricsInput = {
  files: readonly FileOwnershipAudit[];
  /** Universe of tracked files, including the ones no CODEOWNERS pattern matches. */
  trackedFileCount: number;
  /** Distinct owners with verified absence of activity. */
  ghostOwnerCount: number;
};

/**
 * Aggregate metrics. `declaredCoveragePercent` is the headline that GitHub inflates with a single
 * `* @someone`; `declaredCoverageCriticalPercent` is the one that matters.
 *
 * `driftPercent` is measured over files with a declaration, so unowned files cannot hide drift.
 */
export const computeOwnershipMetrics = (input: OwnershipMetricsInput): OwnershipAuditMetrics => {
  const declaredFiles = input.files.filter((file) => file.declared.length > 0);
  const criticalFiles = input.files.filter((file) => file.criticality.isCritical);
  const coveredCriticalFiles = criticalFiles.filter((file) => file.declared.length > 0);
  const driftedFiles = declaredFiles.filter((file) => file.status === "drifted");

  return {
    declaredCoveragePercent: percentOf(declaredFiles.length, input.trackedFileCount),
    declaredCoverageCriticalPercent: percentOf(coveredCriticalFiles.length, criticalFiles.length),
    driftPercent: percentOf(driftedFiles.length, declaredFiles.length),
    ghostOwnerCount: input.ghostOwnerCount,
    unownedCriticalCount: input.files.filter((file) => file.status === "unowned-critical").length,
    singleOwnerModuleCount: countSingleOwnerModules(declaredFiles),
  };
};

export type GhostOwnerCandidate = {
  owner: DeclaredOwner;
  filePath: string;
};

export type GhostOwnerSummary = {
  owner: DeclaredOwner;
  samplePaths: readonly string[];
};

/**
 * Deduplicates ghost owners across files. Owners are ordered by their identity key and paths
 * ascending, so the list does not depend on traversal order.
 */
export const summarizeGhostOwners = (
  candidates: readonly GhostOwnerCandidate[],
): readonly GhostOwnerSummary[] => {
  const owners = new Map<string, { owner: DeclaredOwner; paths: Set<string> }>();
  for (const candidate of candidates) {
    const key = declaredOwnerKey(candidate.owner);
    const entry = owners.get(key) ?? { owner: candidate.owner, paths: new Set<string>() };
    entry.paths.add(candidate.filePath);
    owners.set(key, entry);
  }

  return [...owners.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, entry]) => ({
      owner: entry.owner,
      samplePaths: [...entry.paths].sort(compareText).slice(0, GHOST_OWNER_SAMPLE_PATHS),
    }));
};
