import type { GraphAnalysisSummary, RepositoryEvolutionSummary } from "@codesentinel/core";
import { describe, expect, it } from "vitest";
import { computeRepositoryHealthSummary } from "./compute-repository-health-summary.js";

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

describe("computeRepositoryHealthSummary", () => {
  it("is deterministic and bounded", () => {
    const first = computeRepositoryHealthSummary({
      structural,
      evolution,
      signals: {
        todoFixmeCommentCount: 35,
      },
    });
    const second = computeRepositoryHealthSummary({
      structural,
      evolution,
      signals: {
        todoFixmeCommentCount: 35,
      },
    });

    expect(first).toEqual(second);
    expect(first.healthScore).toBeGreaterThanOrEqual(0);
    expect(first.healthScore).toBeLessThanOrEqual(100);
    expect(first.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(first.normalizedScore).toBeLessThanOrEqual(1);
    expect(first.dimensions.modularity).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.modularity).toBeLessThanOrEqual(100);
    expect(first.dimensions.changeHygiene).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.changeHygiene).toBeLessThanOrEqual(100);
    expect(first.dimensions.staticAnalysis).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.staticAnalysis).toBeLessThanOrEqual(100);
    expect(first.dimensions.complexity).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.complexity).toBeLessThanOrEqual(100);
    expect(first.dimensions.duplication).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.duplication).toBeLessThanOrEqual(100);
    expect(first.dimensions.testHealth).toBeGreaterThanOrEqual(0);
    expect(first.dimensions.testHealth).toBeLessThanOrEqual(100);
    expect(first.trace?.schemaVersion).toBe("1");
    expect(first.trace?.dimensions.length).toBe(6);
  });

  it("produces actionable top issues for the strongest penalties", () => {
    const summary = computeRepositoryHealthSummary({
      structural,
      evolution,
      signals: {
        todoFixmeCommentCount: 12,
        eslint: {
          errorCount: 3,
          warningCount: 10,
          filesWithIssues: 2,
          ruleCounts: [{ ruleId: "no-unused-vars", severity: "error", count: 2 }],
        },
        typescript: {
          errorCount: 1,
          warningCount: 0,
          filesWithDiagnostics: 1,
        },
      },
    });

    const issueIds = summary.topIssues.map((issue) => issue.id);
    expect(issueIds).toContain("health.modularity.structural_cycles");
    expect(issueIds).toContain("health.change_hygiene.churn_concentration");
    expect(issueIds).toContain("health.test_health.low_test_presence");
    expect(issueIds).toContain("health.static_analysis.eslint_errors");
    expect(summary.topIssues.some((issue) => issue.ruleId !== undefined)).toBe(true);
  });

  it("degrades gracefully when git evolution is unavailable", () => {
    const summary = computeRepositoryHealthSummary({
      structural,
      evolution: {
        targetPath: "/repo",
        available: false,
        reason: "not_git_repository",
      },
    });

    expect(summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(summary.healthScore).toBeLessThanOrEqual(100);
    expect(summary.dimensions.changeHygiene).toBeGreaterThan(0);
  });

  it("ignores non-structural files for churn and coupling issue targets", () => {
    const summary = computeRepositoryHealthSummary({
      structural,
      evolution: {
        ...evolution,
        files: [
          ...evolution.files,
          {
            filePath: "package-lock.json",
            commitCount: 100,
            frequencyPer100Commits: 90,
            churnAdded: 20000,
            churnDeleted: 10000,
            churnTotal: 30000,
            recentCommitCount: 40,
            recentVolatility: 1,
            topAuthorShare: 1,
            busFactor: 1,
            authorDistribution: [{ authorId: "bot", commits: 100, share: 1 }],
          },
          {
            filePath: "package.json",
            commitCount: 80,
            frequencyPer100Commits: 70,
            churnAdded: 2000,
            churnDeleted: 1000,
            churnTotal: 3000,
            recentCommitCount: 30,
            recentVolatility: 1,
            topAuthorShare: 1,
            busFactor: 1,
            authorDistribution: [{ authorId: "bot", commits: 80, share: 1 }],
          },
        ],
        coupling: {
          ...evolution.coupling,
          pairs: [
            ...evolution.coupling.pairs,
            {
              fileA: "package-lock.json",
              fileB: "package.json",
              coChangeCommits: 60,
              couplingScore: 0.99,
            },
          ],
          totalPairCount: evolution.coupling.totalPairCount + 1,
        },
      },
    });

    const targets = summary.topIssues.map((issue) => issue.target);
    expect(targets.some((target) => target.includes("package-lock.json"))).toBe(false);
    expect(targets.some((target) => target.includes("package.json"))).toBe(false);
  });

  it("calibrates higher for clean profile than noisy profile", () => {
    const clean = computeRepositoryHealthSummary({
      structural,
      evolution,
      signals: {
        eslint: { errorCount: 0, warningCount: 0, filesWithIssues: 0, ruleCounts: [] },
        typescript: { errorCount: 0, warningCount: 0, filesWithDiagnostics: 0 },
        complexity: {
          averageCyclomatic: 3.2,
          maxCyclomatic: 8,
          highComplexityFileCount: 0,
          analyzedFileCount: 4,
        },
        duplication: {
          mode: "exact-token",
          duplicatedLineRatio: 0.01,
          duplicatedBlockCount: 2,
          filesWithDuplication: 1,
        },
        coverage: {
          lineCoverage: 0.82,
          branchCoverage: 0.75,
          functionCoverage: 0.84,
          statementCoverage: 0.8,
        },
        todoFixmeCommentCount: 0,
      },
    });

    const noisy = computeRepositoryHealthSummary({
      structural,
      evolution,
      signals: {
        eslint: {
          errorCount: 25,
          warningCount: 48,
          filesWithIssues: 4,
          ruleCounts: [{ ruleId: "no-explicit-any", severity: "error", count: 10 }],
        },
        typescript: { errorCount: 11, warningCount: 8, filesWithDiagnostics: 4 },
        complexity: {
          averageCyclomatic: 18,
          maxCyclomatic: 47,
          highComplexityFileCount: 3,
          analyzedFileCount: 4,
        },
        duplication: {
          mode: "exact-token",
          duplicatedLineRatio: 0.23,
          duplicatedBlockCount: 90,
          filesWithDuplication: 4,
        },
        coverage: {
          lineCoverage: 0.4,
          branchCoverage: 0.2,
          functionCoverage: 0.45,
          statementCoverage: 0.38,
        },
        todoFixmeCommentCount: 55,
      },
    });

    expect(clean.healthScore).toBeGreaterThan(noisy.healthScore);
    expect(clean.topIssues.length).toBeLessThan(noisy.topIssues.length);
  });
});
