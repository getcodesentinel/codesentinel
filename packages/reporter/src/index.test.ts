import { describe, expect, it } from "vitest";
import type { AnalyzeSummary, RiskTrace } from "@codesentinel/core";
import { compareSnapshots, createReport, createSnapshot, formatReport, parseSnapshot } from "./index.js";

const analysis = (repositoryScore: number): AnalyzeSummary => ({
  structural: {
    targetPath: "/repo",
    nodes: [{ id: "src/a.ts", absolutePath: "/repo/src/a.ts", relativePath: "src/a.ts" }],
    edges: [],
    cycles: repositoryScore > 50 ? [{ nodes: ["src/a.ts", "src/a.ts"] }] : [],
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
      cycleCount: repositoryScore > 50 ? 1 : 0,
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
    repositoryScore,
    normalizedScore: repositoryScore / 100,
    hotspots: [
      {
        file: "src/a.ts",
        score: repositoryScore,
        factors: { structural: 0.5, evolution: 0, external: 0 },
      },
    ],
    fragileClusters: [],
    dependencyAmplificationZones: [],
    fileScores: [
      {
        file: "src/a.ts",
        score: repositoryScore,
        normalizedScore: repositoryScore / 100,
        factors: { structural: 0.5, evolution: 0, external: 0 },
      },
    ],
    moduleScores: [
      {
        module: "src",
        score: repositoryScore,
        normalizedScore: repositoryScore / 100,
        fileCount: 1,
      },
    ],
    dependencyScores: [],
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
    expect(diff.repositoryScoreDelta).toBe(15);

    const report = createReport(current, diff);
    const text = formatReport(report, "text");
    const md = formatReport(report, "md");
    const json = formatReport(report, "json");

    expect(text).toContain("Repository Summary");
    expect(md).toContain("## Repository Summary");
    expect(json).toContain('"schemaVersion": "codesentinel.report.v1"');
  });
});
