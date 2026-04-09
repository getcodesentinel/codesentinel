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

type EvolutionFile = Extract<AnalyzeSummary["evolution"], { available: true }>["files"][number];

const evolutionFile = (
  filePath: string,
  commitCount: number,
  authors: readonly { authorId: string; commits: number }[],
): EvolutionFile => {
  const totalCommits = authors.reduce((sum, author) => sum + author.commits, 0);
  const authorDistributionByCommits = authors.map((author) => ({
    ...author,
    share: totalCommits <= 0 ? 0 : Number((author.commits / totalCommits).toFixed(4)),
  }));
  const topAuthorShareByCommits = authorDistributionByCommits[0]?.share ?? 0;

  return {
    filePath,
    commitCount,
    frequencyPer100Commits: commitCount / 100,
    churnAdded: commitCount,
    churnDeleted: 0,
    churnTotal: commitCount,
    lastCommitTimestamp: 1_700_000_000,
    recentCommitCount: 0,
    recentVolatility: 0,
    topAuthorShareByCommits,
    busFactorByCommits: Math.max(1, authors.length),
    authorDistributionByCommits,
    topAuthorShareByChurn: topAuthorShareByCommits,
    busFactorByChurn: Math.max(1, authors.length),
    authorDistributionByChurn: authorDistributionByCommits.map((author) => ({
      authorId: author.authorId,
      churnAdded: author.commits,
      churnDeleted: 0,
      churnTotal: author.commits,
      share: author.share,
    })),
  };
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
    expect(diff.baselineGeneratedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(diff.riskScoreDelta).toBe(15);
    expect(diff.externalDimensionDelta).toBeNull();

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
    expect(report.structural.metrics.edgeCount).toBe(0);
    expect(report.structural.metrics.entryPointCount).toBe(0);
    expect(report.structural.metrics.couplingDensity).toBe(0);
    expect(report.structural.moduleAnatomy).toEqual([
      {
        module: "src",
        dependencyCount: 0,
        fanIn: 1,
        fanOut: 0,
        depth: 1,
      },
    ]);
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
              lastCommitTimestamp: 1_700_000_000,
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
            {
              filePath: "src/shared.ts",
              commitCount: 10,
              frequencyPer100Commits: 0.1,
              churnAdded: 20,
              churnDeleted: 10,
              churnTotal: 30,
              lastCommitTimestamp: 1_700_000_000,
              recentCommitCount: 3,
              recentVolatility: 0.3,
              topAuthorShareByCommits: 0.5,
              busFactorByCommits: 2,
              authorDistributionByCommits: [
                { authorId: "alice@example.com", commits: 5, share: 0.5 },
                { authorId: "bob@example.com", commits: 5, share: 0.5 },
              ],
              topAuthorShareByChurn: 0.6667,
              busFactorByChurn: 2,
              authorDistributionByChurn: [
                {
                  authorId: "alice@example.com",
                  churnAdded: 12,
                  churnDeleted: 8,
                  churnTotal: 20,
                  share: 0.6667,
                },
                {
                  authorId: "bob@example.com",
                  churnAdded: 8,
                  churnDeleted: 2,
                  churnTotal: 10,
                  share: 0.3333,
                },
              ],
            },
            {
              filePath: "src/single.ts",
              commitCount: 4,
              frequencyPer100Commits: 0.04,
              churnAdded: 10,
              churnDeleted: 5,
              churnTotal: 15,
              lastCommitTimestamp: 1_700_000_000,
              recentCommitCount: 1,
              recentVolatility: 0.25,
              topAuthorShareByCommits: 1,
              busFactorByCommits: 1,
              authorDistributionByCommits: [
                { authorId: "carol@example.com", commits: 4, share: 1 },
              ],
              topAuthorShareByChurn: 1,
              busFactorByChurn: 1,
              authorDistributionByChurn: [
                {
                  authorId: "carol@example.com",
                  churnAdded: 10,
                  churnDeleted: 5,
                  churnTotal: 15,
                  share: 1,
                },
              ],
            },
          ],
          hotspots: [{ filePath: "src/a.ts", rank: 1, commitCount: 12, churnTotal: 60 }],
          coupling: {
            pairs: [
              {
                fileA: "src/a.ts",
                fileB: "src/b.ts",
                coChangeCommits: 4,
                couplingScore: 0.9,
              },
            ],
            totalPairCount: 1,
            consideredCommits: 12,
            skippedLargeCommits: 0,
            truncated: false,
          },
          recentActivity: [
            {
              bucketStartUtcDate: "2023-11-14",
              commitCount: 1,
              fileTouchCount: 1,
              churnTotal: 60,
              activeAuthorCount: 1,
              volatilityScore: 0.82,
            },
          ],
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
    expect(report.changeOwnership.available).toBe(true);
    if (report.changeOwnership.available) {
      expect(report.changeOwnership.metrics.totalCommits).toBe(12);
      expect(report.changeOwnership.metrics.meanBusFactorByCommits).toBe(1.3333);
      expect(report.changeOwnership.metrics.averageRecentVolatility).toBe(32.3333);
      expect(report.changeOwnership.metrics.legacyNoActiveOwnerPercent).toBe(0);
      expect(report.changeOwnership.posture).toMatchObject({
        status: "concentrated",
        activeContributors: 3,
        topAuthorCommitShare: 53.8462,
        moduleDominancePercent: 0,
      });
      expect(report.changeOwnership.recentActivity).toHaveLength(1);
      expect(report.changeOwnership.recentActivity[0]).toMatchObject({
        commitCount: 1,
        fileTouchCount: 1,
        churnTotal: 60,
        activeAuthorCount: 1,
        volatilityScore: 0.82,
      });
      expect(report.changeOwnership.coChangePairs[0]?.fileA).toBe("src/a.ts");
      expect(report.changeOwnership.coChangePairs[0]?.couplingScore).toBe(0.9);
      expect(report.changeOwnership.moduleKnowledge[0]?.module).toBe("src");
      expect(report.changeOwnership.moduleKnowledge[0]?.activeAuthors).toBe(3);
      expect(report.changeOwnership.fragileAreas[0]).toMatchObject({
        module: "src",
        ownershipLabel: "sparse",
        totalCommits: 26,
      });
      expect(
        report.changeOwnership.contributorOwnership.find(
          (contributor) => contributor.authorId === "alice@example.com",
        ),
      ).toMatchObject({
        authorId: "alice@example.com",
        singleMaintainerFiles: 0,
        concentratedFiles: 1,
        ownedFiles: 2,
        totalCommitShare: 53.8462,
      });
      expect(report.changeOwnership.fileOwnership.map((file) => file.ownershipLabel)).toEqual([
        "singleMaintainer",
        "concentrated",
        "shared",
      ]);
      expect(report.changeOwnership.fileOwnership[0]).toMatchObject({
        filePath: "src/single.ts",
        topAuthorShareByCommits: 1,
      });
      expect(report.changeOwnership.fileOwnership[1]?.authorDistributionByCommits).toEqual([
        { authorId: "alice@example.com", commits: 9, share: 0.75 },
        { authorId: "bob@example.com", commits: 3, share: 0.25 },
      ]);
    }
  });

  it("prioritizes knowledge-risk modules in heatmap candidates", () => {
    const distributedModules = Array.from({ length: 8 }, (_, index) =>
      evolutionFile(`distributed-${index}/index.ts`, 100 - index, [
        { authorId: "alice@example.com", commits: 34 },
        { authorId: "bob@example.com", commits: 33 },
        { authorId: "carol@example.com", commits: 33 },
      ]),
    );

    const snapshot = createSnapshot({
      analysis: {
        ...analysis(45),
        evolution: {
          targetPath: "/repo",
          available: true,
          files: [
            ...distributedModules,
            evolutionFile("risky-silo/index.ts", 1, [{ authorId: "solo@example.com", commits: 1 }]),
          ],
          hotspots: [],
          coupling: {
            pairs: [],
            totalPairCount: 0,
            consideredCommits: 0,
            skippedLargeCommits: 0,
            truncated: false,
          },
          recentActivity: [],
          metrics: {
            totalCommits: 793,
            totalFiles: 9,
            headCommitTimestamp: 1_700_000_000,
            recentWindowDays: 30,
            hotspotTopPercent: 0.1,
            hotspotThresholdCommitCount: 1,
          },
        },
      },
      generatedAt: "2026-03-01T00:00:03.000Z",
    });

    const report = createReport(snapshot);

    expect(report.changeOwnership.available).toBe(true);
    if (report.changeOwnership.available) {
      expect(report.changeOwnership.moduleKnowledge).toHaveLength(8);
      expect(report.changeOwnership.moduleKnowledge[0]).toMatchObject({
        module: "risky-silo",
        ownershipLabel: "siloed",
      });
      expect(
        report.changeOwnership.moduleKnowledge.some((entry) => entry.module === "risky-silo"),
      ).toBe(true);
    }
  });

  it("includes external dependency metrics and enriched risky dependency details", () => {
    const snapshot = createSnapshot({
      analysis: {
        ...analysis(68),
        external: {
          targetPath: "/repo",
          available: true,
          metrics: {
            totalDependencies: 12,
            directDependencies: 3,
            directProductionDependencies: 2,
            directDevelopmentDependencies: 1,
            transitiveDependencies: 9,
            dependencyDepth: 4,
            lockfileKind: "pnpm",
            metadataCoverage: 0.75,
          },
          dependencies: [
            {
              name: "legacy-logger",
              direct: true,
              dependencyScope: "prod",
              requestedRange: "^1.0.0",
              resolvedVersion: "1.2.3",
              transitiveDependencies: ["sub-a", "sub-b", "sub-c"],
              weeklyDownloads: 320,
              dependencyDepth: 1,
              fanOut: 3,
              dependents: 2,
              maintainerCount: 1,
              releaseFrequencyDays: 180,
              daysSinceLastRelease: 950,
              repositoryActivity30d: 0,
              busFactor: 1,
              ownRiskSignals: ["single_maintainer", "abandoned"],
              inheritedRiskSignals: ["high_fanout"],
              riskSignals: ["single_maintainer", "abandoned", "high_fanout"],
            },
            {
              name: "build-helper",
              direct: true,
              dependencyScope: "dev",
              requestedRange: "^2.0.0",
              resolvedVersion: "2.4.0",
              transitiveDependencies: ["tool-a"],
              weeklyDownloads: 10_000,
              dependencyDepth: 1,
              fanOut: 1,
              dependents: 1,
              maintainerCount: 2,
              releaseFrequencyDays: 30,
              daysSinceLastRelease: 20,
              repositoryActivity30d: 4,
              busFactor: 2,
              ownRiskSignals: [],
              inheritedRiskSignals: [],
              riskSignals: [],
            },
          ],
          highRiskDependencies: ["legacy-logger"],
          highRiskDevelopmentDependencies: [],
          transitiveExposureDependencies: ["legacy-logger"],
          singleMaintainerDependencies: ["legacy-logger"],
          abandonedDependencies: ["legacy-logger"],
          centralityRanking: [
            {
              name: "legacy-logger",
              dependents: 2,
              fanOut: 3,
              direct: true,
            },
          ],
        },
        risk: {
          ...analysis(68).risk,
          dependencyScores: [
            {
              dependency: "legacy-logger",
              score: 71,
              normalizedScore: 0.71,
              ownRiskSignals: ["single_maintainer", "abandoned"],
              inheritedRiskSignals: ["high_fanout"],
            },
          ],
        },
      },
      trace,
      generatedAt: "2026-03-01T00:00:03.000Z",
    });

    const report = createReport(snapshot);

    expect(report.external.available).toBe(true);
    if (report.external.available) {
      expect(report.external.metrics).toMatchObject({
        totalDependencies: 12,
        directDependencies: 3,
        directProductionDependencies: 2,
        directDevelopmentDependencies: 1,
        transitiveDependencies: 9,
        dependencyDepth: 4,
        lockfileKind: "pnpm",
        metadataCoverage: 0.75,
      });
      expect(report.external.transitiveExposureDependencies).toEqual(["legacy-logger"]);
      expect(report.external.centralityRanking[0]).toEqual({
        name: "legacy-logger",
        dependents: 2,
        fanOut: 3,
        direct: true,
      });
      expect(report.external.riskyDependencies[0]).toMatchObject({
        name: "legacy-logger",
        dependencyScope: "prod",
        resolvedVersion: "1.2.3",
        transitiveDependencyCount: 3,
        dependentCount: 2,
        fanOut: 3,
        dependencyDepth: 1,
        maintainerCount: 1,
        daysSinceLastRelease: 950,
        busFactor: 1,
        ownRiskSignals: ["single_maintainer", "abandoned"],
        inheritedRiskSignals: ["high_fanout"],
      });
      expect(report.external.riskyDependencies[0]?.riskSignals).toEqual([
        "single_maintainer",
        "abandoned",
        "high_fanout",
      ]);
    }
  });
});
