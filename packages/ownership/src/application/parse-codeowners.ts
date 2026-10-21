import { CODEOWNERS_MAX_BYTES, CodeownersError } from "../domain/codeowners.js";
import type {
  CodeownersEntry,
  CodeownersParseError,
  DeclaredOwner,
  ParsedCodeowners,
} from "../domain/codeowners.js";

export const CODEOWNERS_CANDIDATE_PATHS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
] as const;

export const DEFAULT_CODEOWNERS_SOURCE = "CODEOWNERS";

export type CodeownersSourceSelection = {
  source: string;
  ignoredSources: readonly string[];
};

export type ParseCodeownersOptions = {
  source?: string;
  ignoredSources?: readonly string[];
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
const WHITESPACE_PATTERN = /\s/;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
};

const parseOwner = (token: string): DeclaredOwner | null => {
  if (!token.startsWith("@")) {
    return EMAIL_PATTERN.test(token) ? { kind: "email", address: token } : null;
  }

  const reference = token.slice(1);
  if (reference.length === 0 || reference.includes("@")) return null;

  const parts = reference.split("/");
  if (parts.length === 1) {
    return { kind: "user", handle: reference };
  }
  if (parts.length !== 2) return null;

  const [org, slug] = parts;
  if (org === undefined || slug === undefined || org.length === 0 || slug.length === 0) return null;
  return { kind: "team", org, slug };
};

const isValidPattern = (pattern: string): boolean => {
  if (hasControlCharacter(pattern)) return false;
  return pattern.replace(/^\/+/, "").replace(/\/+$/, "").length > 0;
};

/**
 * GitHub starts a comment at `#` when it is the first character of the line or follows whitespace,
 * and escaping it is not supported. Any other `#` stays inside the pattern.
 */
const commentIndex = (line: string): number => {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "#") continue;
    const previous = index === 0 ? "" : (line[index - 1] ?? "");
    if (index === 0 || WHITESPACE_PATTERN.test(previous)) return index;
  }
  return -1;
};

const stripComment = (line: string): string => {
  const index = commentIndex(line);
  return index === -1 ? line : line.slice(0, index);
};

/**
 * Parses CODEOWNERS text into entries plus parse errors. Pure: no filesystem, no network.
 *
 * A pattern with no owners is a valid entry that clears ownership of its subtree. A line with an
 * invalid pattern or owner is preserved with `ignored: true` and reported in `errors`; the owners
 * that did parse are kept for diagnostics but never participate in matching.
 */
export function parseCodeowners(
  text: string,
  options: ParseCodeownersOptions = {},
): ParsedCodeowners {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > CODEOWNERS_MAX_BYTES) {
    throw new CodeownersError(
      "codeowners_too_large",
      `CODEOWNERS content is ${byteLength} bytes, above the ${CODEOWNERS_MAX_BYTES} byte limit GitHub accepts.`,
    );
  }

  const entries: CodeownersEntry[] = [];
  const errors: CodeownersParseError[] = [];
  const lines = text.replace(/^\uFEFF/, "").split("\n");

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const content = stripComment(line).trim();
    if (content.length === 0) return;

    const [pattern, ...ownerTokens] = content.split(/\s+/);
    if (pattern === undefined) return;

    let ignored = !isValidPattern(pattern);
    if (ignored) {
      errors.push({ line: lineNumber, reason: `invalid pattern "${pattern}"` });
    }

    const owners: DeclaredOwner[] = [];
    for (const token of ownerTokens) {
      const owner = parseOwner(token);
      if (owner === null) {
        ignored = true;
        errors.push({ line: lineNumber, reason: `invalid owner "${token}"` });
        continue;
      }
      owners.push(owner);
    }

    entries.push({ pattern, owners, line: lineNumber, ignored });
  });

  return {
    source: options.source ?? DEFAULT_CODEOWNERS_SOURCE,
    entries,
    errors,
    ignoredSources: options.ignoredSources ?? [],
  };
}

const normalizeSourcePath = (source: string): string => {
  let normalized = source;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized.replace(/^\/+/, "");
};

/**
 * GitHub checks these locations in order and loads only the first one that exists.
 * `existingPaths` is whatever the caller found on disk; the rest become `ignoredSources`.
 */
export function discoverCodeowners(
  existingPaths: readonly string[],
): CodeownersSourceSelection | null {
  const existing = new Set(existingPaths.map(normalizeSourcePath));
  const found = CODEOWNERS_CANDIDATE_PATHS.filter((candidate) => existing.has(candidate));
  const [source, ...ignoredSources] = found;
  if (source === undefined) return null;
  return { source, ignoredSources };
}
