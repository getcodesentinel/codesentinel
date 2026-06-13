import { describe, expect, it } from "vitest";
import type { GraphAnalysisSummary } from "@codesentinel/core";
import { enrichEvolutionSummaryWithWorkspaces } from "../application/enrich-evolution-with-workspaces.js";
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
    expect(summary.recentActivity).toHaveLength(DEFAULT_EVOLUTION_CONFIG.recentWindowDays);
    expect(summary.recentActivity?.at(-1)).toEqual({
      bucketStartUtcDate: "2023-11-17",
      commitCount: 1,
      fileTouchCount: 2,
      churnTotal: 6,
      activeAuthorCount: 1,
      volatilityScore: 0.8333,
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
      lastCommitTimestamp: 1_700_200_000,
      topAuthorShareByCommits: 0.6667,
      busFactorByCommits: 1,
      topAuthorShareByChurn: 0.6667,
      busFactorByChurn: 1,
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
    expect(fileA?.authorDistributionByCommits).toEqual([
      {
        authorId: "aleixalonso@hotmail.com",
        commits: 3,
        share: 1,
      },
    ]);
    expect(fileA?.authorDistributionByChurn).toEqual([
      {
        authorId: "aleixalonso@hotmail.com",
        churnAdded: 3,
        churnDeleted: 0,
        churnTotal: 3,
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
    expect(fileA?.authorDistributionByCommits).toEqual([
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
    expect(fileA?.authorDistributionByChurn).toEqual([
      {
        authorId: "aleixalonso@hotmail.com",
        churnAdded: 1,
        churnDeleted: 0,
        churnTotal: 1,
        share: 0.5,
      },
      {
        authorId: "aleixalonso@macbook-pro-de-aleix.local",
        churnAdded: 1,
        churnDeleted: 0,
        churnTotal: 1,
        share: 0.5,
      },
    ]);
  });

  it("enriches evolution summaries with workspace metrics", () => {
    const structural: GraphAnalysisSummary = {
      targetPath: "/repo",
      nodes: [],
      edges: [],
      cycles: [],
      files: [],
      metrics: {
        nodeCount: 0,
        edgeCount: 0,
        cycleCount: 0,
        graphDepth: 0,
        maxFanIn: 0,
        maxFanOut: 0,
      },
      workspaces: [
        {
          name: "@acme/web",
          path: "apps/web",
          kind: "app",
          fileCount: 1,
          internalEdgeCount: 0,
          incomingEdgeCount: 0,
          outgoingEdgeCount: 1,
        },
        {
          name: "@acme/shared",
          path: "packages/shared",
          kind: "package",
          fileCount: 2,
          internalEdgeCount: 1,
          incomingEdgeCount: 1,
          outgoingEdgeCount: 0,
        },
      ],
    };
    const commits: GitCommitRecord[] = [
      {
        hash: "c1",
        authorId: "alice@example.com",
        authorName: "Alice",
        authoredAtUnix: 1_700_000_000,
        fileChanges: [
          { filePath: "apps/web/src/page.ts", additions: 10, deletions: 1 },
          { filePath: "packages/shared/src/index.ts", additions: 5, deletions: 2 },
        ],
      },
      {
        hash: "c2",
        authorId: "bob@example.com",
        authorName: "Bob",
        authoredAtUnix: 1_700_100_000,
        fileChanges: [{ filePath: "packages/shared/src/util.ts", additions: 4, deletions: 4 }],
      },
      {
        hash: "c3",
        authorId: "alice@example.com",
        authorName: "Alice",
        authoredAtUnix: 1_700_200_000,
        fileChanges: [
          { filePath: "apps/web/src/page.ts", additions: 1, deletions: 1 },
          { filePath: "packages/shared/src/util.ts", additions: 3, deletions: 0 },
        ],
      },
    ];

    const summary = computeRepositoryEvolutionSummary("/repo", commits, DEFAULT_EVOLUTION_CONFIG);
    const enriched = enrichEvolutionSummaryWithWorkspaces(structural, summary);

    expect(enriched.available).toBe(true);
    if (!enriched.available) {
      return;
    }

    expect(enriched.workspaces).toEqual([
      {
        name: "@acme/shared",
        path: "packages/shared",
        kind: "package",
        fileCount: 2,
        commitCount: 3,
        churnAdded: 12,
        churnDeleted: 6,
        churnTotal: 18,
        recentCommitCount: 3,
        recentVolatility: 1,
        topAuthorShareByCommits: 1,
        busFactorByCommits: 1,
        hotspotCount: 0,
        topHotspots: [],
        internalCouplingPairCount: 0,
        incomingCouplingPairCount: 2,
        outgoingCouplingPairCount: 0,
      },
      {
        name: "@acme/web",
        path: "apps/web",
        kind: "app",
        fileCount: 1,
        commitCount: 2,
        churnAdded: 11,
        churnDeleted: 2,
        churnTotal: 13,
        recentCommitCount: 2,
        recentVolatility: 1,
        topAuthorShareByCommits: 1,
        busFactorByCommits: 1,
        hotspotCount: 1,
        topHotspots: [
          {
            filePath: "apps/web/src/page.ts",
            rank: 1,
            commitCount: 2,
            churnTotal: 13,
          },
        ],
        internalCouplingPairCount: 0,
        incomingCouplingPairCount: 0,
        outgoingCouplingPairCount: 2,
      },
    ]);
  });

  it("leaves evolution summaries unchanged when structural workspaces are unavailable", () => {
    const structural: GraphAnalysisSummary = {
      targetPath: "/repo",
      nodes: [],
      edges: [],
      cycles: [],
      files: [],
      metrics: {
        nodeCount: 0,
        edgeCount: 0,
        cycleCount: 0,
        graphDepth: 0,
        maxFanIn: 0,
        maxFanOut: 0,
      },
    };
    const summary = computeRepositoryEvolutionSummary(
      "/repo",
      [
        {
          hash: "c1",
          authorId: "alice@example.com",
          authorName: "Alice",
          authoredAtUnix: 1_700_000_000,
          fileChanges: [{ filePath: "src/a.ts", additions: 1, deletions: 0 }],
        },
      ],
      DEFAULT_EVOLUTION_CONFIG,
    );

    expect(enrichEvolutionSummaryWithWorkspaces(structural, summary)).toBe(summary);
  });
});
