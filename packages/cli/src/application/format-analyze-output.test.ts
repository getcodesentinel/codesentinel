import { describe, expect, it } from "vitest";
import type { AnalyzeSummary } from "@codesentinel/core";
import { formatAnalyzeOutput } from "./format-analyze-output.js";

const summary = (): AnalyzeSummary => ({
  structural: {
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
        name: "@repo/web",
        path: "apps/web",
        kind: "app",
        fileCount: 12,
        internalEdgeCount: 18,
        incomingEdgeCount: 2,
        outgoingEdgeCount: 7,
      },
    ],
    crossWorkspaceEdges: [],
  },
  evolution: {
    targetPath: "/repo",
    available: true,
    files: [],
    hotspots: [],
    coupling: {
      pairs: [],
      totalPairCount: 0,
      consideredCommits: 0,
      skippedLargeCommits: 0,
      truncated: false,
    },
    workspaces: [
      {
        name: "@repo/web",
        path: "apps/web",
        kind: "app",
        fileCount: 12,
        commitCount: 20,
        churnAdded: 80,
        churnDeleted: 30,
        churnTotal: 110,
        recentCommitCount: 6,
        recentVolatility: 0.4,
        topAuthorShareByCommits: 0.7,
        busFactorByCommits: 2,
        hotspotCount: 1,
        topHotspots: [],
        internalCouplingPairCount: 3,
        incomingCouplingPairCount: 1,
        outgoingCouplingPairCount: 2,
      },
    ],
    metrics: {
      totalCommits: 20,
      totalFiles: 12,
      headCommitTimestamp: null,
      recentWindowDays: 30,
      hotspotTopPercent: 0.1,
      hotspotThresholdCommitCount: 1,
    },
  },
  external: {
    targetPath: "/repo",
    available: true,
    metrics: {
      totalDependencies: 10,
      directDependencies: 3,
      directProductionDependencies: 2,
      directDevelopmentDependencies: 1,
      transitiveDependencies: 7,
      dependencyDepth: 3,
      lockfileKind: "pnpm",
      metadataCoverage: 0.5,
    },
    dependencies: [],
    workspaces: [
      {
        name: "@repo/web",
        path: "apps/web",
        kind: "app",
        directDependencies: 3,
        directProductionDependencies: 2,
        directDevelopmentDependencies: 1,
        unresolvedDependencies: [],
        dependencyNames: ["react", "zod", "eslint"],
        sharedDependencies: ["react"],
        highRiskDependencies: ["zod"],
        highRiskDevelopmentDependencies: [],
        transitiveExposureDependencies: ["zod"],
        singleMaintainerDependencies: [],
        abandonedDependencies: [],
      },
    ],
    highRiskDependencies: ["zod"],
    highRiskDevelopmentDependencies: [],
    transitiveExposureDependencies: ["zod"],
    singleMaintainerDependencies: [],
    abandonedDependencies: [],
    centralityRanking: [],
  },
  risk: {
    riskScore: 42,
    normalizedScore: 0.42,
    hotspots: [],
    fragileClusters: [],
    dependencyAmplificationZones: [],
    fileScores: [],
    moduleScores: [],
    workspaceScores: [
      {
        name: "@repo/web",
        path: "apps/web",
        kind: "app",
        score: 64,
        normalizedScore: 0.64,
        fileCount: 12,
        averageFileRisk: 28,
        peakFileRisk: 91,
        internalEdgeCount: 18,
        incomingEdgeCount: 2,
        outgoingEdgeCount: 7,
        topFiles: [
          {
            file: "apps/web/page.tsx",
            score: 91,
            factors: { structural: 1, evolution: 0, external: 0 },
          },
        ],
      },
    ],
    dependencyScores: [],
  },
  health: {
    healthScore: 70,
    normalizedScore: 0.7,
    dimensions: {
      modularity: 70,
      changeHygiene: 70,
      testHealth: 70,
      ownershipDistribution: 70,
    },
    topIssues: [],
  },
});

describe("formatAnalyzeOutput", () => {
  it("includes workspace summaries in compact summary output", () => {
    const output = JSON.parse(formatAnalyzeOutput(summary(), "summary")) as {
      workspaces: {
        structuralTop: readonly unknown[];
        riskTop: ReadonlyArray<{ path: string; score: number; peakFileRisk: number }>;
        evolutionTop: ReadonlyArray<{ path: string; churnTotal: number }>;
        dependencyExposureTop: ReadonlyArray<{
          path: string;
          sharedDependencies: number;
          highRiskDependencies: number;
        }>;
      };
    };

    expect(output.workspaces.structuralTop).toHaveLength(1);
    expect(output.workspaces.riskTop[0]).toEqual({
      path: "apps/web",
      score: 64,
      fileCount: 12,
      peakFileRisk: 91,
    });
    expect(output.workspaces.evolutionTop[0]).toMatchObject({
      path: "apps/web",
      churnTotal: 110,
    });
    expect(output.workspaces.dependencyExposureTop[0]).toMatchObject({
      path: "apps/web",
      sharedDependencies: 1,
      highRiskDependencies: 1,
    });
  });
});
