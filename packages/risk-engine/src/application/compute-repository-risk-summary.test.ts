import type {
  ExternalAnalysisSummary,
  GraphAnalysisSummary,
  RepositoryEvolutionSummary,
} from "@codesentinel/core";
import { describe, expect, it } from "vitest";
import { computeRepositoryRiskSummary } from "./compute-repository-risk-summary.js";

const structuralSummary: GraphAnalysisSummary = {
  targetPath: "/repo",
  nodes: [
    {
      id: "src/a.ts",
      absolutePath: "/repo/src/a.ts",
      relativePath: "src/a.ts",
    },
    {
      id: "src/b.ts",
      absolutePath: "/repo/src/b.ts",
      relativePath: "src/b.ts",
    },
    {
      id: "src/c.ts",
      absolutePath: "/repo/src/c.ts",
      relativePath: "src/c.ts",
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
      fanIn: 2,
      fanOut: 2,
      depth: 1,
    },
    {
      id: "src/b.ts",
      relativePath: "src/b.ts",
      directDependencies: ["src/a.ts"],
      fanIn: 1,
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
  ],
  metrics: {
    nodeCount: 3,
    edgeCount: 3,
    cycleCount: 1,
    graphDepth: 2,
    maxFanIn: 2,
    maxFanOut: 2,
  },
};

const evolutionSummary: RepositoryEvolutionSummary = {
  targetPath: "/repo",
  available: true,
  files: [
    {
      filePath: "src/a.ts",
      commitCount: 24,
      frequencyPer100Commits: 60,
      churnAdded: 300,
      churnDeleted: 220,
      churnTotal: 520,
      recentCommitCount: 12,
      recentVolatility: 0.5,
      topAuthorShare: 0.78,
      busFactor: 1,
      authorDistribution: [
        { authorId: "alice@example.com", commits: 18, share: 0.75 },
        { authorId: "bob@example.com", commits: 6, share: 0.25 },
      ],
    },
    {
      filePath: "src/b.ts",
      commitCount: 14,
      frequencyPer100Commits: 35,
      churnAdded: 160,
      churnDeleted: 100,
      churnTotal: 260,
      recentCommitCount: 4,
      recentVolatility: 0.2857,
      topAuthorShare: 0.85,
      busFactor: 1,
      authorDistribution: [{ authorId: "alice@example.com", commits: 14, share: 1 }],
    },
    {
      filePath: "src/c.ts",
      commitCount: 5,
      frequencyPer100Commits: 12.5,
      churnAdded: 30,
      churnDeleted: 20,
      churnTotal: 50,
      recentCommitCount: 1,
      recentVolatility: 0.2,
      topAuthorShare: 0.4,
      busFactor: 2,
      authorDistribution: [
        { authorId: "alice@example.com", commits: 2, share: 0.4 },
        { authorId: "carol@example.com", commits: 2, share: 0.4 },
        { authorId: "dan@example.com", commits: 1, share: 0.2 },
      ],
    },
  ],
  hotspots: [{ filePath: "src/a.ts", rank: 1, commitCount: 24, churnTotal: 520 }],
  coupling: {
    pairs: [
      {
        fileA: "src/a.ts",
        fileB: "src/b.ts",
        coChangeCommits: 10,
        couplingScore: 0.72,
      },
      {
        fileA: "src/a.ts",
        fileB: "src/c.ts",
        coChangeCommits: 2,
        couplingScore: 0.2,
      },
    ],
    totalPairCount: 2,
    consideredCommits: 18,
    skippedLargeCommits: 0,
    truncated: false,
  },
  metrics: {
    totalCommits: 40,
    totalFiles: 3,
    headCommitTimestamp: 1_720_000_000,
    recentWindowDays: 30,
    hotspotTopPercent: 0.1,
    hotspotThresholdCommitCount: 24,
  },
};

const externalSummary: ExternalAnalysisSummary = {
  targetPath: "/repo",
  available: true,
  metrics: {
    totalDependencies: 12,
    directDependencies: 3,
    transitiveDependencies: 9,
    dependencyDepth: 5,
    lockfileKind: "pnpm",
    metadataCoverage: 1,
  },
  dependencies: [
    {
      name: "react",
      direct: true,
      requestedRange: "^19.0.0",
      resolvedVersion: "19.1.0",
      transitiveDependencies: ["scheduler", "loose-envify"],
      weeklyDownloads: 12000000,
      dependencyDepth: 2,
      fanOut: 2,
      dependents: 10,
      maintainerCount: 4,
      releaseFrequencyDays: 30,
      daysSinceLastRelease: 28,
      repositoryActivity30d: 12,
      busFactor: 2,
      ownRiskSignals: ["high_centrality"],
      inheritedRiskSignals: [],
      riskSignals: ["high_centrality"],
    },
    {
      name: "left-pad-legacy",
      direct: true,
      requestedRange: "^1.0.0",
      resolvedVersion: "1.0.1",
      transitiveDependencies: ["micro-util", "legacy-core", "legacy-types"],
      weeklyDownloads: 3200,
      dependencyDepth: 4,
      fanOut: 3,
      dependents: 2,
      maintainerCount: 1,
      releaseFrequencyDays: 280,
      daysSinceLastRelease: 900,
      repositoryActivity30d: 0,
      busFactor: 1,
      ownRiskSignals: ["single_maintainer", "abandoned"],
      inheritedRiskSignals: ["deep_chain", "high_fanout"],
      riskSignals: ["single_maintainer", "abandoned", "deep_chain", "high_fanout"],
    },
    {
      name: "zod",
      direct: true,
      requestedRange: "^4.0.0",
      resolvedVersion: "4.0.0",
      transitiveDependencies: [],
      weeklyDownloads: 4300000,
      dependencyDepth: 1,
      fanOut: 0,
      dependents: 5,
      maintainerCount: 3,
      releaseFrequencyDays: 40,
      daysSinceLastRelease: 40,
      repositoryActivity30d: 8,
      busFactor: 2,
      ownRiskSignals: [],
      inheritedRiskSignals: [],
      riskSignals: [],
    },
  ],
  highRiskDependencies: ["left-pad-legacy"],
  transitiveExposureDependencies: ["left-pad-legacy"],
  singleMaintainerDependencies: ["left-pad-legacy"],
  abandonedDependencies: ["left-pad-legacy"],
  centralityRanking: [
    { name: "react", dependents: 10, fanOut: 2, direct: true },
    { name: "zod", dependents: 5, fanOut: 0, direct: true },
  ],
};

describe("computeRepositoryRiskSummary", () => {
  it("combines dimensions into deterministic repository and hotspot scores", () => {
    const first = computeRepositoryRiskSummary({
      structural: structuralSummary,
      evolution: evolutionSummary,
      external: externalSummary,
    });

    const second = computeRepositoryRiskSummary({
      structural: structuralSummary,
      evolution: evolutionSummary,
      external: externalSummary,
    });

    expect(second).toEqual(first);
    expect(first.repositoryScore).toBeGreaterThan(0);
    expect(first.normalizedScore).toBeGreaterThan(0);
    expect(first.hotspots[0]?.file).toBe("src/a.ts");
    expect(first.fragileClusters.some((cluster) => cluster.kind === "structural_cycle")).toBe(true);
    expect(first.fragileClusters.some((cluster) => cluster.kind === "change_coupling")).toBe(true);
    expect(first.dependencyScores[0]?.dependency).toBe("left-pad-legacy");
  });

  it("degrades gracefully when git and external data are unavailable", () => {
    const summary = computeRepositoryRiskSummary({
      structural: structuralSummary,
      evolution: {
        targetPath: "/repo",
        available: false,
        reason: "not_git_repository",
      },
      external: {
        targetPath: "/repo",
        available: false,
        reason: "lockfile_not_found",
      },
    });

    expect(summary.repositoryScore).toBeGreaterThan(0);
    expect(summary.fileScores.every((file) => file.factors.evolution === 0)).toBe(true);
    expect(summary.fileScores.every((file) => file.factors.external === 0)).toBe(true);
    expect(summary.dependencyScores).toEqual([]);
    expect(summary.dependencyAmplificationZones).toEqual([]);
  });

  it("identifies dependency amplification zones under high external pressure", () => {
    const summary = computeRepositoryRiskSummary({
      structural: structuralSummary,
      evolution: evolutionSummary,
      external: externalSummary,
    });

    expect(summary.dependencyAmplificationZones.length).toBeGreaterThan(0);
    expect(summary.dependencyAmplificationZones[0]?.file).toBe("src/a.ts");
    expect(summary.dependencyAmplificationZones[0]?.externalPressure).toBeGreaterThan(0);
  });
});
