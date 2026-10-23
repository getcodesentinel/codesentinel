import type { DeclaredOwner } from "../domain/codeowners.js";
import type { OwnerAliases, OwnerResolution, OwnershipAuthor } from "../domain/identity.js";
import { isBotAuthor } from "./ignore-authors.js";

const WHITESPACE_PATTERN = /\s+/g;

const normalizeHandle = (value: string): string =>
  value.trim().replace(/^@+/, "").toLowerCase().replace(WHITESPACE_PATTERN, "");

const normalizeAuthorName = (value: string): string =>
  value.toLowerCase().replace(WHITESPACE_PATTERN, "");

const localPartOf = (authorId: string): string | null => {
  const at = authorId.indexOf("@");
  return at > 0 ? authorId.slice(0, at) : null;
};

const uniquify = (values: readonly string[]): readonly string[] => [...new Set(values)];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type ParsedOwnerAliases = {
  aliases: OwnerAliases;
  warnings: readonly string[];
};

export type ParsedOwnersConfig = {
  aliases: OwnerAliases;
  ignoreAuthors: readonly string[];
  warnings: readonly string[];
};

const parseAliases = (rawAliases: unknown, warnings: string[]): OwnerAliases => {
  if (rawAliases === undefined || rawAliases === null) {
    return {};
  }

  if (!isRecord(rawAliases)) {
    warnings.push('owners.json "aliases" must be an object: identity aliases were ignored.');
    return {};
  }

  const aliases: Record<string, readonly string[]> = {};
  for (const [handle, value] of Object.entries(rawAliases)) {
    const key = normalizeHandle(handle);
    if (key.length === 0) {
      warnings.push("An alias entry with an empty handle was ignored.");
      continue;
    }
    if (!Array.isArray(value)) {
      warnings.push(`Alias entry "${key}" was ignored: expected an array of author ids.`);
      continue;
    }

    const targets = value
      .filter((target): target is string => typeof target === "string")
      .map((target) => target.trim().toLowerCase())
      .filter((target) => target.length > 0);

    if (targets.length === 0) {
      warnings.push(`Alias entry "${key}" was ignored: it contains no usable author id.`);
      continue;
    }

    aliases[key] = [...(aliases[key] ?? []), ...targets];
  }

  for (const key of Object.keys(aliases)) {
    aliases[key] = uniquify(aliases[key] ?? []);
  }

  return aliases;
};

const parseIgnoreAuthors = (rawIgnoreAuthors: unknown, warnings: string[]): readonly string[] => {
  if (rawIgnoreAuthors === undefined || rawIgnoreAuthors === null) {
    return [];
  }

  if (!Array.isArray(rawIgnoreAuthors)) {
    warnings.push(
      'owners.json "ignoreAuthors" must be an array of glob pattern strings: it was ignored.',
    );
    return [];
  }

  const seen = new Set<string>();
  const patterns: string[] = [];
  rawIgnoreAuthors.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      warnings.push(
        `owners.json "ignoreAuthors[${index + 1}]" was ignored: expected a non-empty glob pattern string.`,
      );
      return;
    }

    const pattern = entry.trim();
    const key = pattern.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    patterns.push(pattern);
  });

  return patterns;
};

/**
 * Parses the versioned identity configuration (`.codesentinel/owners.json`) from text the caller
 * read.
 *
 * Two shapes are accepted: the wrapped object
 * `{ "aliases": { "handle": ["author-id"] }, "ignoreAuthors": [...] }` and a bare alias map
 * `{ "handle": ["author-id"] }`. A wrapped key (`aliases` or `ignoreAuthors`) selects the wrapped
 * shape; otherwise an object whose every value is an array is read as the bare alias map.
 *
 * Absence is not a problem: a missing or empty file yields no aliases, no ignore patterns and no
 * warnings. Anything that cannot be used is dropped with an explicit warning, because silently
 * discarding identity data would turn a configuration mistake into a false ghost-owner report.
 */
export const parseOwnersConfig = (raw: string | null | undefined): ParsedOwnersConfig => {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return { aliases: {}, ignoreAuthors: [], warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      aliases: {},
      ignoreAuthors: [],
      warnings: ["owners.json is not valid JSON: identity aliases were ignored."],
    };
  }

  if (!isRecord(parsed)) {
    return {
      aliases: {},
      ignoreAuthors: [],
      warnings: ["owners.json must contain a JSON object: identity aliases were ignored."],
    };
  }

  if (!("aliases" in parsed) && !("ignoreAuthors" in parsed)) {
    if (Object.keys(parsed).length === 0) {
      return { aliases: {}, ignoreAuthors: [], warnings };
    }

    if (Object.values(parsed).every((value) => Array.isArray(value))) {
      return { aliases: parseAliases(parsed, warnings), ignoreAuthors: [], warnings };
    }

    warnings.push(
      'owners.json must contain either an "aliases" object or a bare { "handle": ["author-id"] } map: identity aliases were ignored.',
    );
    return { aliases: {}, ignoreAuthors: [], warnings };
  }

  const aliases = parseAliases(parsed["aliases"], warnings);
  const ignoreAuthors = parseIgnoreAuthors(parsed["ignoreAuthors"], warnings);
  return { aliases, ignoreAuthors, warnings };
};

export const parseOwnerAliases = (raw: string | null | undefined): ParsedOwnerAliases => {
  const { aliases, warnings } = parseOwnersConfig(raw);
  return { aliases, warnings };
};

export type IdentityResolver = (
  owner: DeclaredOwner,
  authors: readonly OwnershipAuthor[],
) => OwnerResolution;

const resolveOwner = (
  owner: DeclaredOwner,
  authors: readonly OwnershipAuthor[],
  aliases: ReadonlyMap<string, readonly string[]>,
): OwnerResolution => {
  if (owner.kind === "team") {
    return { owner, kind: "team_unverified", activeAuthorIds: [] };
  }

  const candidates = authors.filter((author) => !isBotAuthor(author));

  if (owner.kind === "email") {
    const target = owner.address.trim().toLowerCase();
    const active = candidates
      .filter((author) => author.authorId.trim().toLowerCase() === target)
      .map((author) => author.authorId);
    return { owner, kind: "email_owner", activeAuthorIds: uniquify(active) };
  }

  const handle = normalizeHandle(owner.handle);
  if (handle.length === 0) {
    return { owner, kind: "no_activity", activeAuthorIds: [] };
  }

  const noreplyId = `${handle}@users.noreply.github.com`;
  const aliasTargets = aliases.get(handle) ?? [];
  const matchedKinds = {
    github_noreply: false,
    email_local_part: false,
    author_name: false,
    alias: false,
  };
  const activeAuthorIds: string[] = [];
  const seenAuthorIds = new Set<string>();

  for (const author of candidates) {
    const authorId = author.authorId.trim().toLowerCase();
    const matchesNoreply = authorId === noreplyId;

    const localPart = localPartOf(authorId);
    const matchesLocalPart = localPart !== null && localPart === handle;

    const authorName =
      typeof author.authorName === "string" ? normalizeAuthorName(author.authorName) : "";
    const matchesName = authorName.length > 0 && authorName === handle;

    const matchesAlias = aliasTargets.includes(authorId);

    if (!matchesNoreply && !matchesLocalPart && !matchesName && !matchesAlias) continue;

    matchedKinds.github_noreply ||= matchesNoreply;
    matchedKinds.email_local_part ||= matchesLocalPart;
    matchedKinds.author_name ||= matchesName;
    matchedKinds.alias ||= matchesAlias;

    if (seenAuthorIds.has(author.authorId)) continue;
    seenAuthorIds.add(author.authorId);
    activeAuthorIds.push(author.authorId);
  }

  if (matchedKinds.github_noreply) {
    return { owner, kind: "github_noreply", activeAuthorIds };
  }
  if (matchedKinds.email_local_part) {
    return { owner, kind: "email_local_part", activeAuthorIds };
  }
  if (matchedKinds.author_name) {
    return { owner, kind: "author_name", activeAuthorIds };
  }
  if (matchedKinds.alias) {
    return { owner, kind: "alias", activeAuthorIds };
  }
  if (aliasTargets.length > 0) {
    // The map claims identities for this handle and none of them were observed: the map may be
    // stale, so absence cannot be reported as a ghost.
    return { owner, kind: "alias_unresolved", activeAuthorIds: [] };
  }
  return { owner, kind: "no_activity", activeAuthorIds: [] };
};

/**
 * Builds an offline identity resolver from an alias map. Fully deterministic: no network, no clock,
 * and the cascade order is the one documented in the design (noreply, email local part, author
 * name, alias).
 */
export const createIdentityResolver = (aliases: OwnerAliases = {}): IdentityResolver => {
  const normalizedAliases = new Map<string, readonly string[]>();
  for (const [handle, targets] of Object.entries(aliases)) {
    const key = normalizeHandle(handle);
    if (key.length === 0) continue;
    normalizedAliases.set(
      key,
      targets.map((target) => target.trim().toLowerCase()).filter((target) => target.length > 0),
    );
  }

  return (owner, authors) => resolveOwner(owner, authors, normalizedAliases);
};

export const resolveOwnerIdentities = (
  owners: readonly DeclaredOwner[],
  authors: readonly OwnershipAuthor[],
  aliases: OwnerAliases = {},
): readonly OwnerResolution[] => {
  const resolve = createIdentityResolver(aliases);
  return owners.map((owner) => resolve(owner, authors));
};
