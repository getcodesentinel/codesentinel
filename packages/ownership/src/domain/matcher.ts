import { CodeownersError } from "./codeowners.js";
import type { CodeownersEntry } from "./codeowners.js";

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

const ANY_DEPTH_PREFIX = "(?:[^/]+/)*";

export type CompiledCodeownersPattern = {
  pattern: string;
  regex: RegExp;
};

export type CodeownersMatcher = (filePath: string) => CodeownersEntry | null;

const escapeLiteral = (value: string): string => value.replace(REGEX_METACHARACTERS, "\\$&");

const compileSegment = (segment: string): string =>
  [...segment]
    .map((character) => {
      if (character === "*") return "[^/]*";
      if (character === "?") return "[^/]";
      return escapeLiteral(character);
    })
    .join("");

const compileBody = (segments: readonly string[]): string => {
  const parts: string[] = [];
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (segment === "**") {
      parts.push(isLast ? ".*" : ANY_DEPTH_PREFIX);
      return;
    }
    parts.push(compileSegment(segment));
    if (!isLast) parts.push("/");
  });
  return parts.join("");
};

const normalizeFilePath = (filePath: string): string => {
  let normalized = filePath;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
};

/**
 * Compiles a CODEOWNERS pattern into an anchored regular expression over repo-relative paths.
 *
 * Rules, matching GitHub's documented behaviour rather than full gitignore:
 * - A pattern with no internal `/` matches at any depth; `/`-prefixed patterns are root-anchored.
 * - `*` and `?` never cross a `/` separator; `**` crosses segments.
 * - A trailing `/` marks a directory pattern: it owns the directory subtree.
 * - A pattern whose last segment is literal also owns the subtree, so `/apps/github` covers
 *   `apps/github/*`. A wildcarded last segment stays exact, so `docs/*` covers one level only.
 * - `!` and `[...]` are literal characters: GitHub does not implement negation or character classes.
 * - Matching is case-sensitive on every platform.
 */
export function compileCodeownersPattern(pattern: string): CompiledCodeownersPattern {
  const trimmed = pattern.trim();
  const directoryPattern = trimmed.endsWith("/");
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, "");
  const anchored =
    withoutTrailingSlashes.startsWith("/") || withoutTrailingSlashes.slice(1).includes("/");
  const core = withoutTrailingSlashes.replace(/^\/+/, "");

  if (core.length === 0) {
    throw new CodeownersError(
      "codeowners_invalid_pattern",
      `CODEOWNERS pattern "${pattern}" does not match any path.`,
    );
  }

  const segments = core.split("/");
  const lastSegment = segments[segments.length - 1] ?? "";
  const lastSegmentIsLiteral =
    lastSegment !== "**" && !lastSegment.includes("*") && !lastSegment.includes("?");

  const prefix = anchored ? "" : ANY_DEPTH_PREFIX;
  const suffix = directoryPattern ? "(?:/.*)" : lastSegmentIsLiteral ? "(?:/.*)?" : "";
  const regex = new RegExp(`^${prefix}${compileBody(segments)}${suffix}$`);

  return { pattern: trimmed, regex };
}

export function matchCodeownersPattern(pattern: string, filePath: string): boolean {
  const candidate = normalizeFilePath(filePath);
  if (candidate.length === 0) return false;
  return compileCodeownersPattern(pattern).regex.test(candidate);
}

/**
 * Precompiles every non-ignored entry once and returns a resolver with last-match-wins semantics.
 * A matching entry with no owners is a winner too: it means the subtree is deliberately unowned.
 */
export function createCodeownersMatcher(entries: readonly CodeownersEntry[]): CodeownersMatcher {
  const compiled = entries
    .filter((entry) => !entry.ignored)
    .map((entry) => ({ entry, regex: compileCodeownersPattern(entry.pattern).regex }));

  return (filePath: string): CodeownersEntry | null => {
    const candidate = normalizeFilePath(filePath);
    if (candidate.length === 0) return null;

    let winner: CodeownersEntry | null = null;
    for (const { entry, regex } of compiled) {
      if (regex.test(candidate)) winner = entry;
    }
    return winner;
  };
}

/** Convenience wrapper. Recompiles the entries on every call; use `createCodeownersMatcher` in loops. */
export function findOwningEntry(
  entries: readonly CodeownersEntry[],
  filePath: string,
): CodeownersEntry | null {
  return createCodeownersMatcher(entries)(filePath);
}
