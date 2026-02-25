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

  it("merges likely same author across different emails by default", () => {
    const commits: GitCommitRecord[] = [
      {
        hash: "c1",
        authorId: "aleixalonso@hotmail.com",
        authorName: "Aleix Alonso",
        authoredAtUnix: 1_700_000_000,
        fileChanges: [{ filePath: "src/a.ts", additions: 1, deletions: 0 }],
      },
      {
        hash: "c2",
        authorId: "aleixalonso@macbook-pro-de-aleix.local",
        authorName: "Aleix",
        authoredAtUnix: 1_700_001_000,
        fileChanges: [{ filePath: "src/a.ts", additions: 1, deletions: 0 }],
      },
      {
        hash: "c3",
        authorId: "64553911+aleixalonso@users.noreply.github.com",
        authorName: "Aleix Alonso",
        authoredAtUnix: 1_700_002_000,
        fileChanges: [{ filePath: "src/a.ts", additions: 1, deletions: 0 }],
      },
    ];

    const summary = computeRepositoryEvolutionSummary("/repo", commits, DEFAULT_EVOLUTION_CONFIG);
    if (!summary.available) {
      return;
    }

    const fileA = summary.files.find((file) => file.filePath === "src/a.ts");
    expect(fileA?.authorDistribution).toEqual([
      {
        authorId: "aleixalonso@hotmail.com",
        commits: 3,
        share: 1,
      },
    ]);
  });

  it("keeps different emails separate in strict_email mode", () => {
    const commits: GitCommitRecord[] = [
      {
        hash: "c1",
        authorId: "aleixalonso@hotmail.com",
        authorName: "Aleix Alonso",
        authoredAtUnix: 1_700_000_000,
        fileChanges: [{ filePath: "src/a.ts", additions: 1, deletions: 0 }],
      },
      {
        hash: "c2",
        authorId: "aleixalonso@macbook-pro-de-aleix.local",
        authorName: "Aleix",
        authoredAtUnix: 1_700_001_000,
        fileChanges: [{ filePath: "src/a.ts", additions: 1, deletions: 0 }],
      },
    ];

    const summary = computeRepositoryEvolutionSummary("/repo", commits, {
      ...DEFAULT_EVOLUTION_CONFIG,
      authorIdentityMode: "strict_email",
    });
    if (!summary.available) {
      return;
    }

    const fileA = summary.files.find((file) => file.filePath === "src/a.ts");
    expect(fileA?.authorDistribution).toEqual([
      {
        authorId: "aleixalonso@hotmail.com",
        commits: 1,
        share: 0.5,
      },
      {
        authorId: "aleixalonso@macbook-pro-de-aleix.local",
        commits: 1,
        share: 0.5,
      },
    ]);
  });
});
