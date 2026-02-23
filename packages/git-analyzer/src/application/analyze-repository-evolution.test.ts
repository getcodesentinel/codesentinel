import { describe, expect, it } from "vitest";
import { analyzeRepositoryEvolution } from "./analyze-repository-evolution.js";
import type { GitHistoryProvider } from "./git-history-provider.js";

class StubHistoryProvider implements GitHistoryProvider {
  constructor(
    private readonly isGit: boolean,
    private readonly commits: ReturnType<GitHistoryProvider["getCommitHistory"]>,
  ) {}

  isGitRepository(_repositoryPath: string): boolean {
    return this.isGit;
  }

  getCommitHistory(_repositoryPath: string) {
    return this.commits;
  }
}

describe("analyzeRepositoryEvolution", () => {
  it("returns unavailable summary for non-git directories", () => {
    const summary = analyzeRepositoryEvolution(
      { repositoryPath: "/tmp/not-a-repo" },
      new StubHistoryProvider(false, []),
    );

    expect(summary).toEqual({
      targetPath: "/tmp/not-a-repo",
      available: false,
      reason: "not_git_repository",
    });
  });
});
