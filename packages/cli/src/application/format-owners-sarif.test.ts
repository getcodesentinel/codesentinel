import { describe, expect, it } from "vitest";
import type {
  DeclaredOwner,
  FileOwnershipAudit,
  OwnershipAuditAvailable,
  OwnershipStatus,
} from "@codesentinel/ownership";
import { buildOwnersReport, type OwnersReport } from "./format-owners-output.js";
import {
  CODESENTINEL_INFORMATION_URI,
  SARIF_SCHEMA_URI,
  SARIF_VERSION,
  buildOwnersSarif,
  formatOwnersSarif,
  normalizeSarifUri,
} from "./format-owners-sarif.js";

const CODEOWNERS_SOURCE = ".github/CODEOWNERS";
const CONTEXT = { toolVersion: "1.2.3" };

const team: DeclaredOwner = { kind: "team", org: "acme", slug: "ops-team" };
const user: DeclaredOwner = { kind: "user", handle: "alice" };

const makeFile = (
  filePath: string,
  status: OwnershipStatus,
  overrides: Partial<FileOwnershipAudit> = {},
): FileOwnershipAudit => ({
  filePath,
  declared: [],
  matchLine: null,
  status,
  observed: {
    commits: 10,
    recentCommits: 10,
    dormant: false,
    authors: 2,
    topAuthorId: "nuria@example.com",
    topAuthorShare: 0.64,
    busFactor: 2,
    lastCommitUnix: null,
  },
  criticality: { fanIn: 2, isHotspot: false, riskScore: 20, isCritical: false },
  ...overrides,
});

const baseFiles = (): FileOwnershipAudit[] => {
  const extras = Array.from({ length: 8 }, (_value, index) =>
    makeFile(`extra/file-${index}.ts`, "drifted", {
      declared: [user],
      matchLine: 6 + index,
    }),
  );

  return [
    makeFile("packages\\core\\src\\index.ts", "unowned-critical", {
      matchLine: null,
      observed: {
        commits: 31,
        recentCommits: 31,
        dormant: false,
        authors: 4,
        topAuthorId: "jordi@example.com",
        topAuthorShare: 0.71,
        busFactor: 2,
        lastCommitUnix: null,
      },
      criticality: { fanIn: 12, isHotspot: true, riskScore: 61.5, isCritical: true },
    }),
    makeFile("api/webhooks.ts", "ghosted", { declared: [team], matchLine: 3 }),
    makeFile("api/drift.ts", "drifted", { declared: [team], matchLine: 4 }),
    makeFile("api/unknown.ts", "unknown", { declared: [team], matchLine: null }),
    makeFile("docs/readme.md", "aligned", { declared: [user], matchLine: 1 }),
    makeFile("scripts/deploy.sh", "unowned", { matchLine: null }),
    makeFile("duplicate/path.ts", "drifted", { declared: [user], matchLine: 5 }),
    makeFile("duplicate/path.ts", "unknown", { declared: [user], matchLine: 5 }),
    ...extras,
  ];
};

const availableAudit = (files: readonly FileOwnershipAudit[]): OwnershipAuditAvailable => ({
  available: true,
  codeowners: {
    source: CODEOWNERS_SOURCE,
    entries: [
      { pattern: "*", owners: [user], line: 1, ignored: false },
      { pattern: "/api/", owners: [team], line: 3, ignored: false },
    ],
    errors: [],
    ignoredSources: ["CODEOWNERS"],
  },
  metrics: {
    declaredCoveragePercent: 60,
    declaredCoverageCriticalPercent: 0,
    driftPercent: 33.33,
    ghostOwnerCount: 1,
    unownedCriticalCount: 1,
    singleOwnerModuleCount: 3,
  },
  ghostOwners: [{ owner: user, samplePaths: ["api/webhooks.ts"] }],
  files,
  warnings: [],
});

const buildReport = (files: readonly FileOwnershipAudit[] = baseFiles()): OwnersReport =>
  buildOwnersReport({
    audit: availableAudit(files),
    ref: "main",
    windowDays: 90,
    minCommits: 2,
    trackedFileCount: files.length,
    thresholds: {
      failOn: "none",
      maxUnownedCritical: null,
      maxGhostOwners: null,
      maxDrift: null,
    },
    violations: [],
  });

const ruleIdForStatus = (status: OwnershipStatus): string | null => {
  switch (status) {
    case "unowned-critical":
      return "ownership/unowned-critical";
    case "ghosted":
      return "ownership/ghost-owner";
    case "drifted":
      return "ownership/drift";
    case "unknown":
      return "ownership/unknown";
    default:
      return null;
  }
};

describe("normalizeSarifUri", () => {
  it("always produces a relative POSIX path", () => {
    expect(normalizeSarifUri("packages\\core\\src\\index.ts")).toBe("packages/core/src/index.ts");
    expect(normalizeSarifUri("./src/app.ts")).toBe("src/app.ts");
    expect(normalizeSarifUri("/home/user/repo/src/app.ts")).toBe("home/user/repo/src/app.ts");
    expect(normalizeSarifUri("C:\\repo\\src\\app.ts")).toBe("repo/src/app.ts");
    expect(normalizeSarifUri("src/../app.ts")).toBe("app.ts");
  });
});

describe("buildOwnersSarif", () => {
  it("emits the SARIF envelope, four rules and the driver metadata", () => {
    const log = buildOwnersSarif(buildReport(), CONTEXT);

    expect(log.$schema).toBe(SARIF_SCHEMA_URI);
    expect(log.version).toBe("2.1.0");
    expect(log.version).toBe(SARIF_VERSION);

    const run = log.runs[0];
    expect(run?.tool.driver.name).toBe("CodeSentinel");
    expect(run?.tool.driver.version).toBe("1.2.3");
    expect(run?.tool.driver.informationUri).toBe(CODESENTINEL_INFORMATION_URI);
    expect(run?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "ownership/unowned-critical",
      "ownership/ghost-owner",
      "ownership/drift",
      "ownership/unknown",
    ]);
    expect(run?.tool.driver.rules.map((rule) => rule.name)).toEqual([
      "UnownedCritical",
      "GhostOwner",
      "Drift",
      "Unknown",
    ]);
    expect(run?.tool.driver.rules.map((rule) => rule.defaultConfiguration.level)).toEqual([
      "error",
      "error",
      "warning",
      "warning",
    ]);
    expect(run?.tool.driver.rules.map((rule) => rule.helpUri)).toEqual(
      Array.from({ length: 4 }, () => `${CODESENTINEL_INFORMATION_URI}#ownership-audit`),
    );
  });

  it("maps every finding to the matching rule and preserves report order", () => {
    const report = buildReport();
    const results = buildOwnersSarif(report, CONTEXT).runs[0]?.results ?? [];
    const expected = report.files
      .map((file) => ({ file, ruleId: ruleIdForStatus(file.status) }))
      .filter((entry): entry is { file: FileOwnershipAudit; ruleId: string } =>
        entry.ruleId === null ? false : true,
      );

    expect(results).toHaveLength(expected.length);
    expect(results.length).toBeGreaterThan(10);
    expect(results.map((result) => result.ruleId)).toEqual(expected.map((entry) => entry.ruleId));
    expect(
      results.map((result) => result.locations[0]?.physicalLocation.artifactLocation.uri),
    ).toEqual(expected.map((entry) => normalizeSarifUri(entry.file.filePath)));

    const rules = buildOwnersSarif(report, CONTEXT).runs[0]?.tool.driver.rules ?? [];
    results.forEach((result, index) => {
      const rule = rules[result.ruleIndex];
      expect(rule?.id).toBe(result.ruleId);
      expect(result.level).toBe(rule?.defaultConfiguration.level);
      expect(result.locations[0]?.physicalLocation.region.startLine).toBe(1);
      expect(expected[index]?.ruleId).toBe(result.ruleId);
    });
  });

  it("emits relatedLocations only when a CODEOWNERS line matched", () => {
    const report = buildReport();
    const results = buildOwnersSarif(report, CONTEXT).runs[0]?.results ?? [];
    const findings = report.files.filter((file) => ruleIdForStatus(file.status) !== null);

    results.forEach((result, index) => {
      const file = findings[index];
      if (file?.matchLine === null) {
        expect(result.relatedLocations).toBeUndefined();
        return;
      }

      expect(result.relatedLocations).toHaveLength(1);
      expect(result.relatedLocations?.[0]?.message.text).toBe(
        `Ownership declared in ${CODEOWNERS_SOURCE} line ${file?.matchLine}.`,
      );
      expect(result.relatedLocations?.[0]?.physicalLocation.artifactLocation.uri).toBe(
        CODEOWNERS_SOURCE,
      );
      expect(result.relatedLocations?.[0]?.physicalLocation.region.startLine).toBe(file?.matchLine);
    });
  });

  it("emits relative POSIX URIs for every location", () => {
    const log = buildOwnersSarif(buildReport(), CONTEXT);
    const locations =
      log.runs[0]?.results.flatMap((result) => [
        ...result.locations,
        ...(result.relatedLocations ?? []),
      ]) ?? [];

    expect(locations.length).toBeGreaterThan(0);
    for (const location of locations) {
      const uri = location.physicalLocation.artifactLocation.uri;
      expect(uri.startsWith("/")).toBe(false);
      expect(uri.includes("\\")).toBe(false);
      expect(uri.startsWith("./")).toBe(false);
      expect(uri.split("/")).not.toContain("..");
      expect(uri).not.toMatch(/^[A-Za-z]:/);
    }
  });

  it("builds stable fingerprints that depend only on the rule and the path", () => {
    const first = buildOwnersSarif(buildReport(), CONTEXT);
    const second = buildOwnersSarif(buildReport(), CONTEXT);
    const firstResults = first.runs[0]?.results ?? [];
    const secondResults = second.runs[0]?.results ?? [];

    expect(firstResults.map((result) => result.partialFingerprints)).toEqual(
      secondResults.map((result) => result.partialFingerprints),
    );

    for (const result of firstResults) {
      expect(result.partialFingerprints["codesentinel/v1"]).toMatch(/^[0-9a-f]{64}$/);
    }

    const duplicatePathResults = firstResults.filter(
      (result) =>
        result.locations[0]?.physicalLocation.artifactLocation.uri === "duplicate/path.ts",
    );
    expect(duplicatePathResults).toHaveLength(2);
    expect(duplicatePathResults[0]?.ruleId).not.toBe(duplicatePathResults[1]?.ruleId);
    expect(duplicatePathResults[0]?.partialFingerprints).not.toEqual(
      duplicatePathResults[1]?.partialFingerprints,
    );
  });

  it("keeps the four rules and no results when the audit is unavailable", () => {
    const report = buildOwnersReport({
      audit: {
        available: false,
        reason: "codeowners_not_found",
        warnings: ["No CODEOWNERS file was found."],
      },
      ref: "main",
      windowDays: 90,
      minCommits: 2,
      trackedFileCount: 10,
      thresholds: {
        failOn: "none",
        maxUnownedCritical: null,
        maxGhostOwners: null,
        maxDrift: null,
      },
      violations: [],
    });

    const run = buildOwnersSarif(report, CONTEXT).runs[0];

    expect(run?.tool.driver.rules).toHaveLength(4);
    expect(run?.results).toEqual([]);
  });

  it("serialises the same object the builder returns", () => {
    const report = buildReport();

    expect(JSON.parse(formatOwnersSarif(report, CONTEXT))).toEqual(
      buildOwnersSarif(report, CONTEXT),
    );
  });
});
