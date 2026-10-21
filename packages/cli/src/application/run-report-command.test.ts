import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CodeSentinelReport,
  CodeSentinelSnapshot,
  OwnershipAuditReport,
} from "@codesentinel/reporter";
import type { WriteHtmlReportBundleOptions } from "./html-report.js";
import { runReportCommand } from "./run-report-command.js";

const {
  buildAnalysisSnapshotMock,
  writeHtmlReportBundleMock,
  openPathMock,
  buildReportOwnershipMock,
} = vi.hoisted(() => ({
  buildAnalysisSnapshotMock: vi.fn<() => Promise<CodeSentinelSnapshot>>(),
  writeHtmlReportBundleMock:
    vi.fn<(report: CodeSentinelReport, options: WriteHtmlReportBundleOptions) => Promise<string>>(),
  openPathMock: vi.fn<(targetPath: string) => Promise<boolean>>(),
  buildReportOwnershipMock:
    vi.fn<() => Promise<{ ownership: OwnershipAuditReport; webUrl: string | null }>>(),
}));

vi.mock("./build-analysis-snapshot.js", () => ({
  buildAnalysisSnapshot: buildAnalysisSnapshotMock,
}));

vi.mock("./html-report.js", () => ({
  writeHtmlReportBundle: writeHtmlReportBundleMock,
}));

vi.mock("./open-path.js", () => ({
  openPath: openPathMock,
}));

vi.mock("./report-ownership.js", () => ({
  buildReportOwnership: buildReportOwnershipMock,
}));

const ownershipReport: OwnershipAuditReport = {
  available: true,
  codeowners: {
    source: "CODEOWNERS",
    ignoredSources: [],
    errors: [],
  },
  metrics: {
    declaredCoveragePercent: 100,
    declaredCoverageCriticalPercent: 100,
    driftPercent: 0,
    ghostOwnerCount: 0,
    unownedCriticalCount: 0,
    singleOwnerModuleCount: 1,
  },
  ghostOwners: [],
  files: [],
  warnings: [],
};

const snapshot: CodeSentinelSnapshot = {
  schemaVersion: "codesentinel.snapshot.v1",
  generatedAt: "2026-03-29T00:00:00.000Z",
  riskModelVersion: "deterministic-v1",
  source: {
    targetPath: "/repo",
  },
  analysis: {
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
          fanOut: 0,
          depth: 1,
        },
      ],
      metrics: {
        nodeCount: 1,
        edgeCount: 0,
        cycleCount: 0,
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
      riskScore: 42,
      normalizedScore: 0.42,
      hotspots: [
        {
          file: "src/a.ts",
          score: 42,
          factors: { structural: 0.5, evolution: 0.3, external: 0.2 },
        },
      ],
      fragileClusters: [],
      dependencyAmplificationZones: [],
      fileScores: [
        {
          file: "src/a.ts",
          score: 42,
          normalizedScore: 0.42,
          factors: { structural: 0.5, evolution: 0.3, external: 0.2 },
        },
      ],
      moduleScores: [
        {
          module: "src",
          score: 42,
          normalizedScore: 0.42,
          fileCount: 1,
        },
      ],
      workspaceScores: [],
      dependencyScores: [],
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
  },
};

describe("runReportCommand", () => {
  beforeEach(() => {
    buildAnalysisSnapshotMock.mockReset();
    writeHtmlReportBundleMock.mockReset();
    openPathMock.mockReset();
    buildReportOwnershipMock.mockReset();
    buildAnalysisSnapshotMock.mockResolvedValue(snapshot);
    writeHtmlReportBundleMock.mockResolvedValue("/tmp/report");
    openPathMock.mockResolvedValue(true);
    buildReportOwnershipMock.mockResolvedValue({
      ownership: ownershipReport,
      webUrl: "https://github.com/getcodesentinel/codesentinel",
    });
  });

  it("passes the ownership audit and repository web url into the report", async () => {
    const result = await runReportCommand(".", "likely_merge", {
      format: "json",
      includeTrace: false,
    });

    expect(buildReportOwnershipMock).toHaveBeenCalledWith("/repo", expect.anything());
    expect(result.report.ownership).toEqual(ownershipReport);
    expect(result.report.repository.webUrl).toBe("https://github.com/getcodesentinel/codesentinel");
  });

  it("writes the html report bundle when format=html", async () => {
    const result = await runReportCommand(".", "likely_merge", {
      format: "html",
      includeTrace: false,
      outputPath: "/tmp/report",
    });

    expect(writeHtmlReportBundleMock).toHaveBeenCalledTimes(1);
    const [report, options] = writeHtmlReportBundleMock.mock.calls[0] ?? [];
    expect(report?.repository.name).toBe("repo");
    expect(options).toMatchObject({
      repositoryPath: "/repo",
      outputPath: "/tmp/report",
    });
    expect(result.outputPath).toBe("/tmp/report");
    expect(result.rendered).toBe("/tmp/report");
  });

  it("opens the generated html report when requested", async () => {
    await runReportCommand(".", "likely_merge", {
      format: "html",
      includeTrace: false,
      outputPath: "/tmp/report",
      open: true,
    });

    expect(openPathMock).toHaveBeenCalledWith("/tmp/report/index.html");
  });
});
