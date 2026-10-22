import type { OwnershipAuthor } from "../domain/identity.js";

/**
 * Author glob dialects used by `ignoreAuthors` (`.codesentinel/owners.json`) and `--ignore-author`.
 * Matching is case-insensitive, anchored to the full author id or name, `*` matches any sequence
 * (including `@`, `/` and spaces), `?` matches one character, and every other character is
 * literal: `[`, `]`, `.`, `(`, `)`, `+` carry no special meaning.
 */
export const DEFAULT_IGNORED_AUTHOR_PATTERNS: readonly string[] = [
  "*[bot]*",
  "*-bot@*",
  "*bot@users.noreply.github.com",
  "semantic-release-bot@*",
  "renovate@*",
  "dependabot@*",
  "github-actions@*",
  "noreply@github.com",
];

export type AuthorIgnoreMatcher = (author: OwnershipAuthor) => boolean;

const escapePattern = (pattern: string): string => pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compilePattern = (pattern: string): RegExp => {
  const escaped = escapePattern(pattern);
  const source = escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp(`^${source}$`, "i");
};

const normalizePatterns = (patterns: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
};

export const compileAuthorIgnorePatterns = (patterns: readonly string[]): AuthorIgnoreMatcher => {
  const compiled: readonly RegExp[] = patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map(compilePattern);

  return (author) => {
    const name = typeof author.authorName === "string" ? author.authorName : "";
    const hasName = name.trim().length > 0;
    return compiled.some(
      (pattern) => pattern.test(author.authorId) || (hasName && pattern.test(name)),
    );
  };
};

export const createAuthorIgnoreMatcher = (
  extraPatterns: readonly string[] = [],
): AuthorIgnoreMatcher =>
  compileAuthorIgnorePatterns(
    normalizePatterns([...DEFAULT_IGNORED_AUTHOR_PATTERNS, ...extraPatterns]),
  );

const defaultAuthorIgnoreMatcher = createAuthorIgnoreMatcher();

export const isBotAuthor = (author: OwnershipAuthor): boolean => defaultAuthorIgnoreMatcher(author);
