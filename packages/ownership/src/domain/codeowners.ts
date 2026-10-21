export const CODEOWNERS_MAX_BYTES = 3 * 1024 * 1024;

export type CodeownersErrorCode = "codeowners_too_large" | "codeowners_invalid_pattern";

export class CodeownersError extends Error {
  readonly code: CodeownersErrorCode;

  constructor(code: CodeownersErrorCode, message: string) {
    super(message);
    this.name = "CodeownersError";
    this.code = code;
  }
}

export type DeclaredOwner =
  | { kind: "user"; handle: string }
  | { kind: "team"; org: string; slug: string }
  | { kind: "email"; address: string };

/**
 * Stable identity key for a declared owner, used to aggregate owners across files.
 * GitHub treats handles, team slugs and email addresses case-insensitively.
 */
export const declaredOwnerKey = (owner: DeclaredOwner): string => {
  if (owner.kind === "user") return `@${owner.handle.trim().toLowerCase()}`;
  if (owner.kind === "team")
    return `@${owner.org.trim().toLowerCase()}/${owner.slug.trim().toLowerCase()}`;
  return owner.address.trim().toLowerCase();
};

export type CodeownersEntry = {
  pattern: string;
  owners: readonly DeclaredOwner[];
  /** 1-based line of the source file, so the report can link to it. */
  line: number;
  /**
   * Invalid lines are preserved for diagnostics but never take part in matching.
   * A line with a pattern and no owners is valid: it clears the ownership of the subtree.
   */
  ignored: boolean;
};

export type CodeownersParseError = {
  line: number;
  reason: string;
};

export type ParsedCodeowners = {
  source: string;
  entries: readonly CodeownersEntry[];
  errors: readonly CodeownersParseError[];
  ignoredSources: readonly string[];
};

export type OwnershipStatus =
  | "aligned"
  | "drifted"
  | "ghosted"
  | "unowned"
  | "unowned-critical"
  | "insufficient-evidence"
  /** Degraded verdict: teams are opaque offline and aliases may be unresolved, so absence is not proof. */
  | "unknown";

export type FileOwnershipAudit = {
  filePath: string;
  declared: readonly DeclaredOwner[];
  matchLine: number | null;
  status: OwnershipStatus;
  observed: {
    /** Lifetime commits touching the file. */
    commits: number;
    /** Commits touching the file inside the activity window. */
    recentCommits: number;
    /** `recentCommits === 0 && commits > 0`: present in history, untouched in the window. */
    dormant: boolean;
    /** Distinct authors over the file's lifetime. */
    authors: number;
    topAuthorId: string | null;
    topAuthorShare: number | null;
    busFactor: number | null;
    lastCommitUnix: number | null;
  };
  criticality: {
    fanIn: number | null;
    isHotspot: boolean;
    riskScore: number | null;
    /**
     * Resolved criticality verdict. Stored so reporters do not have to re-apply the threshold
     * policy, and so `unowned-critical` is auditable from the output alone.
     */
    isCritical: boolean;
  };
};

export type OwnershipAuditMetrics = {
  declaredCoveragePercent: number;
  declaredCoverageCriticalPercent: number;
  driftPercent: number;
  ghostOwnerCount: number;
  unownedCriticalCount: number;
  singleOwnerModuleCount: number;
};

export type OwnershipAuditAvailable = {
  available: true;
  codeowners: ParsedCodeowners;
  metrics: OwnershipAuditMetrics;
  ghostOwners: readonly { owner: DeclaredOwner; samplePaths: readonly string[] }[];
  files: readonly FileOwnershipAudit[];
  warnings: readonly string[];
};

export type OwnershipAuditUnavailable = {
  available: false;
  reason: "codeowners_not_found";
  warnings: readonly string[];
};

export type OwnershipAudit = OwnershipAuditAvailable | OwnershipAuditUnavailable;
