export type McpErrorCode =
  | "invalid_argument"
  | "not_a_git_repository"
  | "no_codeowners"
  | "path_not_found"
  | "path_outside_root"
  | "path_not_tracked"
  | "path_not_analyzed"
  | "not_supported"
  | "no_snapshots"
  | "analysis_failed";

export class McpToolError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}/gi,
  /\bgh[pous]_[A-Za-z0-9]{20,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\btoken=[^\s&"'<>]+/gi,
  /\/\/[^/\s:@]+:[^/\s@]+@/g,
];

/**
 * Error messages can echo git or CI configuration. Only well-known credential shapes are
 * removed: ordinary prose and hashes that merely look random stay intact.
 */
export const redactSecrets = (text: string): string => {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      if (/^Bearer\s/i.test(match)) {
        return `Bearer ${REDACTED}`;
      }
      if (/^token=/i.test(match)) {
        return `token=${REDACTED}`;
      }
      if (match.startsWith("//")) {
        return `//${REDACTED}@`;
      }
      return REDACTED;
    });
  }
  return redacted;
};

export const toToolErrorResult = (
  error: unknown,
): { content: [{ type: "text"; text: string }]; isError: true } => {
  const code: McpErrorCode =
    error instanceof McpToolError ? error.code : ("analysis_failed" satisfies McpErrorCode);
  const rawMessage =
    error instanceof McpToolError
      ? error.message
      : error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "unexpected analysis failure";

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code, message: redactSecrets(rawMessage) } }),
      },
    ],
    isError: true,
  };
};
