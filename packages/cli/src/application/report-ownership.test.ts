import { describe, expect, it } from "vitest";
import type { OwnershipAudit, OwnershipAuditAvailable } from "@codesentinel/ownership";
import { normalizeRepositoryWebUrl, toOwnershipAuditReport } from "./report-ownership.js";

describe("normalizeRepositoryWebUrl", () => {
  const cases: ReadonlyArray<{ input: string; expected: string | null }> = [
    {
      input: "git@github.com:getcodesentinel/codesentinel.git",
      expected: "https://github.com/getcodesentinel/codesentinel",
    },
    {
      input: "ssh://git@github.com/getcodesentinel/codesentinel.git",
      expected: "https://github.com/getcodesentinel/codesentinel",
    },
    {
      input: "https://github.com/getcodesentinel/codesentinel.git",
      expected: "https://github.com/getcodesentinel/codesentinel",
    },
    {
      input: "https://github.com/getcodesentinel/codesentinel.git/",
      expected: "https://github.com/getcodesentinel/codesentinel",
    },
    {
      input: "https://github.com/getcodesentinel/codesentinel",
      expected: "https://github.com/getcodesentinel/codesentinel",
    },
    { input: "/home/aleix/projects/codesentinel", expected: null },
    { input: "file:///home/aleix/projects/codesentinel", expected: null },
    { input: "", expected: null },
  ];

  it.each(cases)("normalizes $input", ({ input, expected }) => {
    expect(normalizeRepositoryWebUrl(input)).toBe(expected);
  });
});

const auditAvailable: OwnershipAuditAvailable = {
  available: true,
  codeowners: {
    source: ".github/CODEOWNERS",
    entries: [
      {
        pattern: "*",
        owners: [{ kind: "user", handle: "alice" }],
        line: 1,
        ignored: false,
      },
    ],
    errors: [{ line: 3, reason: "invalid pattern" }],
    ignoredSources: ["CODEOWNERS"],
  },
  metrics: {
    declaredCoveragePercent: 75,
    declaredCoverageCriticalPercent: 50,
    driftPercent: 25,
    ghostOwnerCount: 1,
    unownedCriticalCount: 2,
    singleOwnerModuleCount: 3,
  },
  ghostOwners: [
    {
      owner: { kind: "team", org: "acme", slug: "platform" },
      samplePaths: ["src/a.ts"],
    },
  ],
  files: [
    {
      filePath: "src/a.ts",
      declared: [{ kind: "user", handle: "alice" }],
      matchLine: 1,
      status: "aligned",
      observed: {
        commits: 4,
        recentCommits: 2,
        dormant: false,
        authors: 1,
        topAuthorId: "alice@example.com",
        topAuthorShare: 1,
        busFactor: 1,
        lastCommitUnix: 1_700_000_000,
      },
      criticality: {
        fanIn: 8,
        isHotspot: true,
        riskScore: 72,
        isCritical: true,
      },
    },
  ],
  warnings: ["Teams cannot be verified offline."],
};

describe("toOwnershipAuditReport", () => {
  it("copies available audits field by field and drops parsed entries", () => {
    const result = toOwnershipAuditReport(auditAvailable);

    expect(result).toEqual({
      available: true,
      codeowners: {
        source: ".github/CODEOWNERS",
        ignoredSources: ["CODEOWNERS"],
        errors: [{ line: 3, reason: "invalid pattern" }],
      },
      metrics: auditAvailable.metrics,
      ghostOwners: auditAvailable.ghostOwners,
      files: auditAvailable.files,
      warnings: auditAvailable.warnings,
    });
    expect(result.available && "entries" in result.codeowners).toBe(false);
  });

  it("keeps unavailable audits unavailable with their reason", () => {
    const audit: OwnershipAudit = {
      available: false,
      reason: "codeowners_not_found",
      warnings: ["No CODEOWNERS file was found."],
    };

    expect(toOwnershipAuditReport(audit)).toEqual({
      available: false,
      reason: "codeowners_not_found",
      warnings: ["No CODEOWNERS file was found."],
    });
  });
});
