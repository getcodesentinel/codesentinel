import type { DeclaredOwner } from "./codeowners.js";

/**
 * Author evidence for a single file, already reduced to the observation window.
 *
 * `authorId` is expected to be the normalized identity produced by
 * `normalizeAuthorIdentity` in `@codesentinel/git-analyzer`: the numeric prefix of a GitHub
 * noreply address is already stripped, so `<handle>@users.noreply.github.com` is comparable
 * against a CODEOWNERS handle. An unnormalized `123+handle@users.noreply.github.com` will not
 * resolve, by design: the parser is the single place where that normalization happens.
 */
export type OwnershipAuthor = {
  authorId: string;
  /** Raw author name, when available. The evolution summary does not keep it. */
  authorName?: string | null;
  /** Commits by this author inside the observation window. */
  commits: number;
};

/**
 * Identity aliases: handle (with or without `@`) mapping to the author ids that belong to it.
 * The map is versioned in `.codesentinel/owners.json`; reading that file is the caller's job.
 */
export type OwnerAliases = Readonly<Record<string, readonly string[]>>;

/**
 * How a declared owner related to the observed authors.
 *
 * - `github_noreply`, `email_local_part`, `author_name`, `alias`: the owner matched at least one
 *   author, in cascade order.
 * - `email_owner`: an email owner matched an author id exactly.
 * - `team_unverified`: an unexpanded team. Offline it is opaque, so it is never a ghost.
 * - `no_activity`: no author matched and nothing external could hide the absence.
 * - `alias_unresolved`: no author matched, but the alias map declares identities for this handle
 *   that were not observed. The map may be incomplete, so the absence is not proof.
 */
export type OwnerResolutionKind =
  | "github_noreply"
  | "email_local_part"
  | "author_name"
  | "alias"
  | "email_owner"
  | "team_unverified"
  | "no_activity"
  | "alias_unresolved";

export type OwnerResolution = {
  owner: DeclaredOwner;
  kind: OwnerResolutionKind;
  /** Author ids from the evidence covered by this owner, in evidence order. */
  activeAuthorIds: readonly string[];
};

export const isActiveOwnerResolution = (resolution: OwnerResolution): boolean =>
  resolution.activeAuthorIds.length > 0;

/**
 * Whether absence of activity for this owner is evidence: a team that was never expanded, or an
 * alias that never showed up in the window, both mean "we do not know" rather than "ghost".
 */
export const isVerifiableOwnerResolution = (resolution: OwnerResolution): boolean =>
  resolution.kind !== "team_unverified" && resolution.kind !== "alias_unresolved";
