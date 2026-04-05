import { describe, expect, it } from "vitest";
import type { AnalyzeSummary, RiskTrace } from "@codesentinel/core";
import {
  compareSnapshots,
  createReport,
  createSnapshot,
  formatReport,
  parseSnapshot,
} from "./index.js";

const analysis = (riskScore: number): AnalyzeSummary => ({
  structural: {
    targetPath: "/repo",
    nodes: [{ id: "src/a.ts", absolutePath: "/repo/src/a.ts", relativePath: "src/a.ts" }],
    edges: [],
    cycles: riskScore > 50 ? [{ nodes: ["src/a.ts", "src/a.ts"] }] : [],
    files: [
      {
        id: "src/a.ts",
        relativePath: "src/a.ts",
        directDependencies: [],
        fanIn: 1,
        fanOut: 0,
        depth: 1,
      },
    ],
    metrics: {
      nodeCount: 1,
      edgeCount: 0,
      cycleCount: riskScore > 50 ? 1 : 0,
      graphDepth: 1,
      maxFanIn: 1,
      maxFanOut: 0,
    },
  },
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
  risk: {
    riskScore,
    normalizedScore: riskScore / 100,
    hotspots: [
      {
        file: "src/a.ts",
        score: riskScore,
        factors: { structural: 0.5, evolution: 0, external: 0 },
      },
    ],
    fragileClusters: [],
    dependencyAmplificationZones: [],
    fileScores: [
      {
        file: "src/a.ts",
        score: riskScore,
        normalizedScore: riskScore / 100,
        factors: { structural: 0.5, evolution: 0, external: 0 },
      },
    ],
    moduleScores: [
      {
        module: "src",
        score: riskScore,
        normalizedScore: riskScore / 100,
        fileCount: 1,
      },
    ],
    dependencyScores: [],
  },
  health: {
    healthScore: Math.max(0, 100 - riskScore),
    normalizedScore: Math.max(0, 1 - riskScore / 100),
    dimensions: {
      modularity: Math.max(0, 100 - riskScore),
      changeHygiene: Math.max(0, 100 - riskScore),
      testHealth: 100,
      ownershipDistribution: Math.max(0, 100 - riskScore),
    },
    topIssues: [],
  },
});

const trace: RiskTrace = {
  schemaVersion: "1",
  contributionTolerance: 0.0001,
  targets: [
    {
      targetType: "repository",
      targetId: "/repo",
      totalScore: 40,
      normalizedScore: 0.4,
      factors: [
        {
          factorId: "repository.structural",
          family: "structural",
          contribution: 20,
          rawMetrics: { structuralDimension: 0.2 },
          normalizedMetrics: {},
          weight: 0.5,
          amplification: null,
          evidence: [{ kind: "repository_metric", metric: "structuralDimension" }],
          confidence: 1,
        },
        {
          factorId: "repository.composite.interactions",
          family: "composite",
          contribution: 20,
          rawMetrics: { structuralEvolution: 0.1 },
          normalizedMetrics: {},
          weight: null,
          amplification: 0.5,
          evidence: [{ kind: "repository_metric", metric: "interactionTerms" }],
          confidence: 0.9,
        },
      ],
      dominantFactors: ["repository.structural", "repository.composite.interactions"],
      reductionLevers: [{ factorId: "repository.structural", estimatedImpact: 20 }],
    },
    {
      targetType: "file",
      targetId: "src/a.ts",
      totalScore: 40,
      normalizedScore: 0.4,
      factors: [
        {
          factorId: "file.structural",
          family: "structural",
          contribution: 40,
          rawMetrics: { fanIn: 1, fanOut: 0, depth: 1 },
          normalizedMetrics: {},
          weight: 1,
          amplification: null,
          evidence: [{ kind: "file_metric", target: "src/a.ts", metric: "fanIn" }],
          confidence: 1,
        },
      ],
      dominantFactors: ["file.structural"],
      reductionLevers: [{ factorId: "file.structural", estimatedImpact: 40 }],
    },
  ],
};

describe("reporter", () => {
  it("creates, parses, diffs and formats deterministic reports", () => {
    const baseline = createSnapshot({
      analysis: analysis(30),
      trace,
      generatedAt: "2026-03-01T00:00:00.000Z",
    });
    const current = createSnapshot({
      analysis: analysis(45),
      trace,
      generatedAt: "2026-03-01T00:00:01.000Z",
    });

    const parsed = parseSnapshot(JSON.stringify(baseline));
    expect(parsed.schemaVersion).toBe(baseline.schemaVersion);

    const diff = compareSnapshots(current, baseline);
    expect(diff.riskScoreDelta).toBe(15);

    const report = createReport(current, diff);
    const text = formatReport(report, "text");
    const md = formatReport(report, "md");
    const json = formatReport(report, "json");

    expect(text).toContain("Repository Summary");
    expect(text).toContain("Dimension Scores (0-100)");
    expect(text).toContain("Health Summary");
    expect(text).toContain("structural: 20");
    expect(text).toContain("priority actions:");
    expect(text).not.toContain("levers:");
    expect(md).toContain("## Repository Summary");
    expect(md).toContain("## Dimension Scores (0-100)");
    expect(md).toContain("## Health Summary");
    expect(md).toContain("- structural: `20`");
    expect(md).toContain("- Priority actions:");
    expect(md).not.toContain("- Biggest levers:");
    expect(json).toContain('"schemaVersion": "codesentinel.report.v1"');
    expect(json).toContain('"dimensionScores"');
    expect(json).toContain('"health"');
    expect(report.repository.name).toBe("repo");
    expect(report.hotspots[0]?.rank).toBe(1);
    expect(report.hotspots[0]?.module).toBe("src");
    expect(report.structural.fanInOutExtremes.highestFanIn[0]?.file).toBe("src/a.ts");
    expect(report.structural.cycleDetails).toHaveLength(0);
  });

  it("includes hotspot ownership and volatility details when evolution data is available", () => {
    const snapshot = createSnapshot({
      analysis: {
        ...analysis(45),
        evolution: {
          targetPath: "/repo",
          available: true,
          files: [
            {
              filePath: "src/a.ts",
              commitCount: 12,
              frequencyPer100Commits: 0.12,
              churnAdded: 40,
              churnDeleted: 20,
              churnTotal: 60,
              recentCommitCount: 5,
              recentVolatility: 0.42,
              topAuthorShareByCommits: 0.75,
              busFactorByCommits: 1,
              authorDistributionByCommits: [
                { authorId: "alice@example.com", commits: 9, share: 0.75 },
                { authorId: "bob@example.com", commits: 3, share: 0.25 },
              ],
              topAuthorShareByChurn: 0.8,
              busFactorByChurn: 1,
              authorDistributionByChurn: [
                {
                  authorId: "alice@example.com",
                  churnAdded: 32,
                  churnDeleted: 16,
                  churnTotal: 48,
                  share: 0.8,
                },
                {
                  authorId: "bob@example.com",
                  churnAdded: 8,
                  churnDeleted: 4,
                  churnTotal: 12,
                  share: 0.2,
                },
              ],
            },
          ],
          hotspots: [{ filePath: "src/a.ts", rank: 1, commitCount: 12, churnTotal: 60 }],
          coupling: {
            pairs: [],
            totalPairCount: 0,
            consideredCommits: 12,
            skippedLargeCommits: 0,
            truncated: false,
          },
          metrics: {
            totalCommits: 12,
            totalFiles: 1,
            headCommitTimestamp: 1_700_000_000,
            recentWindowDays: 30,
            hotspotTopPercent: 0.1,
            hotspotThresholdCommitCount: 1,
          },
        },
      },
      trace,
      generatedAt: "2026-03-01T00:00:02.000Z",
    });

    const report = createReport(snapshot);
    expect(report.hotspots[0]?.ownerCount).toBe(2);
    expect(report.hotspots[0]?.recentVolatility).toBe(0.42);
    expect(report.hotspots[0]?.topAuthorShareByCommits).toBe(0.75);
    expect(report.hotspots[0]?.authorDistributionByCommits).toHaveLength(2);
  });
});
