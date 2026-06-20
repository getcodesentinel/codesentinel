import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  type DependencyMetadata,
  type DependencyMetadataProvider,
} from "../domain/types.js";
import { buildDependencyExposureSummary } from "./dependency-exposure-pipeline.js";

class RecordingMetadataProvider implements DependencyMetadataProvider {
  readonly requests: { name: string; version: string; directDependency: boolean }[] = [];

  getMetadata(
    name: string,
    version: string,
    context: { directDependency: boolean },
  ): Promise<DependencyMetadata | null> {
    this.requests.push({ name, version, directDependency: context.directDependency });
    return Promise.resolve({
      name,
      version,
      weeklyDownloads: 1000,
      maintainerCount: name === "b" ? 1 : 2,
      releaseFrequencyDays: 30,
      daysSinceLastRelease: name === "b" ? 900 : 10,
      repositoryActivity30d: name === "b" ? 0 : 4,
      busFactor: name === "b" ? 1 : 2,
    });
  }
}

describe("buildDependencyExposureSummary", () => {
  it("collects metadata and builds the external dependency summary through one pipeline", async () => {
    const metadataProvider = new RecordingMetadataProvider();
    const progressEvents: string[] = [];

    const summary = await buildDependencyExposureSummary({
      targetPath: "/repo",
      extraction: {
        kind: "pnpm",
        directDependencies: [{ name: "a", requestedRange: "^1.0.0", scope: "prod" }],
        nodes: [
          { name: "a", version: "1.0.0", dependencies: ["b@2.0.0"] },
          { name: "b", version: "2.0.0", dependencies: [] },
        ],
      },
      metadataProvider,
      config: DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
      onMetadataProgress: (event) => progressEvents.push(`${event.completed}:${event.packageName}`),
    });

    expect(summary.available).toBe(true);
    if (!summary.available) {
      return;
    }

    expect(metadataProvider.requests).toEqual([
      { name: "a", version: "1.0.0", directDependency: true },
      { name: "b", version: "2.0.0", directDependency: false },
    ]);
    expect(progressEvents).toEqual(["1:a", "2:b"]);
    expect(summary.metrics).toMatchObject({
      totalDependencies: 2,
      directDependencies: 1,
      transitiveDependencies: 1,
      metadataCoverage: 1,
    });
    expect(summary.dependencies[0]?.inheritedRiskSignals).toContain("abandoned");
  });
});
