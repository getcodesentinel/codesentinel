import { mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodeSentinelSnapshot } from "@codesentinel/reporter";
import {
  BaselineAutoResolutionError,
  resolveAutoBaseline,
  type BaselineAutoResolution,
  type GitCommandResult,
} from "./baseline-auto-resolver.js";

const execFileAsync = promisify(execFile);

const SENTINEL_TMP_DIR = ".codesentinel-tmp";
const WORKTREE_DIR = "worktrees";

export class BaselineRefResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineRefResolutionError";
  }
}

const runGit = async (repositoryPath: string, args: readonly string[]): Promise<string> => {
  const result = await tryRunGit(repositoryPath, args);
  if (result.ok) {
    return result.stdout;
  }
  throw new BaselineRefResolutionError(result.message);
};

const tryRunGit = async (
  repositoryPath: string,
  args: readonly string[],
): Promise<GitCommandResult> => {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repositoryPath, ...args], {
      encoding: "utf8",
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown git error";
    return { ok: false, message };
  }
};

const buildWorktreePath = (repoRoot: string, sha: string): string => {
  const tmpRoot = join(repoRoot, SENTINEL_TMP_DIR, WORKTREE_DIR);
  mkdirSync(tmpRoot, { recursive: true });

  const baseName = `baseline-${sha.slice(0, 12)}-${process.pid}`;
  const candidate = resolve(tmpRoot, baseName);
  return candidate;
};

const sanitizeSnapshotForWorktree = (
  snapshot: CodeSentinelSnapshot,
  worktreePath: string,
  canonicalPath: string,
): CodeSentinelSnapshot => {
  const replacePrefix = (value: string): string =>
    value.startsWith(worktreePath) ? `${canonicalPath}${value.slice(worktreePath.length)}` : value;

  const structural = snapshot.analysis.structural;

  return {
    ...snapshot,
    source: {
      targetPath: replacePrefix(snapshot.source.targetPath),
    },
    analysis: {
      ...snapshot.analysis,
      structural: {
        ...structural,
        targetPath: replacePrefix(structural.targetPath),
        nodes: structural.nodes.map((node) => ({
          ...node,
          absolutePath: replacePrefix(node.absolutePath),
        })),
      },
      evolution: {
        ...snapshot.analysis.evolution,
        targetPath: replacePrefix(snapshot.analysis.evolution.targetPath),
      },
      external: {
        ...snapshot.analysis.external,
        targetPath: replacePrefix(snapshot.analysis.external.targetPath),
      },
    },
  };
};

export type BaselineRefResolutionResult = {
  baselineSnapshot: CodeSentinelSnapshot;
  resolvedRef: string;
  resolvedSha: string;
};

export type ResolveBaselineFromRefInput = {
  repositoryPath: string;
  baselineRef: string;
  analyzeWorktree: (worktreePath: string, repositoryRoot: string) => Promise<CodeSentinelSnapshot>;
};

export type ResolveAutoBaselineRefInput = {
  repositoryPath: string;
  baselineSha?: string;
  mainBranchCandidates?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
};

export const resolveBaselineSnapshotFromRef = async (
  input: ResolveBaselineFromRefInput,
): Promise<BaselineRefResolutionResult> => {
  const repositoryPath = resolve(input.repositoryPath);
  const ref = input.baselineRef.trim();
  if (ref.length === 0) {
    throw new BaselineRefResolutionError("baseline-ref cannot be empty");
  }

  const repoRoot = await runGit(repositoryPath, ["rev-parse", "--show-toplevel"]);
  const sha = await runGit(repositoryPath, ["rev-parse", "--verify", `${ref}^{commit}`]);

  const worktreePath = buildWorktreePath(repoRoot, sha);

  const cleanup = (): void => {
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Best-effort fallback cleanup if worktree remove fails.
    }
  };

  try {
    await runGit(repoRoot, ["worktree", "add", "--detach", worktreePath, sha]);

    const snapshot = await input.analyzeWorktree(worktreePath, repoRoot);
    const sanitized = sanitizeSnapshotForWorktree(snapshot, worktreePath, repoRoot);

    return {
      baselineSnapshot: sanitized,
      resolvedRef: ref,
      resolvedSha: sha,
    };
  } finally {
    try {
      await runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
    } catch {
      cleanup();
    }
  }
};

export const baselineTempDirectoryName = (): string =>
  basename(join(SENTINEL_TMP_DIR, WORKTREE_DIR));

export const resolveAutoBaselineRef = async (
  input: ResolveAutoBaselineRefInput,
): Promise<BaselineAutoResolution> => {
  const repositoryPath = resolve(input.repositoryPath);
  const repoRoot = await runGit(repositoryPath, ["rev-parse", "--show-toplevel"]);

  try {
    return await resolveAutoBaseline({
      ...(input.baselineSha === undefined ? {} : { baselineSha: input.baselineSha }),
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      ...(input.mainBranchCandidates === undefined
        ? {}
        : { mainBranchCandidates: input.mainBranchCandidates }),
      git: {
        resolveCommit: async (ref: string): Promise<GitCommandResult> =>
          tryRunGit(repoRoot, ["rev-parse", "--verify", ref]),
        mergeBase: async (leftRef: string, rightRef: string): Promise<GitCommandResult> =>
          tryRunGit(repoRoot, ["merge-base", leftRef, rightRef]),
        currentBranch: async (): Promise<GitCommandResult> =>
          tryRunGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
        isShallowRepository: async (): Promise<GitCommandResult> =>
          tryRunGit(repoRoot, ["rev-parse", "--is-shallow-repository"]),
      },
    });
  } catch (error) {
    if (error instanceof BaselineAutoResolutionError) {
      throw new BaselineRefResolutionError(error.message);
    }
    throw error;
  }
};
