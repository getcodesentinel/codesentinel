import { describe, expect, it } from "vitest";
import {
  BaselineAutoResolutionError,
  resolveAutoBaseline,
  type BaselineAutoGitAdapter,
  type GitCommandResult,
} from "./baseline-auto-resolver.js";

const ok = (stdout: string): GitCommandResult => ({ ok: true, stdout });
const fail = (message: string): GitCommandResult => ({ ok: false, message });

type AdapterOptions = {
  resolveCommit?: Record<string, GitCommandResult>;
  mergeBase?: Record<string, GitCommandResult>;
  currentBranch?: GitCommandResult;
  isShallowRepository?: GitCommandResult;
};

const createAdapter = (options: AdapterOptions = {}): BaselineAutoGitAdapter => {
  return {
    resolveCommit: (ref: string): Promise<GitCommandResult> =>
      Promise.resolve(options.resolveCommit?.[ref] ?? fail(`missing ${ref}`)),
    mergeBase: (leftRef: string, rightRef: string): Promise<GitCommandResult> =>
      Promise.resolve(
        options.mergeBase?.[`${leftRef}|${rightRef}`] ?? fail(`missing ${leftRef}|${rightRef}`),
      ),
    currentBranch: (): Promise<GitCommandResult> =>
      Promise.resolve(options.currentBranch ?? ok("feature/example")),
    isShallowRepository: (): Promise<GitCommandResult> =>
      Promise.resolve(options.isShallowRepository ?? ok("false")),
  };
};

describe("resolveAutoBaseline", () => {
  it("uses explicit baseline sha when provided", async () => {
    const result = await resolveAutoBaseline({
      baselineSha: "abc123",
      git: createAdapter({
        resolveCommit: {
          "abc123^{commit}": ok("abc123"),
        },
      }),
    });

    expect(result.strategy).toBe("explicit_sha");
    expect(result.resolvedSha).toBe("abc123");
  });

  it("uses CI base branch from GitHub environment with origin priority", async () => {
    const result = await resolveAutoBaseline({
      environment: { GITHUB_BASE_REF: "main" },
      git: createAdapter({
        resolveCommit: {
          "origin/main^{commit}": ok("sha-origin-main"),
        },
      }),
    });

    expect(result.strategy).toBe("ci_base_branch");
    expect(result.resolvedRef).toBe("origin/main");
    expect(result.resolvedSha).toBe("sha-origin-main");
  });

  it("uses HEAD~1 when current branch matches main candidate", async () => {
    const result = await resolveAutoBaseline({
      mainBranchCandidates: ["main", "trunk"],
      git: createAdapter({
        currentBranch: ok("main"),
        resolveCommit: {
          "HEAD~1^{commit}": ok("sha-head-prev"),
        },
      }),
    });

    expect(result.strategy).toBe("main_branch_previous_commit");
    expect(result.resolvedRef).toBe("HEAD~1");
    expect(result.resolvedSha).toBe("sha-head-prev");
  });

  it("uses merge-base for feature branches with deterministic fallback order", async () => {
    const result = await resolveAutoBaseline({
      mainBranchCandidates: ["main", "master"],
      git: createAdapter({
        currentBranch: ok("feature/risk-model"),
        mergeBase: {
          "HEAD|origin/main": fail("missing origin/main"),
          "HEAD|origin/master": ok("sha-merge-base"),
        },
      }),
    });

    expect(result.strategy).toBe("feature_branch_merge_base");
    expect(result.resolvedSha).toBe("sha-merge-base");
    expect(result.attempts.some((attempt) => attempt.candidate === "HEAD..origin/main")).toBe(true);
    expect(result.attempts.some((attempt) => attempt.candidate === "HEAD..origin/master")).toBe(
      true,
    );
  });

  it("surfaces actionable shallow clone error when merge-base candidates fail", async () => {
    await expect(
      resolveAutoBaseline({
        git: createAdapter({
          currentBranch: ok("feature/a"),
          mergeBase: {
            "HEAD|origin/main": fail("missing origin/main"),
            "HEAD|origin/master": fail("missing origin/master"),
            "HEAD|main": fail("missing main"),
            "HEAD|master": fail("missing master"),
          },
          isShallowRepository: ok("true"),
        }),
      }),
    ).rejects.toThrowError(BaselineAutoResolutionError);

    await expect(
      resolveAutoBaseline({
        git: createAdapter({
          currentBranch: ok("feature/a"),
          mergeBase: {
            "HEAD|origin/main": fail("missing origin/main"),
            "HEAD|origin/master": fail("missing origin/master"),
            "HEAD|main": fail("missing main"),
            "HEAD|master": fail("missing master"),
          },
          isShallowRepository: ok("true"),
        }),
      }),
    ).rejects.toThrowError(/fetch-depth: 0/);
  });

  it("fails with actionable message when auto resolution cannot find any baseline", async () => {
    await expect(
      resolveAutoBaseline({
        git: createAdapter({
          currentBranch: fail("detached"),
          mergeBase: {
            "HEAD|origin/main": fail("missing origin/main"),
            "HEAD|origin/master": fail("missing origin/master"),
            "HEAD|main": fail("missing main"),
            "HEAD|master": fail("missing master"),
          },
          isShallowRepository: ok("false"),
        }),
      }),
    ).rejects.toThrowError(/set --baseline-ref <ref> explicitly/);
  });
});
