export {
  CODEOWNERS_MAX_BYTES,
  CodeownersError,
  declaredOwnerKey,
  type CodeownersEntry,
  type CodeownersErrorCode,
  type CodeownersParseError,
  type DeclaredOwner,
  type FileOwnershipAudit,
  type OwnershipAudit,
  type OwnershipAuditAvailable,
  type OwnershipAuditMetrics,
  type OwnershipAuditUnavailable,
  type OwnershipStatus,
  type ParsedCodeowners,
} from "./domain/codeowners.js";

export {
  compileCodeownersPattern,
  createCodeownersMatcher,
  findOwningEntry,
  matchCodeownersPattern,
  type CodeownersMatcher,
  type CompiledCodeownersPattern,
} from "./domain/matcher.js";

export {
  CHURN_CRITICALITY_PERCENTILE,
  DEFAULT_FAN_IN_CRITICALITY_THRESHOLD,
  OWNERSHIP_STATUS_ORDER,
  RISK_SCORE_CRITICALITY_MIN_SAMPLES,
  RISK_SCORE_CRITICALITY_PERCENTILE,
  classifyOwnershipStatus,
  isCriticalFile,
  ownershipStatusRank,
  resolveCriticalityPolicy,
  type CriticalityEvidence,
  type CriticalityPolicy,
  type CriticalityPolicyOptions,
  type OwnershipClassificationInput,
} from "./domain/classify.js";

export {
  GHOST_OWNER_SAMPLE_PATHS,
  compareFileOwnershipAudits,
  computeOwnershipMetrics,
  moduleOfPath,
  percentOf,
  sortFileOwnershipAudits,
  summarizeGhostOwners,
  type GhostOwnerCandidate,
  type GhostOwnerSummary,
  type OwnershipMetricsInput,
} from "./domain/metrics.js";

export {
  isActiveOwnerResolution,
  isVerifiableOwnerResolution,
  type OwnerAliases,
  type OwnerResolution,
  type OwnerResolutionKind,
  type OwnershipAuthor,
} from "./domain/identity.js";

export {
  CODEOWNERS_CANDIDATE_PATHS,
  DEFAULT_CODEOWNERS_SOURCE,
  discoverCodeowners,
  parseCodeowners,
  type CodeownersSourceSelection,
  type ParseCodeownersOptions,
} from "./application/parse-codeowners.js";

export {
  DEFAULT_IGNORED_AUTHOR_PATTERNS,
  compileAuthorIgnorePatterns,
  createAuthorIgnoreMatcher,
  isBotAuthor,
  type AuthorIgnoreMatcher,
} from "./application/ignore-authors.js";

export {
  createIdentityResolver,
  parseOwnerAliases,
  parseOwnersConfig,
  resolveOwnerIdentities,
  type IdentityResolver,
  type ParsedOwnerAliases,
  type ParsedOwnersConfig,
} from "./application/resolve-identities.js";

export {
  DEFAULT_MIN_COMMITS,
  auditOwnership,
  type AuditOwnershipInput,
  type OwnershipFileEvidence,
} from "./application/audit-ownership.js";
