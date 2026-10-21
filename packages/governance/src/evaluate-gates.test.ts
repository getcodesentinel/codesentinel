import { describe, expect, it } from "vitest";
import type { AnalyzeSummary } from "@codesentinel/core";
import { compareSnapshots, createSnapshot } from "@codesentinel/reporter";
import {
  GovernanceConfigurationError,
  evaluateGates,
  type GateConfig,
  type OwnershipGateInput,
  type OwnershipGateMetrics,
} from "./index.js";

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
    workspaceScores: [],
    dependencyScores: [],
  },
  health: {
    healthScore: Math.max(0, 100 - score),
    normalizedScore: Math.max(0, 1 - score / 100),
    dimensions: {
      modularity: Math.max(0, 100 - score),
      changeHygiene: Math.max(0, 100 - score),
      testHealth: 100,
      ownershipDistribution: Math.max(0, 100 - score),
    },
    topIssues: [],
  },
});

const makeSnapshot = (score = 10, hotspot = "src/a.ts") =>
  createSnapshot({
    analysis: makeAnalysis(score, hotspot),
    generatedAt: "2026-03-01T00:00:00.000Z",
  });

const makeMetrics = (overrides: Partial<OwnershipGateMetrics> = {}): OwnershipGateMetrics => ({
  declaredCoveragePercent: 100,
  declaredCoverageCriticalPercent: 100,
  driftPercent: 0,
  ghostOwnerCount: 0,
  unownedCriticalCount: 0,
  ...overrides,
});

const availableOwnership = (metrics: OwnershipGateMetrics = makeMetrics()): OwnershipGateInput => ({
  available: true,
  source: "CODEOWNERS",
  metrics,
});

const allOwnershipGates: GateConfig = {
  maxUnownedCritical: 0,
  maxGhostOwners: 0,
  maxDrift: 0.25,
  failOn: "error",
};

describe("ownership gates", () => {
  it("passes when every metric is below its threshold", () => {
    const result = evaluateGates({
      current: makeSnapshot(),
      gateConfig: allOwnershipGates,
      ownership: availableOwnership(),
    });

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.evaluatedGates).toEqual([
      "max-drift",
      "max-ghost-owners",
      "max-unowned-critical",
    ]);
    expect(result.ownership).toEqual({
      evaluated: true,
      source: "CODEOWNERS",
      metrics: makeMetrics(),
    });
    expect(result.warnings).toEqual([]);
  });

  it("fails max-unowned-critical with an error violation", () => {
    const ownership = availableOwnership(makeMetrics({ unownedCriticalCount: 2 }));

    for (const failOn of ["error", "warn"] as const) {
      const result = evaluateGates({
        current: makeSnapshot(),
        gateConfig: { maxUnownedCritical: 1, failOn },
        ownership,
      });

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        id: "max-unowned-critical",
        severity: "error",
        targets: [],
        evidenceRefs: [{ kind: "repository_metric", metric: "unownedCriticalCount" }],
      });
      expect(result.violations[0]?.message).toContain("2");
      expect(result.violations[0]?.message).toContain("1");
      expect(result.exitCode).toBe(1);
    }
  });

  it("fails max-ghost-owners with an error violation", () => {
    const ownership = availableOwnership(makeMetrics({ ghostOwnerCount: 3 }));

    for (const failOn of ["error", "warn"] as const) {
      const result = evaluateGates({
        current: makeSnapshot(),
        gateConfig: { maxGhostOwners: 2, failOn },
        ownership,
      });

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        id: "max-ghost-owners",
        severity: "error",
        targets: [],
        evidenceRefs: [{ kind: "repository_metric", metric: "ghostOwnerCount" }],
      });
      expect(result.violations[0]?.message).toContain("3");
      expect(result.violations[0]?.message).toContain("2");
      expect(result.exitCode).toBe(1);
    }
  });

  it("fails max-drift with an error violation", () => {
    const ownership = availableOwnership(makeMetrics({ driftPercent: 30 }));

    for (const failOn of ["error", "warn"] as const) {
      const result = evaluateGates({
        current: makeSnapshot(),
        gateConfig: { maxDrift: 0.25, failOn },
        ownership,
      });

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        id: "max-drift",
        severity: "error",
        targets: [],
        evidenceRefs: [{ kind: "repository_metric", metric: "driftPercent" }],
      });
      expect(result.violations[0]?.message).toContain("0.3000");
      expect(result.violations[0]?.message).toContain("0.25");
      expect(result.exitCode).toBe(1);
    }
  });

  it("passes at the drift boundary and fails one point above it", () => {
    const atBoundary = evaluateGates({
      current: makeSnapshot(),
      gateConfig: { maxDrift: 0.25, failOn: "error" },
      ownership: availableOwnership(makeMetrics({ driftPercent: 25 })),
    });
    expect(atBoundary.violations).toEqual([]);
    expect(atBoundary.exitCode).toBe(0);

    const aboveBoundary = evaluateGates({
      current: makeSnapshot(),
      gateConfig: { maxDrift: 0.25, failOn: "error" },
      ownership: availableOwnership(makeMetrics({ driftPercent: 26 })),
    });
    expect(aboveBoundary.violations).toHaveLength(1);
    expect(aboveBoundary.violations[0]?.id).toBe("max-drift");
    expect(aboveBoundary.exitCode).toBe(1);
  });

  it("warns and does not evaluate when CODEOWNERS is unavailable", () => {
    const result = evaluateGates({
      current: makeSnapshot(),
      gateConfig: allOwnershipGates,
      ownership: {
        available: false,
        warnings: ["custom ownership warning"],
      },
    });

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.evaluatedGates).toEqual([]);
    expect(result.ownership).toEqual({ evaluated: false, source: null, metrics: null });
    expect(result.warnings).toEqual([
      "custom ownership warning",
      "ownership gates were not evaluated: no CODEOWNERS file was found.",
    ]);
  });

  it("stays inert when no ownership threshold is configured", () => {
    const result = evaluateGates({
      current: makeSnapshot(),
      gateConfig: { failOn: "error" },
    });

    expect(result.ownership).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it.each([{ maxUnownedCritical: -1 }, { maxGhostOwners: 1.5 }, { maxDrift: 1.5 }])(
    "rejects invalid ownership configuration %j",
    (gateConfig) => {
      expect(() =>
        evaluateGates({
          current: makeSnapshot(),
          gateConfig: { ...gateConfig, failOn: "error" },
          ownership: availableOwnership(),
        }),
      ).toThrowError(GovernanceConfigurationError);
    },
  );

  it("keeps pre-existing gates unchanged when ownership fields are absent", () => {
    const risky = evaluateGates({
      current: makeSnapshot(70, "src/b.ts"),
      gateConfig: { maxRiskScore: 50, failOn: "error" },
    });
    expect(risky.violations.map((violation) => violation.id)).toEqual(["max-risk-score"]);
    expect(risky.exitCode).toBe(1);
    expect(risky.ownership).toBeUndefined();

    const baseline = makeSnapshot(30, "src/a.ts");
    const current = makeSnapshot(70, "src/b.ts");
    const warn = evaluateGates({
      current,
      baseline,
      diff: compareSnapshots(current, baseline),
      gateConfig: { maxNewHotspots: 0, failOn: "warn" },
    });
    expect(warn.violations.map((violation) => violation.id)).toEqual(["max-new-hotspots"]);
    expect(warn.exitCode).toBe(2);
    expect(warn.ownership).toBeUndefined();
  });
});
