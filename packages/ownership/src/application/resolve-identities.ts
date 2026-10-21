import type { DeclaredOwner } from "../domain/codeowners.js";
import type { OwnerAliases, OwnerResolution, OwnershipAuthor } from "../domain/identity.js";

const BOT_MARKER = /\[bot\]/i;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Bots commit a lot and never own anything. `normalizeAuthorIdentity` keeps `[bot]` in the id,
 * so excluding them here prevents machine accounts from ever being attributed to a human handle.
 */
export const isBotAuthor = (author: OwnershipAuthor): boolean => {
  if (BOT_MARKER.test(author.authorId)) return true;
  return typeof author.authorName === "string" && BOT_MARKER.test(author.authorName);
};

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

/**
 * Parses the versioned alias map (`.codesentinel/owners.json`) from text the caller read.
 *
 * Absence is not a problem: a missing or empty file yields no aliases and no warnings. Anything
 * that cannot be used is dropped with an explicit warning, because silently discarding identity
 * data would turn a configuration mistake into a false ghost-owner report.
 */
export const parseOwnerAliases = (raw: string | null | undefined): ParsedOwnerAliases => {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return { aliases: {}, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      aliases: {},
      warnings: ["owners.json is not valid JSON: identity aliases were ignored."],
    };
  }

  if (!isRecord(parsed)) {
    return {
      aliases: {},
      warnings: ["owners.json must contain a JSON object: identity aliases were ignored."],
    };
  }

  const rawAliases = parsed["aliases"];
  if (rawAliases === undefined || rawAliases === null) {
    return { aliases: {}, warnings };
  }

  if (!isRecord(rawAliases)) {
    return {
      aliases: {},
      warnings: ['owners.json "aliases" must be an object: identity aliases were ignored.'],
    };
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
  const byNoreply: string[] = [];
  const byLocalPart: string[] = [];
  const byName: string[] = [];
  const byAlias: string[] = [];

  for (const author of candidates) {
    const authorId = author.authorId.trim().toLowerCase();
    if (authorId === noreplyId) {
      byNoreply.push(author.authorId);
      continue;
    }

    const localPart = localPartOf(authorId);
    if (localPart !== null && localPart === handle) {
      byLocalPart.push(author.authorId);
      continue;
    }

    const authorName =
      typeof author.authorName === "string" ? normalizeAuthorName(author.authorName) : "";
    if (authorName.length > 0 && authorName === handle) {
      byName.push(author.authorId);
      continue;
    }

    if (aliasTargets.includes(authorId)) {
      byAlias.push(author.authorId);
    }
  }

  if (byNoreply.length > 0) {
    return { owner, kind: "github_noreply", activeAuthorIds: uniquify(byNoreply) };
  }
  if (byLocalPart.length > 0) {
    return { owner, kind: "email_local_part", activeAuthorIds: uniquify(byLocalPart) };
  }
  if (byName.length > 0) {
    return { owner, kind: "author_name", activeAuthorIds: uniquify(byName) };
  }
  if (byAlias.length > 0) {
    return { owner, kind: "alias", activeAuthorIds: uniquify(byAlias) };
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
