import { describe, expect, it } from "vitest";
import type { AnalyzeSummary } from "@codesentinel/core";
import { createSnapshot, compareSnapshots } from "@codesentinel/reporter";
import { GovernanceConfigurationError, evaluateGates } from "./index.js";

const makeAnalysis = (score: number, hotspot: string, cycleCount = 0): AnalyzeSummary => ({
  structural: {
    targetPath: "/repo",
    nodes: [{ id: hotspot, absolutePath: `/repo/${hotspot}`, relativePath: hotspot }],
    edges: [],
    cycles: cycleCount === 0 ? [] : [{ nodes: [hotspot] }],
    files: [
      { id: hotspot, relativePath: hotspot, directDependencies: [], fanIn: 0, fanOut: 0, depth: 0 },
    ],
    metrics: { nodeCount: 1, edgeCount: 0, cycleCount, graphDepth: 0, maxFanIn: 0, maxFanOut: 0 },
  },
  evolution: { targetPath: "/repo", available: false, reason: "not_git_repository" },
  external: {
    targetPath: "/repo",
    available: true,
    metrics: {
      totalDependencies: 1,
      directDependencies: 1,
      directProductionDependencies: 1,
      directDevelopmentDependencies: 0,
      transitiveDependencies: 0,
      dependencyDepth: 1,
      lockfileKind: "npm",
      metadataCoverage: 1,
    },
    dependencies: [],
    highRiskDependencies: score > 50 ? ["x"] : [],
    highRiskDevelopmentDependencies: [],
    transitiveExposureDependencies: [],
    singleMaintainerDependencies: [],
    abandonedDependencies: [],
    centralityRanking: [],
  },
  risk: {
    riskScore: score,
    normalizedScore: score / 100,
    hotspots: [{ file: hotspot, score, factors: { structural: 1, evolution: 0, external: 0 } }],
    fragileClusters: [],
    dependencyAmplificationZones: [],
    fileScores: [
      {
        file: hotspot,
        score,
        normalizedScore: score / 100,
        factors: { structural: 1, evolution: 0, external: 0 },
      },
    ],
    moduleScores: [{ module: "src", score, normalizedScore: score / 100, fileCount: 1 }],
    dependencyScores: [],
  },
});

describe("governance gates", () => {
  it("evaluates diff gates deterministically", () => {
    const baseline = createSnapshot({
      analysis: makeAnalysis(30, "src/a.ts", 0),
      generatedAt: "2026-03-01T00:00:00.000Z",
    });
    const current = createSnapshot({
      analysis: makeAnalysis(70, "src/b.ts", 1),
      generatedAt: "2026-03-01T00:01:00.000Z",
    });
    const diff = compareSnapshots(current, baseline);

    const result = evaluateGates({
      current,
      baseline,
      diff,
      gateConfig: {
        failOn: "warn",
        maxRepoDelta: 0.03,
        noNewCycles: true,
        noNewHighRiskDeps: true,
        maxNewHotspots: 0,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]?.id).toBeDefined();
  });

  it("throws when diff gate is configured without baseline", () => {
    const current = createSnapshot({
      analysis: makeAnalysis(40, "src/a.ts"),
      generatedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(() =>
      evaluateGates({
        current,
        gateConfig: {
          failOn: "error",
          noNewCycles: true,
        },
      }),
    ).toThrowError(GovernanceConfigurationError);
  });
});
