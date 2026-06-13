import { describe, expect, it } from "vitest";
import { buildExternalAnalysisSummary } from "./external-analysis.js";
import { DEFAULT_EXTERNAL_ANALYSIS_CONFIG } from "./types.js";

describe("buildExternalAnalysisSummary", () => {
  it("computes centrality and risk classifications", () => {
    const summary = buildExternalAnalysisSummary(
      "/repo",
      {
        kind: "pnpm",
        directDependencies: [
          { name: "a", requestedRange: "^1", scope: "prod" },
          { name: "x", requestedRange: "^1", scope: "dev" },
        ],
        nodes: [
          { name: "a", version: "1.0.0", dependencies: ["b@2.0.0", "c@3.0.0"] },
          { name: "x", version: "1.0.0", dependencies: ["b@2.0.0"] },
          { name: "b", version: "2.0.0", dependencies: [] },
          { name: "c", version: "3.0.0", dependencies: [] },
        ],
      },
      new Map([
        [
          "a@1.0.0",
          {
            name: "a",
            version: "1.0.0",
            weeklyDownloads: 100000,
            maintainerCount: 2,
            releaseFrequencyDays: 30,
            daysSinceLastRelease: 20,
            repositoryActivity30d: null,
            busFactor: null,
          },
        ],
        [
          "b@2.0.0",
          {
            name: "b",
            version: "2.0.0",
            weeklyDownloads: 250,
            maintainerCount: 1,
            releaseFrequencyDays: 200,
            daysSinceLastRelease: 900,
            repositoryActivity30d: null,
            busFactor: null,
          },
        ],
      ]),
      DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
    );

    expect(summary.available).toBe(true);
    if (!summary.available) {
      return;
    }

    expect(summary.metrics.totalDependencies).toBe(4);
    expect(summary.metrics.directProductionDependencies).toBe(1);
    expect(summary.metrics.directDevelopmentDependencies).toBe(1);
    expect(summary.dependencies.map((dependency) => dependency.name)).toEqual(["a", "x"]);
    expect(summary.workspaces).toBeUndefined();
    expect(summary.centralityRanking[0]?.name).toBe("b");
    expect(summary.singleMaintainerDependencies).toEqual([]);
    expect(summary.abandonedDependencies).toEqual([]);
  });

  it("summarizes dependency exposure by workspace", () => {
    const summary = buildExternalAnalysisSummary(
      "/repo",
      {
        kind: "pnpm",
        directDependencies: [],
        nodes: [
          { name: "react", version: "19.0.0", dependencies: [] },
          { name: "zod", version: "4.0.0", dependencies: ["left-pad@1.3.0"] },
          { name: "eslint", version: "9.0.0", dependencies: [] },
          { name: "left-pad", version: "1.3.0", dependencies: [] },
        ],
      },
      new Map([
        [
          "left-pad@1.3.0",
          {
            name: "left-pad",
            version: "1.3.0",
            weeklyDownloads: 10,
            maintainerCount: 1,
            releaseFrequencyDays: null,
            daysSinceLastRelease: 900,
            repositoryActivity30d: 0,
            busFactor: 1,
          },
        ],
      ]),
      DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
      [
        {
          name: "@repo/web",
          path: "apps/web",
          kind: "app",
          directDependencies: [
            { name: "@repo/api", requestedRange: "workspace:*", scope: "prod" },
            { name: "react", requestedRange: "^19.0.0", scope: "prod" },
            { name: "zod", requestedRange: "^4.0.0", scope: "prod" },
            { name: "eslint", requestedRange: "^9.0.0", scope: "dev" },
          ],
        },
        {
          name: "@repo/api",
          path: "packages/api",
          kind: "package",
          directDependencies: [
            { name: "react", requestedRange: "^19.0.0", scope: "prod" },
            { name: "missing", requestedRange: "^1.0.0", scope: "prod" },
          ],
        },
      ],
    );

    expect(summary.available).toBe(true);
    if (!summary.available) {
      return;
    }

    expect(summary.workspaces).toEqual([
      {
        name: "@repo/web",
        path: "apps/web",
        kind: "app",
        directDependencies: 3,
        directProductionDependencies: 2,
        directDevelopmentDependencies: 1,
        unresolvedDependencies: [],
        dependencyNames: ["eslint", "react", "zod"],
        sharedDependencies: ["react"],
        highRiskDependencies: [],
        highRiskDevelopmentDependencies: [],
        transitiveExposureDependencies: ["zod"],
        singleMaintainerDependencies: [],
        abandonedDependencies: [],
      },
      {
        name: "@repo/api",
        path: "packages/api",
        kind: "package",
        directDependencies: 2,
        directProductionDependencies: 2,
        directDevelopmentDependencies: 0,
        unresolvedDependencies: ["missing"],
        dependencyNames: ["missing", "react"],
        sharedDependencies: ["react"],
        highRiskDependencies: [],
        highRiskDevelopmentDependencies: [],
        transitiveExposureDependencies: [],
        singleMaintainerDependencies: [],
        abandonedDependencies: [],
      },
    ]);
  });
});
