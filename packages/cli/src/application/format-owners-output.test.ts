import { describe, expect, it } from "vitest";
import type { OwnershipAuditAvailable } from "@codesentinel/ownership";
import {
  OWNERS_SCHEMA_VERSION,
  buildOwnersReport,
  evaluateOwnersThresholds,
  formatDeclaredOwner,
  formatOwnersOutput,
  type OwnersThresholdConfig,
} from "./format-owners-output.js";

const thresholds = (overrides: Partial<OwnersThresholdConfig> = {}): OwnersThresholdConfig => ({
  failOn: "none",
  maxUnownedCritical: null,
  maxGhostOwners: null,
  maxDrift: null,
  ...overrides,
});

const audit = (): OwnershipAuditAvailable => ({
  available: true,
  codeowners: {
    source: ".github/CODEOWNERS",
    entries: [
      { pattern: "*", owners: [{ kind: "user", handle: "alice" }], line: 1, ignored: false },
      {
        pattern: "/payments/",
        owners: [{ kind: "team", org: "acme", slug: "ops-team" }],
        line: 2,
        ignored: false,
      },
    ],
    errors: [{ line: 5, reason: 'invalid owner "not-an-owner"' }],
    ignoredSources: ["docs/CODEOWNERS", "CODEOWNERS"],
  },
  metrics: {
    declaredCoveragePercent: 68,
    declaredCoverageCriticalPercent: 41.03,
    driftPercent: 23.29,
    ghostOwnerCount: 1,
    unownedCriticalCount: 1,
    singleOwnerModuleCount: 3,
  },
  ghostOwners: [{ owner: { kind: "user", handle: "marta" }, samplePaths: ["payments/refund.ts"] }],
  files: [
    {
      filePath: "payments/refund.ts",
      declared: [],
      matchLine: 7,
      status: "unowned-critical",
      observed: {
        commits: 31,
        recentCommits: 31,
        dormant: false,
        authors: 4,
        topAuthorId: "jordi@example.com",
        topAuthorShare: 0.71,
        busFactor: 2,
        lastCommitUnix: 1_790_000_000,
      },
      criticality: { fanIn: 12, isHotspot: true, riskScore: 61.5, isCritical: true },
    },
    {
      filePath: "api/webhooks.ts",
      declared: [{ kind: "team", org: "acme", slug: "ops-team" }],
      matchLine: 2,
      status: "drifted",
      observed: {
        commits: 44,
        recentCommits: 44,
        dormant: false,
        authors: 5,
        topAuthorId: "nuria@example.com",
        topAuthorShare: 0.64,
        busFactor: 2,
        lastCommitUnix: null,
      },
      criticality: { fanIn: 3, isHotspot: false, riskScore: 40, isCritical: true },
    },
    {
      filePath: "docs/readme.md",
      declared: [{ kind: "user", handle: "alice" }],
      matchLine: 1,
      status: "aligned",
      observed: {
        commits: 5,
        recentCommits: 5,
        dormant: false,
        authors: 1,
        topAuthorId: "alice@example.com",
        topAuthorShare: 1,
        busFactor: 1,
        lastCommitUnix: null,
      },
      criticality: { fanIn: 0, isHotspot: false, riskScore: 10, isCritical: false },
    },
  ],
  warnings: ["2 team owners cannot be verified offline; teams are never reported as ghost owners."],
});

const report = (overrides: Partial<Parameters<typeof buildOwnersReport>[0]> = {}) =>
  buildOwnersReport({
    audit: audit(),
    ref: "main",
    windowDays: 90,
    minCommits: 2,
    trackedFileCount: 214,
    thresholds: thresholds(),
    violations: [],
    ...overrides,
  });

describe("buildOwnersReport", () => {
  it("publishes a stable payload with fixed keys and no clock", () => {
    const built = report();

    expect(Object.keys(built)).toEqual([
      "schemaVersion",
      "available",
      "ref",
      "windowDays",
      "minCommits",
      "codeowners",
      "fileCounts",
      "metrics",
      "ghostOwners",
      "files",
      "warnings",
      "thresholds",
    ]);
    expect(built.schemaVersion).toBe(OWNERS_SCHEMA_VERSION);
    expect(JSON.stringify(built)).not.toMatch(/generatedAt|timestamp/i);
    expect(built.fileCounts).toEqual({
      trackedFiles: 214,
      declaredFiles: 2,
      criticalFiles: 2,
      declaredCriticalFiles: 1,
      driftedFiles: 1,
    });
  });

  it("sorts ignored sources, parse errors and warnings deterministically", () => {
    const built = report();

    expect(built.codeowners?.ignoredSources).toEqual(["CODEOWNERS", "docs/CODEOWNERS"]);
    expect(built.codeowners?.errors).toEqual([{ line: 5, reason: 'invalid owner "not-an-owner"' }]);
  });
});

describe("evaluateOwnersThresholds", () => {
  it("reports every exceeded threshold against the published metrics", () => {
    const metrics = audit().available ? audit().metrics : null;
    const violations = evaluateOwnersThresholds(metrics, {
      failOn: "error",
      maxUnownedCritical: 0,
      maxGhostOwners: 0,
      maxDrift: 0.2,
    });

    expect(violations.map((violation) => violation.threshold)).toEqual([
      "max-unowned-critical",
      "max-ghost-owners",
      "max-drift",
    ]);
    expect(violations[2]).toMatchObject({ limit: 0.2, actual: 0.2329 });
  });

  it("stays empty when the limits are not exceeded or nothing was configured", () => {
    expect(
      evaluateOwnersThresholds(audit().available ? audit().metrics : null, thresholds()),
    ).toEqual([]);
    expect(
      evaluateOwnersThresholds(
        audit().available ? audit().metrics : null,
        thresholds({ maxUnownedCritical: 1, maxGhostOwners: 1, maxDrift: 0.3 }),
      ),
    ).toEqual([]);
  });

  it("never evaluates thresholds when the audit is unavailable", () => {
    expect(
      evaluateOwnersThresholds(null, thresholds({ maxUnownedCritical: 0, maxDrift: 0 })),
    ).toEqual([]);
  });
});

describe("formatOwnersOutput", () => {
  it("renders the console shape from the design, without fixed-width tables", () => {
    const rendered = formatOwnersOutput(report(), "console", 10);

    expect(rendered).toContain("Ownership audit — 214 tracked files, window 90d, ref main");
    expect(rendered).toContain("CODEOWNERS .github/CODEOWNERS");
    expect(rendered).toMatch(/Declared coverage:\s+68% {2}\(2\/214\)/);
    expect(rendered).toMatch(/Critical coverage:\s+41\.03% {2}\(1\/2\)/);
    expect(rendered).toMatch(/Drift:\s+23\.29% {2}\(1\/2 declared files\)/);
    expect(rendered).toMatch(/Owners without activity:\s+1 owner/);
    expect(rendered).toMatch(/Unowned critical:\s+1/);
    expect(rendered).toMatch(/Single-owner modules:\s+3/);
    expect(rendered).toContain(
      "Unowned critical\n  payments/refund.ts  fan-in 12  commits 31  authors 4",
    );
    expect(rendered).toContain("declared @acme/ops-team  observed nuria@example.com (64%)");
    expect(rendered).toContain("Ghost owners — declared, no commits in the window");
    expect(rendered).toContain("@marta  payments/refund.ts");
    expect(rendered).toContain("Warnings");
    expect(rendered).not.toContain("| ---");
  });

  it("truncates sections to --top and says how many rows were hidden", () => {
    const rendered = formatOwnersOutput(report(), "console", 0);

    expect(rendered).toContain("Unowned critical\n  ... 1 more file");
    expect(rendered).toContain(
      "Drift — declared owner is not the top recent author\n  ... 1 more file",
    );
  });

  it("renders markdown that can be pasted into a pull request", () => {
    const rendered = formatOwnersOutput(report(), "md", 10);

    expect(rendered.startsWith("# Ownership audit")).toBe(true);
    expect(rendered).toContain("- ref: `main`");
    expect(rendered).toContain("- CODEOWNERS: `.github/CODEOWNERS`");
    expect(rendered).toContain("| Metric | Value |");
    expect(rendered).toContain("| Declared coverage | 68% (2/214) |");
    expect(rendered).toContain("## Unowned critical");
    expect(rendered).toContain("| `payments/refund.ts` | 12 | 31 | 4 |");
    expect(rendered).toContain("## Ghost owners — declared, no commits in the window");
  });

  it("serialises JSON in the payload order, with trailing newline handling left to the caller", () => {
    const first = formatOwnersOutput(report(), "json", 10);
    const second = formatOwnersOutput(report(), "json", 10);

    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(JSON.parse(second));
  });

  it("explains an unavailable audit instead of inventing metrics", () => {
    const unavailable = report({
      audit: {
        available: false,
        reason: "codeowners_not_found",
        warnings: ["No CODEOWNERS file was found; the ownership audit is unavailable."],
      },
    });

    const consoleOutput = formatOwnersOutput(unavailable, "console", 10);
    expect(consoleOutput).toContain("No CODEOWNERS file was found at main.");
    expect(consoleOutput).toContain("The ownership audit is unavailable.");
    expect(consoleOutput).not.toContain("Declared coverage");

    const markdown = formatOwnersOutput(unavailable, "md", 10);
    expect(markdown).toContain("- CODEOWNERS: not found");
    expect(markdown).toContain("The ownership audit is unavailable.");

    const json = JSON.parse(formatOwnersOutput(unavailable, "json", 10)) as {
      available: boolean;
      metrics: unknown;
    };
    expect(json.available).toBe(false);
    expect(json.metrics).toBeNull();
  });
});

describe("formatDeclaredOwner", () => {
  it("renders users, teams and email owners the way CODEOWNERS spells them", () => {
    expect(formatDeclaredOwner({ kind: "user", handle: "octocat" })).toBe("@octocat");
    expect(formatDeclaredOwner({ kind: "team", org: "acme", slug: "ops" })).toBe("@acme/ops");
    expect(formatDeclaredOwner({ kind: "email", address: "docs@example.com" })).toBe(
      "docs@example.com",
    );
  });
});
