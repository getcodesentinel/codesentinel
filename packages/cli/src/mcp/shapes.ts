import type { RiskFactors, RiskHotspot } from "@codesentinel/core";
import {
  declaredOwnerKey,
  ownershipStatusRank,
  type DeclaredOwner,
  type FileOwnershipAudit,
  type OwnershipAudit,
  type OwnershipStatus,
} from "@codesentinel/ownership";
import type { ReadingPath } from "@codesentinel/reading-path";
import type { TrendPoint } from "../application/format-trend-output.js";
import { McpToolError } from "./errors.js";

export const OWNERSHIP_FINDING_RULES = {
  "ownership/unowned-critical": "error",
  "ownership/ghost-owner": "error",
  "ownership/drift": "warning",
  "ownership/unknown": "warning",
} as const;

export type OwnershipFindingRule = keyof typeof OWNERSHIP_FINDING_RULES;
export type FindingSeverity = (typeof OWNERSHIP_FINDING_RULES)[OwnershipFindingRule];

const RULE_BY_STATUS: Partial<Record<OwnershipStatus, OwnershipFindingRule>> = {
  "unowned-critical": "ownership/unowned-critical",
  ghosted: "ownership/ghost-owner",
  drifted: "ownership/drift",
  unknown: "ownership/unknown",
};

export type Finding = {
  rule: string;
  severity: FindingSeverity;
  status: OwnershipStatus;
  path: string;
  message: string;
  matchLine: number | null;
};

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const severityRank: Readonly<Record<FindingSeverity, number>> = {
  error: 0,
  warning: 1,
};

const formatOwners = (owners: readonly DeclaredOwner[]): string =>
  owners.length === 0 ? "no declared owner" : owners.map(declaredOwnerKey).join(", ");

const findingMessage = (file: FileOwnershipAudit): string => {
  const owners = formatOwners(file.declared);
  switch (file.status) {
    case "unowned-critical":
      return `${file.filePath} is a critical file without a declared owner`;
    case "ghosted":
      return `${file.filePath} is declared to ${owners} but none of its owners committed in the observation window`;
    case "drifted":
      return `${file.filePath} is declared to ${owners} but ${file.observed.topAuthorId ?? "an unknown author"} is the top recent author`;
    case "unknown":
      return `${file.filePath} is declared to ${owners} but its ownership cannot be verified offline`;
    default:
      return `${file.filePath} has no ownership finding`;
  }
};

export const toFindings = (audit: OwnershipAudit): readonly Finding[] => {
  if (!audit.available) {
    return [];
  }

  const findings: Finding[] = [];
  for (const file of audit.files) {
    const rule = RULE_BY_STATUS[file.status];
    if (rule === undefined) continue;

    findings.push({
      rule,
      severity: OWNERSHIP_FINDING_RULES[rule],
      status: file.status,
      path: file.filePath,
      message: findingMessage(file),
      matchLine: file.matchLine,
    });
  }

  return findings.sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity];
    if (bySeverity !== 0) return bySeverity;

    const byStatus = ownershipStatusRank(a.status) - ownershipStatusRank(b.status);
    if (byStatus !== 0) return byStatus;

    return compareText(a.path, b.path);
  });
};

export const normalizePathPrefix = (input: string): string => {
  let normalized = input.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
};

export type FindingFilters = {
  path?: string;
  severity?: FindingSeverity;
  rule?: string;
  status?: OwnershipStatus;
};

export const filterFindings = (
  findings: readonly Finding[],
  filters: FindingFilters,
): readonly Finding[] =>
  findings.filter((finding) => {
    if (filters.severity !== undefined && finding.severity !== filters.severity) return false;
    if (filters.rule !== undefined && finding.rule !== filters.rule) return false;
    if (filters.status !== undefined && finding.status !== filters.status) return false;
    if (filters.path !== undefined) {
      const path = filters.path;
      if (finding.path !== path && !finding.path.startsWith(`${path}/`)) return false;
    }
    return true;
  });

export const encodeCursor = (offset: number): string =>
  Buffer.from(`v1:${offset}`, "utf8").toString("base64url");

export const decodeCursor = (cursor: string | undefined): number => {
  if (cursor === undefined) return 0;

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new McpToolError("invalid_argument", `invalid cursor: "${cursor}"`);
  }

  const match = /^v1:(\d+)$/.exec(decoded);
  const offset = match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
  if (offset === null || !Number.isSafeInteger(offset) || offset < 0) {
    throw new McpToolError("invalid_argument", `invalid cursor: "${cursor}"`);
  }

  return offset;
};

export type Paginated<T> = {
  page: readonly T[];
  nextCursor: string | null;
};

export const paginate = <T>(items: readonly T[], offset: number, limit: number): Paginated<T> => {
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return {
    page,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
  };
};

export type OwnerValue = {
  kind: DeclaredOwner["kind"];
  value: string;
};

const toOwnerValues = (owners: readonly DeclaredOwner[]): readonly OwnerValue[] =>
  owners.map((owner) => ({ kind: owner.kind, value: declaredOwnerKey(owner) }));

export type FileOwnerOutput = {
  path: string;
  ref: string;
  owners: readonly OwnerValue[];
  teams: readonly string[];
  status: OwnershipStatus;
  matchLine: number | null;
  topAuthor: { id: string; share: number | null } | null;
  observed: {
    commits: number;
    recentCommits: number;
    authors: number;
    dormant: boolean;
    busFactor: number | null;
    lastCommitUnix: number | null;
  };
  criticality: {
    isCritical: boolean;
    isHotspot: boolean;
    fanIn: number | null;
    riskScore: number | null;
  };
  warnings: readonly string[];
};

export const toFileOwner = (
  file: FileOwnershipAudit,
  ref: string,
  warnings: readonly string[],
): FileOwnerOutput => {
  const teams = [
    ...new Set(
      file.declared
        .filter((owner): owner is Extract<DeclaredOwner, { kind: "team" }> => owner.kind === "team")
        .map((owner) => `${owner.org}/${owner.slug}`),
    ),
  ].sort(compareText);

  return {
    path: file.filePath,
    ref,
    owners: toOwnerValues(file.declared),
    teams,
    status: file.status,
    matchLine: file.matchLine,
    topAuthor:
      file.observed.topAuthorId === null
        ? null
        : { id: file.observed.topAuthorId, share: file.observed.topAuthorShare },
    observed: {
      commits: file.observed.commits,
      recentCommits: file.observed.recentCommits,
      authors: file.observed.authors,
      dormant: file.observed.dormant,
      busFactor: file.observed.busFactor,
      lastCommitUnix: file.observed.lastCommitUnix,
    },
    criticality: {
      isCritical: file.criticality.isCritical,
      isHotspot: file.criticality.isHotspot,
      fanIn: file.criticality.fanIn,
      riskScore: file.criticality.riskScore,
    },
    warnings: [...warnings],
  };
};

export type HotspotOutput = {
  rank: number;
  path: string;
  score: number;
  factors: RiskFactors;
};

export const toHotspots = (hotspots: readonly RiskHotspot[], offset: number): HotspotOutput[] =>
  hotspots.map((hotspot, index) => ({
    rank: offset + index + 1,
    path: hotspot.file,
    score: hotspot.score,
    factors: hotspot.factors,
  }));

export type ReadingPathStepOutput = {
  order: number;
  filePath: string;
  role: string;
  reason: string;
  owner: readonly OwnerValue[] | null;
  observedTopAuthor: string | null;
  commits: number;
  churn: number;
  fanInInternal: number;
  testFiles: readonly string[];
};

export type ReadingPathOutput = {
  target: string;
  targetKind: string;
  steps: readonly ReadingPathStepOutput[];
  people: ReadingPath["people"];
  commands: readonly string[];
  warnings: readonly string[];
  truncated: boolean;
};

export const toReadingPath = (path: ReadingPath): ReadingPathOutput => ({
  target: path.target,
  targetKind: path.targetKind,
  steps: path.steps.map((step) => ({
    order: step.order,
    filePath: step.filePath,
    role: step.role,
    reason: step.reason,
    owner: step.owner === null ? null : toOwnerValues(step.owner),
    observedTopAuthor: step.observedTopAuthor,
    commits: step.commits,
    churn: step.churn,
    fanInInternal: step.fanInInternal,
    testFiles: [...step.testFiles],
  })),
  people: path.people,
  commands: [...path.commands],
  warnings: [...path.warnings],
  truncated: path.truncated,
});

export type TrendMetric =
  "riskScore" | "healthScore" | "unownedCriticalCount" | "ghostOwnerCount" | "driftPercent";

export const trendValue = (point: TrendPoint, metric: TrendMetric): number | null => {
  switch (metric) {
    case "riskScore":
      return point.riskScore;
    case "healthScore":
      return point.healthScore;
    case "unownedCriticalCount":
      return point.ownership === null ? null : point.ownership.unownedCritical;
    case "ghostOwnerCount":
      return point.ownership === null ? null : point.ownership.ghostOwners;
    case "driftPercent":
      return point.ownership === null ? null : point.ownership.driftPercent;
  }
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const sinceBoundary = (value: string): number =>
  Date.parse(DATE_ONLY_PATTERN.test(value) ? `${value}T00:00:00.000Z` : value);

const untilBoundary = (value: string): number =>
  Date.parse(DATE_ONLY_PATTERN.test(value) ? `${value}T23:59:59.999Z` : value);

export const filterTrendByIsoDate = (
  series: readonly TrendPoint[],
  filters: { since?: string; until?: string },
): readonly TrendPoint[] => {
  const since = filters.since === undefined ? null : sinceBoundary(filters.since);
  const until = filters.until === undefined ? null : untilBoundary(filters.until);

  return series.filter((point) => {
    const generatedAt = Date.parse(point.generatedAt);
    if (since !== null && generatedAt < since) return false;
    if (until !== null && generatedAt > until) return false;
    return true;
  });
};

const normalizePosixPath = (value: string): string => {
  let normalized = value.replace(/\\/g, "/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
};

export const changedFilesFromGitOutput = (stdout: string): readonly string[] => {
  const paths = stdout
    .split(/\r?\n/)
    .map(normalizePosixPath)
    .filter((path) => path.length > 0)
    .sort(compareText);
  return [...new Set(paths)];
};

export const shortCommit = (commit: string | null): string | null =>
  commit === null ? null : commit.slice(0, 7);
