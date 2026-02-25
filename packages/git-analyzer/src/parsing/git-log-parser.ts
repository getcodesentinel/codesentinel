import { COMMIT_FIELD_SEPARATOR, COMMIT_RECORD_SEPARATOR } from "../domain/git-log-format.js";
import type { GitCommitRecord, GitFileChange } from "../domain/evolution-types.js";

const parseInteger = (value: string): number | null => {
  if (value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
};

const normalizeAuthorIdentity = (authorName: string, authorEmail: string): string => {
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

const parseRenamedPath = (pathSpec: string): string => {
  if (!pathSpec.includes(" => ")) {
    return pathSpec;
  }

  const braceRenameMatch = pathSpec.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
  if (braceRenameMatch !== null) {
    const [, prefix, , renamedTo, suffix] = braceRenameMatch;
    return `${prefix}${renamedTo}${suffix}`;
  }

  const parts = pathSpec.split(" => ");
  const finalPart = parts[parts.length - 1];
  return finalPart ?? pathSpec;
};

const parseNumstatLine = (line: string): GitFileChange | null => {
  const parts = line.split("\t");
  if (parts.length < 3) {
    return null;
  }

  const additionsRaw = parts[0];
  const deletionsRaw = parts[1];
  const pathRaw = parts.slice(2).join("\t");

  if (additionsRaw === undefined || deletionsRaw === undefined) {
    return null;
  }

  const additions = additionsRaw === "-" ? 0 : parseInteger(additionsRaw);
  const deletions = deletionsRaw === "-" ? 0 : parseInteger(deletionsRaw);

  if (additions === null || deletions === null) {
    return null;
  }

  const filePath = parseRenamedPath(pathRaw);
  return {
    filePath,
    additions,
    deletions,
  };
};

export const parseGitLog = (rawLog: string): readonly GitCommitRecord[] => {
  const records = rawLog
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record.length > 0);

  const commits: GitCommitRecord[] = [];

  for (const record of records) {
    const lines = record
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      continue;
    }

    const headerParts = lines[0]?.split(COMMIT_FIELD_SEPARATOR) ?? [];
    if (headerParts.length !== 4) {
      continue;
    }

    const [hash, authoredAtRaw, authorName, authorEmail] = headerParts;
    if (hash === undefined || authoredAtRaw === undefined || authorName === undefined || authorEmail === undefined) {
      continue;
    }

    const authoredAtUnix = parseInteger(authoredAtRaw);
    if (authoredAtUnix === null) {
      continue;
    }

    const fileChanges: GitFileChange[] = [];
    for (const line of lines.slice(1)) {
      const parsedLine = parseNumstatLine(line);
      if (parsedLine !== null) {
        fileChanges.push(parsedLine);
      }
    }

    commits.push({
      hash,
      authorId: normalizeAuthorIdentity(authorName, authorEmail),
      authorName,
      authoredAtUnix,
      fileChanges,
    });
  }

  commits.sort((a, b) => a.authoredAtUnix - b.authoredAtUnix || a.hash.localeCompare(b.hash));
  return commits;
};
