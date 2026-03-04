import type { GraphAnalysisSummary, RepositoryEvolutionSummary } from "@codesentinel/core";
import { describe, expect, it } from "vitest";
import { computeRepositoryQualitySummary } from "./compute-repository-quality-summary.js";

const structural: GraphAnalysisSummary = {
  targetPath: "/repo",
  nodes: [
    { id: "src/a.ts", absolutePath: "/repo/src/a.ts", relativePath: "src/a.ts" },
    { id: "src/b.ts", absolutePath: "/repo/src/b.ts", relativePath: "src/b.ts" },
    { id: "src/c.ts", absolutePath: "/repo/src/c.ts", relativePath: "src/c.ts" },
    {
      id: "src/helper.ts",
      absolutePath: "/repo/src/helper.ts",
      relativePath: "src/helper.ts",
    },
  ],
  edges: [
    { from: "src/a.ts", to: "src/b.ts" },
    { from: "src/b.ts", to: "src/a.ts" },
    { from: "src/a.ts", to: "src/c.ts" },
  ],
  cycles: [{ nodes: ["src/a.ts", "src/b.ts"] }],
  files: [
    {
      id: "src/a.ts",
      relativePath: "src/a.ts",
      directDependencies: ["src/b.ts", "src/c.ts"],
      fanIn: 15,
      fanOut: 13,
      depth: 1,
    },
    {
      id: "src/b.ts",
      relativePath: "src/b.ts",
      directDependencies: ["src/a.ts"],
      fanIn: 2,
      fanOut: 1,
      depth: 1,
    },
    {
      id: "src/c.ts",
      relativePath: "src/c.ts",
      directDependencies: [],
      fanIn: 1,
      fanOut: 0,
      depth: 2,
    },
    {
      id: "src/helper.ts",
      relativePath: "src/helper.ts",
      directDependencies: ["src/a.ts"],
      fanIn: 0,
      fanOut: 1,
      depth: 1,
    },
  ],
  metrics: {
    nodeCount: 4,
    edgeCount: 3,
    cycleCount: 1,
    graphDepth: 2,
    maxFanIn: 15,
    maxFanOut: 13,
  },
};

const evolution: RepositoryEvolutionSummary = {
  targetPath: "/repo",
  available: true,
  files: [
    {
      filePath: "src/a.ts",
      commitCount: 30,
      frequencyPer100Commits: 55,
      churnAdded: 450,
      churnDeleted: 260,
      churnTotal: 710,
      recentCommitCount: 14,
      recentVolatility: 0.6,
      topAuthorShare: 0.8,
      busFactor: 1,
      authorDistribution: [
        { authorId: "dev1", commits: 24, share: 0.8 },
        { authorId: "dev2", commits: 6, share: 0.2 },
      ],
    },
    {
      filePath: "src/b.ts",
      commitCount: 9,
      frequencyPer100Commits: 16,
      churnAdded: 60,
      churnDeleted: 30,
      churnTotal: 90,
      recentCommitCount: 2,
      recentVolatility: 0.2,
      topAuthorShare: 0.7,
      busFactor: 1,
      authorDistribution: [{ authorId: "dev1", commits: 9, share: 1 }],
    },
    {
      filePath: "src/c.ts",
      commitCount: 5,
      frequencyPer100Commits: 9,
      churnAdded: 20,
      churnDeleted: 10,
      churnTotal: 30,
      recentCommitCount: 1,
      recentVolatility: 0.2,
      topAuthorShare: 0.6,
      busFactor: 1,
      authorDistribution: [{ authorId: "dev2", commits: 5, share: 1 }],
    },
  ],
  hotspots: [{ filePath: "src/a.ts", rank: 1, commitCount: 30, churnTotal: 710 }],
  coupling: {
    pairs: [
      { fileA: "src/a.ts", fileB: "src/b.ts", coChangeCommits: 11, couplingScore: 0.74 },
      { fileA: "src/a.ts", fileB: "src/c.ts", coChangeCommits: 6, couplingScore: 0.55 },
    ],
    totalPairCount: 2,
    consideredCommits: 30,
    skippedLargeCommits: 0,
    truncated: false,
  },
  metrics: {
    totalCommits: 54,
    totalFiles: 3,
    headCommitTimestamp: 1_720_000_000,
    recentWindowDays: 30,
    hotspotTopPercent: 0.1,
    hotspotThresholdCommitCount: 30,
  },
};

describe("computeRepositoryQualitySummary", () => {
  it("is deterministic and bounded", () => {
    const first = computeRepositoryQualitySummary({ structural, evolution, todoFixmeCount: 35 });
    const second = computeRepositoryQualitySummary({ structural, evolution, todoFixmeCount: 35 });

    expect(first).toEqual(second);
    expect(first.qualityScore).toBeGreaterThanOrEqual(0);
    expect(first.qualityScore).toBeLessThanOrEqual(100);
    expect(first.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(first.normalizedScore).toBeLessThanOrEqual(1);
    expect(first.dimensions.modularity).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.modularity).toBeLessThanOrEqual(100);
    expect(first.dimensions.changeHygiene).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.changeHygiene).toBeLessThanOrEqual(100);
    expect(first.dimensions.testHealth).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.testHealth).toBeLessThanOrEqual(100);
  });

  it("produces actionable top issues for the strongest penalties", () => {
    const summary = computeRepositoryQualitySummary({ structural, evolution, todoFixmeCount: 12 });

    const issueIds = summary.topIssues.map((issue) => issue.id);
    expect(issueIds).toContain("quality.modularity.structural_cycles");
    expect(issueIds).toContain("quality.change_hygiene.churn_concentration");
    expect(issueIds).toContain("quality.test_health.low_test_presence");
  });

  it("degrades gracefully when git evolution is unavailable", () => {
    const summary = computeRepositoryQualitySummary({
      structural,
      evolution: {
        targetPath: "/repo",
        available: false,
        reason: "not_git_repository",
      },
    });

    expect(summary.qualityScore).toBeGreaterThanOrEqual(0);
    expect(summary.qualityScore).toBeLessThanOrEqual(100);
    expect(summary.dimensions.changeHygiene).toBeGreaterThan(0);
  });
});
