import { describe, expect, it } from "vitest";
import { computeRepositoryEvolutionSummary } from "./evolution-metrics.js";
import type { GitCommitRecord } from "./evolution-types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./evolution-types.js";

describe("computeRepositoryEvolutionSummary", () => {
  it("computes frequency, hotspots, coupling, and bus factor deterministically", () => {
    const commits: GitCommitRecord[] = [
      {
        hash: "c1",
        authorId: "alice@example.com",
        authorName: "Alice",
        authoredAtUnix: 1_700_000_000,
        fileChanges: [
          { filePath: "src/a.ts", additions: 10, deletions: 2 },
          { filePath: "src/b.ts", additions: 8, deletions: 1 },
        ],
      },
      {
        hash: "c2",
        authorId: "bob@example.com",
        authorName: "Bob",
        authoredAtUnix: 1_700_100_000,
        fileChanges: [{ filePath: "src/a.ts", additions: 4, deletions: 3 }],
      },
      {
        hash: "c3",
        authorId: "alice@example.com",
        authorName: "Alice",
        authoredAtUnix: 1_700_200_000,
        fileChanges: [
          { filePath: "src/a.ts", additions: 1, deletions: 1 },
          { filePath: "src/b.ts", additions: 2, deletions: 2 },
        ],
      },
    ];

    const summary = computeRepositoryEvolutionSummary("/repo", commits, DEFAULT_EVOLUTION_CONFIG);

    expect(summary.available).toBe(true);
    if (!summary.available) {
      return;
    }

    expect(summary.metrics).toMatchObject({
      totalCommits: 3,
      totalFiles: 2,
      headCommitTimestamp: 1_700_200_000,
    });

    expect(summary.hotspots).toEqual([
      {
        filePath: "src/a.ts",
        rank: 1,
        commitCount: 3,
        churnTotal: 21,
      },
    ]);

    const fileA = summary.files.find((file) => file.filePath === "src/a.ts");
    expect(fileA).toMatchObject({
      commitCount: 3,
      frequencyPer100Commits: 100,
      topAuthorShare: 0.6667,
      busFactor: 1,
    });

    expect(summary.coupling.pairs).toEqual([
      {
        fileA: "src/a.ts",
        fileB: "src/b.ts",
        coChangeCommits: 2,
        couplingScore: 0.6667,
      },
    ]);
  });
});
