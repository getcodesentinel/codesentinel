export {
  CODEOWNERS_MAX_BYTES,
  CodeownersError,
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
  CODEOWNERS_CANDIDATE_PATHS,
  DEFAULT_CODEOWNERS_SOURCE,
  discoverCodeowners,
  parseCodeowners,
  type CodeownersSourceSelection,
  type ParseCodeownersOptions,
} from "./application/parse-codeowners.js";
