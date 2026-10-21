import { execFileSync } from "node:child_process";
import type { OwnershipAuthor, OwnershipFileEvidence } from "@codesentinel/ownership";

/**
 * Git access for the `owners` command. Everything read here is pinned to a ref, so the audit
 * measures the revision CI names and not whatever happens to be in the working tree.
 *
 * This is the only place in the command that shells out; the audit itself stays pure.
 */

const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";
const LOG_FORMAT = `%x1e%at${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae`;
const MAX_BUFFER_BYTES = 1024 * 1024 * 256;

export type OwnersGitErrorCode =
  "not_a_git_repository" | "empty_repository" | "unknown_ref" | "git_failed";

export class OwnersGitError extends Error {
  readonly code: OwnersGitErrorCode;

  constructor(code: OwnersGitErrorCode, message: string) {
    super(message);
    this.name = "OwnersGitError";
    this.code = code;
  }
}

export type RepositorySnapshot = {
  /** Absolute path to the repository root, which is also the CODEOWNERS and path universe root. */
  repositoryPath: string;
  ref: string;
  /** Authored time of the ref commit. Anchors the observation window so runs are reproducible. */
  commitUnix: number;
  /** Tracked files at the ref, in ascending path order. */
  trackedFiles: readonly string[];
};

const gitErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const stderr = "stderr" in error ? (error as { stderr?: unknown }).stderr : undefined;
    const trimmed = typeof stderr === "string" ? stderr.trim() : "";
    if (trimmed.length > 0) return trimmed;
    return error.message;
  }
  return "unknown git execution error";
};

const runGit = (repositoryPath: string, args: readonly string[]): string => {
  try {
    return execFileSync("git", ["-C", repositoryPath, ...args], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new OwnersGitError("git_failed", "git is not available on PATH.");
    }
    throw new OwnersGitError("git_failed", gitErrorMessage(error));
  }
};

const splitLines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Mirrors `normalizeAuthorIdentity` in `@codesentinel/git-analyzer` (not exported from that
 * package): numeric-prefixed GitHub noreply addresses collapse to `<handle>@users.noreply.github.com`
 * and bots keep their marker, so declared handles can be compared against history.
 */
export const normalizeGitAuthorIdentity = (authorName: string, authorEmail: string): string => {
  const normalizedName = authorName.trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedEmail = authorEmail.trim().toLowerCase();

  if (/\[bot\]/i.test(normalizedName) || /\[bot\]/i.test(normalizedEmail)) {
    return normalizedEmail.length > 0 ? normalizedEmail : normalizedName;
  }

  const githubNoReplyMatch = normalizedEmail.match(/^\d+\+([^@]+)@users\.noreply\.github\.com$/);
  const githubHandle = githubNoReplyMatch?.[1]?.trim().toLowerCase();
  if (githubHandle !== undefined && githubHandle.length > 0) {
    return `${githubHandle}@users.noreply.github.com`;
  }

  if (normalizedEmail.length > 0) {
    return normalizedEmail;
  }

  return normalizedName;
};

export const normalizeRepositoryPath = (value: string): string => {
  let normalized = value.replace(/\\/g, "/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized.replace(/^\/+/, "");
};

const parseInteger = (value: string): number | null => {
  if (value.length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * A rename in `git log --numstat` arrives as `old => new` or `dir/{old => new}/file`. The
 * destination is what the current tree tracks, so that is the path the audit counts.
 */
const parseRenamedPath = (pathSpec: string): string => {
  if (!pathSpec.includes(" => ")) return pathSpec;

  const braceRenameMatch = pathSpec.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
  if (braceRenameMatch !== null) {
    const [, prefix, , renamedTo, suffix] = braceRenameMatch;
    return `${prefix}${renamedTo}${suffix}`;
  }

  const parts = pathSpec.split(" => ");
  return parts[parts.length - 1] ?? pathSpec;
};

/**
 * Resolves the ref and lists the tracked tree at it. `git ls-tree -r` is the ref-pinned
 * equivalent of `git ls-files`: directories, binaries and untracked files are out of scope.
 */
export const readRepositorySnapshot = (targetPath: string, ref: string): RepositorySnapshot => {
  const inside = runGit(targetPath, ["rev-parse", "--is-inside-work-tree"]).trim();
  if (inside !== "true") {
    throw new OwnersGitError(
      "not_a_git_repository",
      `"${targetPath}" is not inside a git work tree.`,
    );
  }

  const repositoryPath = runGit(targetPath, ["rev-parse", "--show-toplevel"]).trim();
  if (repositoryPath.length === 0) {
    throw new OwnersGitError("not_a_git_repository", `"${targetPath}" has no git work tree root.`);
  }

  const commitUnixRaw = runGit(repositoryPath, ["log", "-1", "--format=%ct", ref]).trim();
  const commitUnix = parseInteger(commitUnixRaw);
  if (commitUnix === null) {
    throw new OwnersGitError(
      "unknown_ref",
      `ref "${ref}" does not resolve to a commit in "${repositoryPath}".`,
    );
  }

  const trackedFiles = splitLines(
    runGit(repositoryPath, ["ls-tree", "-r", "-z", "--name-only", ref]).split("\u0000").join("\n"),
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (trackedFiles.length === 0) {
    throw new OwnersGitError(
      "empty_repository",
      `ref "${ref}" has no tracked files, so there is nothing to audit.`,
    );
  }

  return { repositoryPath, ref, commitUnix, trackedFiles };
};

/** Reads one file exactly as the ref stores it. Callers must have seen the path in the tree. */
export const readTextAtRef = (repositoryPath: string, ref: string, filePath: string): string =>
  runGit(repositoryPath, ["show", `${ref}:${filePath}`]);

export type OwnershipEvidence = {
  /** One entry per file with at least one lifetime commit, ascending by path. */
  files: readonly OwnershipFileEvidence[];
  /** Epoch seconds the window starts at, derived from the ref commit. */
  sinceUnix: number;
};

/** Per-author accumulator for a single file: commits plus the raw name used for identity matching. */
type AuthorAccumulator = { authorName: string; commits: number };

type FileAccumulator = {
  commits: number;
  recentCommits: number;
  churnTotal: number;
  lastCommitUnix: number;
  authors: Map<string, AuthorAccumulator>;
  recentAuthors: Map<string, AuthorAccumulator>;
};

const accumulateAuthor = (
  authors: Map<string, AuthorAccumulator>,
  authorId: string,
  authorName: string,
): void => {
  const author = authors.get(authorId) ?? { authorName, commits: 0 };
  authors.set(authorId, { authorName: author.authorName, commits: author.commits + 1 });
};

const toOwnershipAuthors = (
  authors: ReadonlyMap<string, AuthorAccumulator>,
): readonly OwnershipAuthor[] =>
  [...authors.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([authorId, value]) => ({
      authorId,
      authorName: value.authorName,
      commits: value.commits,
    }));

/**
 * Builds per-file authorship evidence for both horizons in a single pass over full history.
 *
 * `commits` and `authors` cover the file's lifetime; `recentCommits` and `recentAuthors` cover
 * `[refCommit - windowDays, refCommit]`. The window is anchored to the ref commit and not to the
 * wall clock: two runs against the same ref therefore see the same commits, which is what makes
 * the JSON reproducible and lets a CI run and a local baseline agree.
 *
 * `criticality.churnTotal` deliberately keeps its window-only semantics, so the criticality
 * fallback still measures recent churn rather than the whole history.
 *
 * Rename detection is disabled so a rename shows up as a delete plus an add instead of a
 * brace-expanded path that would not resolve against the tracked tree.
 */
export const collectOwnershipEvidence = (
  snapshot: RepositorySnapshot,
  windowDays: number,
): OwnershipEvidence => {
  const sinceUnix = snapshot.commitUnix - windowDays * 86_400;
  const rawLog = runGit(snapshot.repositoryPath, [
    "-c",
    "core.quotepath=false",
    "log",
    snapshot.ref,
    "--no-merges",
    "--no-renames",
    "--numstat",
    `--pretty=format:${LOG_FORMAT}`,
  ]);

  const trackedFileSet = new Set(snapshot.trackedFiles);
  const filesByPath = new Map<string, FileAccumulator>();

  const records = rawLog
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record.length > 0);

  for (const record of records) {
    const lines = record
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    const header = lines[0];
    if (header === undefined) continue;

    const [authoredAtRaw, authorName, authorEmail] = header.split(FIELD_SEPARATOR);
    if (authoredAtRaw === undefined || authorName === undefined || authorEmail === undefined) {
      continue;
    }

    const authoredAtUnix = parseInteger(authoredAtRaw);
    if (authoredAtUnix === null) continue;

    const authorId = normalizeGitAuthorIdentity(authorName, authorEmail);
    const insideWindow = authoredAtUnix >= sinceUnix;

    for (const line of lines.slice(1)) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;

      const [additionsRaw, deletionsRaw] = parts;
      if (additionsRaw === undefined || deletionsRaw === undefined) continue;

      const filePath = parseRenamedPath(parts.slice(2).join("\t"));
      if (!trackedFileSet.has(filePath)) continue;

      const accumulator = filesByPath.get(filePath) ?? {
        commits: 0,
        recentCommits: 0,
        churnTotal: 0,
        lastCommitUnix: authoredAtUnix,
        authors: new Map<string, AuthorAccumulator>(),
        recentAuthors: new Map<string, AuthorAccumulator>(),
      };

      accumulator.commits += 1;
      accumulator.lastCommitUnix = Math.max(accumulator.lastCommitUnix, authoredAtUnix);
      accumulateAuthor(accumulator.authors, authorId, authorName);

      if (insideWindow) {
        const additions = additionsRaw === "-" ? 0 : (parseInteger(additionsRaw) ?? 0);
        const deletions = deletionsRaw === "-" ? 0 : (parseInteger(deletionsRaw) ?? 0);

        accumulator.recentCommits += 1;
        accumulator.churnTotal += additions + deletions;
        accumulateAuthor(accumulator.recentAuthors, authorId, authorName);
      }

      filesByPath.set(filePath, accumulator);
    }
  }

  const files: OwnershipFileEvidence[] = [];
  for (const filePath of [...filesByPath.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const accumulator = filesByPath.get(filePath);
    if (accumulator === undefined) continue;

    files.push({
      filePath,
      commits: accumulator.commits,
      recentCommits: accumulator.recentCommits,
      authors: toOwnershipAuthors(accumulator.authors),
      recentAuthors: toOwnershipAuthors(accumulator.recentAuthors),
      lastCommitUnix: accumulator.lastCommitUnix,
      criticality: { churnTotal: accumulator.churnTotal },
    });
  }

  return { files, sinceUnix };
};
