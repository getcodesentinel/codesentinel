import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { CodeSentinelReport } from "@codesentinel/reporter";
import { resolveHtmlReportOutputPath, writeHtmlReportBundle } from "./html-report.js";

const buildReport = (): CodeSentinelReport => ({
  schemaVersion: "codesentinel.report.v1",
  generatedAt: "2026-03-29T00:00:00.000Z",
  repository: {
    name: "repo",
    targetPath: "/repo",
    riskScore: 42,
    normalizedScore: 0.42,
    riskTier: "elevated",
    healthTier: "fair",
    confidence: null,
    dimensionScores: {
      structural: 30,
      evolution: 40,
      external: 20,
      interactions: 10,
    },
  },
  health: {
    healthScore: 58,
    normalizedScore: 0.58,
    dimensions: {
      modularity: 60,
      changeHygiene: 50,
      testHealth: 70,
      ownershipDistribution: 52,
    },
    topIssues: [],
  },
  hotspots: [],
  structural: {
    cycleCount: 0,
    cycles: [],
    cycleDetails: [],
    fanInOutExtremes: {
      highestFanIn: [],
      highestFanOut: [],
      deepestFiles: [],
    },
    fragileClusters: [],
  },
  external: {
    available: false,
    reason: "lockfile_not_found",
  },
  appendix: {
    snapshotSchemaVersion: "codesentinel.snapshot.v1",
    riskModelVersion: "deterministic-v1",
    timestamp: "2026-03-29T00:00:00.000Z",
    normalization:
      "Scores are deterministic 0-100 outputs from risk-engine normalized factors and interaction terms.",
  },
});

describe("html report bundle", () => {
  it("copies the built app and injects report-data.js before the main app script", async () => {
    const root = join(tmpdir(), `codesentinel-html-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const appPath = join(root, "app");
    const outputPath = join(root, "output");
    await mkdir(join(appPath, "assets"), { recursive: true });
    await writeFile(
      join(appPath, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./assets/main.js"></script></body></html>',
      "utf8",
    );
    await writeFile(join(appPath, "assets/main.js"), "console.log('app');\n", "utf8");

    const bundlePath = await writeHtmlReportBundle(buildReport(), {
      repositoryPath: "/repo",
      outputPath,
      bundledAppPath: appPath,
    });

    expect(bundlePath).toBe(resolveHtmlReportOutputPath("/repo", outputPath));

    const writtenIndex = await readFile(join(outputPath, "index.html"), "utf8");
    const bootstrap = await readFile(join(outputPath, "report-data.js"), "utf8");

    expect(writtenIndex).toContain('<script src="./report-data.js"></script>');
    expect(bootstrap).toContain("window.__CODESENTINEL_REPORT__ = ");
    expect(bootstrap).toContain('"name":"repo"');
  });
});
