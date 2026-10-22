import type { OwnershipStatus } from "./codeowners.js";
import type { OwnerResolution } from "./identity.js";
import { isActiveOwnerResolution, isVerifiableOwnerResolution } from "./identity.js";

/** Criticality defaults from the design: `fanIn >= 5` or hotspot. */
export const DEFAULT_FAN_IN_CRITICALITY_THRESHOLD = 5;

/**
 * When no structural analysis exists, criticality falls back to hotspots plus churn. The cutoff is
 * the 90th percentile of the churn seen in the repository, computed with the nearest-rank method so
 * the result does not depend on input order.
 */
export const CHURN_CRITICALITY_PERCENTILE = 0.9;

/** Risk score contributes through the upper quartile, as specified in the design. */
export const RISK_SCORE_CRITICALITY_PERCENTILE = 0.75;

/** Below this many scores the quartile is noise, so the rule stays off. */
export const RISK_SCORE_CRITICALITY_MIN_SAMPLES = 4;

export type CriticalityEvidence = {
  fanIn?: number | null;
  isHotspot?: boolean | null;
  riskScore?: number | null;
  /** Churn is only used when structural data is missing. */
  churnTotal?: number | null;
};

export type CriticalityPolicy = {
  fanInThreshold: number;
  /** Churn cutoff, enabled only when no file carries structural data. */
  churnThreshold: number | null;
  /** Risk score cutoff (upper quartile), `null` when the sample is too small. */
  riskScoreThreshold: number | null;
  structuralDataAvailable: boolean;
};

export type CriticalityPolicyOptions = {
  fanInThreshold?: number;
};

const finiteNumbers = (values: readonly (number | null | undefined)[]): number[] =>
  values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);

/** Nearest-rank percentile over an ascending list: no interpolation, so no surprise decimals. */
const nearestRank = (sortedAscending: readonly number[], percentile: number): number | null => {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil(percentile * sortedAscending.length);
  const index = Math.min(Math.max(rank, 1), sortedAscending.length) - 1;
  return sortedAscending[index] ?? null;
};

/**
 * Resolves the criticality cutoffs once for the whole audit.
 *
 * `structuralDataAvailable` is false when no file carries a `fanIn`, which is exactly the
 * "git only, no structural analysis" mode: criticality then degrades to hotspot + churn and the
 * audit must say so in `warnings` instead of pretending the result means the same thing.
 */
export const resolveCriticalityPolicy = (
  evidence: readonly CriticalityEvidence[],
  options: CriticalityPolicyOptions = {},
): CriticalityPolicy => {
  const fanInThreshold = options.fanInThreshold ?? DEFAULT_FAN_IN_CRITICALITY_THRESHOLD;
  const fanInValues = finiteNumbers(evidence.map((item) => item.fanIn));
  const structuralDataAvailable = fanInValues.length > 0;

  const riskScores = finiteNumbers(evidence.map((item) => item.riskScore));
  const riskScoreThreshold =
    riskScores.length >= RISK_SCORE_CRITICALITY_MIN_SAMPLES
      ? nearestRank(riskScores, RISK_SCORE_CRITICALITY_PERCENTILE)
      : null;

  if (structuralDataAvailable) {
    return { fanInThreshold, churnThreshold: null, riskScoreThreshold, structuralDataAvailable };
  }

  const churnValues = finiteNumbers(evidence.map((item) => item.churnTotal));
  return {
    fanInThreshold,
    churnThreshold: nearestRank(churnValues, CHURN_CRITICALITY_PERCENTILE),
    riskScoreThreshold,
    structuralDataAvailable,
  };
};

export const isCriticalFile = (
  evidence: CriticalityEvidence | undefined,
  policy: CriticalityPolicy,
): boolean => {
  if (evidence === undefined) return false;

  const fanIn = typeof evidence.fanIn === "number" ? evidence.fanIn : null;
  if (fanIn !== null && Number.isFinite(fanIn) && fanIn >= policy.fanInThreshold) return true;
  if (evidence.isHotspot === true) return true;

  const riskScore = typeof evidence.riskScore === "number" ? evidence.riskScore : null;
  if (
    policy.riskScoreThreshold !== null &&
    riskScore !== null &&
    Number.isFinite(riskScore) &&
    riskScore >= policy.riskScoreThreshold
  ) {
    return true;
  }

  const churnTotal = typeof evidence.churnTotal === "number" ? evidence.churnTotal : null;
  return (
    policy.churnThreshold !== null &&
    churnTotal !== null &&
    Number.isFinite(churnTotal) &&
    churnTotal >= policy.churnThreshold
  );
};

/**
 * Fixed severity order for every report. It is part of the output contract: `files` is sorted by
 * this rank first, so two runs always emit the same bytes.
 *
 * Unowned critical and ghosted come first because they are the findings that need action;
 * `insufficient-evidence` sits near the end because it is the absence of data, not a finding.
 */
export const OWNERSHIP_STATUS_ORDER: Readonly<Record<OwnershipStatus, number>> = {
  "unowned-critical": 0,
  ghosted: 1,
  drifted: 2,
  unowned: 3,
  unknown: 4,
  "insufficient-evidence": 5,
  aligned: 6,
};

export const ownershipStatusRank = (status: OwnershipStatus): number =>
  OWNERSHIP_STATUS_ORDER[status];

export type OwnershipClassificationInput = {
  /** Owners declared by the winning entry. Zero also covers "no entry matched" and a reset line. */
  declaredCount: number;
  isCritical: boolean;
  /** Lifetime commits touching the file, used for the evidence threshold. */
  commits: number;
  /** Commits touching the file inside the observation window, used for activity. */
  recentCommits: number;
  minCommits: number;
  /** Highest-commit author of the horizon that produced the verdict, bots excluded. */
  topAuthorId: string | null;
  /** False when the horizon that can produce a verdict has commits but no author breakdown. */
  hasAuthorEvidence: boolean;
  /** Declared owners resolved against the same horizon as `topAuthorId`. */
  resolutions: readonly OwnerResolution[];
};

/**
 * Classification with two horizons: lifetime history decides whether there is enough evidence,
 * window activity decides whether an owner is still around.
 *
 * Order: no declaration -> insufficient lifetime evidence -> no author evidence -> dormant ->
 * no declared owner active -> top author -> drift.
 *
 * A `ghosted` verdict needs *all* declared owners to be verifiable, so a team that was never
 * expanded or a stale alias map downgrades the file to `unknown` instead of inventing a ghost.
 * A dormant file (no human commits in the window) can never be ghosted: it is compared against its
 * lifetime top author instead, because silence in the window is not owner inactivity.
 */
export const classifyOwnershipStatus = (input: OwnershipClassificationInput): OwnershipStatus => {
  if (input.declaredCount === 0) {
    return input.isCritical ? "unowned-critical" : "unowned";
  }
  if (input.commits < input.minCommits) {
    return "insufficient-evidence";
  }
  if (!input.hasAuthorEvidence) {
    return "unknown";
  }

  const topAuthorId = input.topAuthorId;

  if (input.recentCommits === 0) {
    return topAuthorId !== null &&
      input.resolutions.some((resolution) => resolution.activeAuthorIds.includes(topAuthorId))
      ? "aligned"
      : "drifted";
  }

  const active = input.resolutions.filter(isActiveOwnerResolution);
  if (active.length === 0) {
    return input.resolutions.every(isVerifiableOwnerResolution) ? "ghosted" : "unknown";
  }

  if (
    topAuthorId !== null &&
    active.some((resolution) => resolution.activeAuthorIds.includes(topAuthorId))
  ) {
    return "aligned";
  }
  return "drifted";
};
