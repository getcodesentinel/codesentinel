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
          { name: "a", requestedRange: "^1" },
          { name: "x", requestedRange: "^1" },
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
    expect(summary.dependencies.map((dependency) => dependency.name)).toEqual(["a", "x"]);
    expect(summary.centralityRanking[0]?.name).toBe("b");
    expect(summary.singleMaintainerDependencies).toEqual([]);
    expect(summary.abandonedDependencies).toEqual([]);
  });
});
