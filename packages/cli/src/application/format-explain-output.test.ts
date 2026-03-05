import { describe, expect, it } from "vitest";
import type { AnalyzeSummary, RiskTrace } from "@codesentinel/core";
import { formatExplainOutput, type ExplainOutputPayload } from "./format-explain-output.js";

const summary: AnalyzeSummary = {
  structural: {
    targetPath: "/repo",
    nodes: [{ id: "src/a.ts", absolutePath: "/repo/src/a.ts", relativePath: "src/a.ts" }],
    edges: [],
    cycles: [],
    files: [
      {
        id: "src/a.ts",
        relativePath: "src/a.ts",
        directDependencies: [],
        fanIn: 1,
        fanOut: 1,
        depth: 1,
      },
    ],
    metrics: {
      nodeCount: 1,
      edgeCount: 0,
      cycleCount: 0,
      graphDepth: 1,
      maxFanIn: 1,
      maxFanOut: 1,
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
    riskScore: 58.2,
    normalizedScore: 0.582,
    hotspots: [
      {
        file: "src/a.ts",
        score: 70.4,
        factors: { structural: 0.4, evolution: 0.3, external: 0.3 },
      },
    ],
    fragileClusters: [],
    dependencyAmplificationZones: [],
    fileScores: [
      {
        file: "src/a.ts",
        score: 70.4,
        normalizedScore: 0.704,
        factors: { structural: 0.4, evolution: 0.3, external: 0.3 },
      },
    ],
    moduleScores: [
      {
        module: "src",
        score: 70.4,
        normalizedScore: 0.704,
        fileCount: 1,
      },
    ],
    dependencyScores: [],
  },
  health: {
    healthScore: 64.1,
    normalizedScore: 0.641,
    dimensions: {
      modularity: 60,
      changeHygiene: 57.5,
      testHealth: 80,
      ownershipDistribution: 62,
    },
    topIssues: [],
  },
};

const trace: RiskTrace = {
  schemaVersion: "1",
  contributionTolerance: 0.0001,
  targets: [
    {
      targetType: "repository",
      targetId: "/repo",
      totalScore: 58.2,
      normalizedScore: 0.582,
      factors: [
        {
          factorId: "repository.evolution",
          family: "evolution",
          contribution: 22,
          rawMetrics: { evolutionDimension: 0.7 },
          normalizedMetrics: {},
          weight: 1,
          amplification: null,
          evidence: [{ kind: "repository_metric", metric: "evolutionDimension" }],
          confidence: 1,
        },
        {
          factorId: "repository.composite.interactions",
          family: "composite",
          contribution: 16,
          rawMetrics: {
            structuralEvolution: 0.1,
            centralInstability: 0.04,
            dependencyAmplification: 0.03,
          },
          normalizedMetrics: {},
          weight: null,
          amplification: 0.5,
          evidence: [{ kind: "repository_metric", metric: "interactionTerms" }],
          confidence: 0.9,
        },
      ],
      dominantFactors: ["repository.evolution", "repository.composite.interactions"],
      reductionLevers: [{ factorId: "repository.evolution", estimatedImpact: 22 }],
    },
    {
      targetType: "file",
      targetId: "src/a.ts",
      totalScore: 70.4,
      normalizedScore: 0.704,
      factors: [
        {
          factorId: "file.evolution",
          family: "evolution",
          contribution: 30,
          rawMetrics: { commitCount: 8, churnTotal: 180, recentVolatility: 1 },
          normalizedMetrics: {},
          weight: 1,
          amplification: null,
          evidence: [{ kind: "file_metric", target: "src/a.ts", metric: "commitCount" }],
          confidence: 1,
        },
      ],
      dominantFactors: ["file.evolution"],
      reductionLevers: [{ factorId: "file.evolution", estimatedImpact: 30 }],
    },
  ],
};

const payload: ExplainOutputPayload = {
  summary,
  trace,
  selectedTargets: trace.targets,
};

describe("formatExplainOutput", () => {
  it("renders concise summary text without redundant sections", () => {
    const text = formatExplainOutput(payload, "text");

    expect(text).toContain("key drivers:");
    expect(text).toContain("contributions:");
    expect(text).toContain("interaction effects:");
    expect(text).toContain("priority actions:");
    expect(text).not.toContain("what specifically contributed:");
    expect(text).not.toContain("dominant factors:");
  });

  it("renders concise summary markdown without redundant sections", () => {
    const markdown = formatExplainOutput(payload, "md");

    expect(markdown).toContain("- key drivers:");
    expect(markdown).toContain("- contributions:");
    expect(markdown).toContain("- interaction effects:");
    expect(markdown).toContain("- priority actions:");
    expect(markdown).not.toContain("- what specifically contributed:");
    expect(markdown).not.toContain("- dominant factors:");
    expect(markdown).not.toContain("- dominantFactors:");
  });
});
