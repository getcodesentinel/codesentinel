import type { RiskHotspot } from "@codesentinel/core";
import type { FileOwnershipAudit, OwnershipAudit, OwnershipStatus } from "@codesentinel/ownership";
import { describe, expect, it } from "vitest";
import type { TrendPoint } from "../application/format-trend-output.js";
import { McpToolError } from "./errors.js";
import {
  changedFilesFromGitOutput,
  decodeCursor,
  encodeCursor,
  filterFindings,
  filterTrendByIsoDate,
  normalizePathPrefix,
  paginate,
  shortCommit,
  toFileOwner,
  toFindings,
  toHotspots,
  trendValue,
} from "./shapes.js";

const createFile = (filePath: string, status: OwnershipStatus): FileOwnershipAudit => ({
  filePath,
  declared: [],
  matchLine: null,
  status,
  observed: {
    commits: 0,
    recentCommits: 0,
    dormant: false,
    authors: 0,
    topAuthorId: null,
    topAuthorShare: null,
    busFactor: null,
    lastCommitUnix: null,
  },
  criticality: {
    fanIn: null,
    isHotspot: false,
    riskScore: null,
    isCritical: false,
  },
});

const createAudit = (files: readonly FileOwnershipAudit[]): OwnershipAudit => ({
  available: true,
  codeowners: {
    source: ".github/CODEOWNERS",
    entries: [],
    errors: [],
    ignoredSources: [],
  },
  metrics: {
    declaredCoveragePercent: 0,
    declaredCoverageCriticalPercent: 0,
    driftPercent: 0,
    ghostOwnerCount: 0,
    unownedCriticalCount: 0,
    singleOwnerModuleCount: 0,
  },
  ghostOwners: [],
  files,
  ignoredAuthors: [],
  warnings: [],
});

const createTrendPoint = (generatedAt: string, ownership: TrendPoint["ownership"]): TrendPoint => ({
  file: `${generatedAt}.json`,
  generatedAt,
  commit: null,
  riskScore: 40,
  healthScore: 70,
  ownership,
});

describe("toFindings", () => {
  it("maps the four finding statuses to the SARIF rule ids", () => {
    const findings = toFindings(
      createAudit([
        createFile("src/critical.ts", "unowned-critical"),
        createFile("src/ghost.ts", "ghosted"),
        createFile("src/drift.ts", "drifted"),
        createFile("src/unknown.ts", "unknown"),
        createFile("src/aligned.ts", "aligned"),
      ]),
    );

    expect(findings.map((finding) => finding.rule)).toEqual([
      "ownership/unowned-critical",
      "ownership/ghost-owner",
      "ownership/drift",
      "ownership/unknown",
    ]);
    expect(findings.map((finding) => finding.severity)).toEqual([
      "error",
      "error",
      "warning",
      "warning",
    ]);
    expect(findings[0]?.message).toBe(
      "src/critical.ts is a critical file without a declared owner",
    );
  });

  it("orders deterministically regardless of input order", () => {
    const files = [
      createFile("b/warning.ts", "unknown"),
      createFile("b/error.ts", "unowned-critical"),
      createFile("a/error.ts", "ghosted"),
      createFile("a/warning.ts", "drifted"),
    ];
    const first = toFindings(createAudit(files));
    const second = toFindings(createAudit([...files].reverse()));

    expect(first.map((finding) => finding.path)).toEqual([
      "b/error.ts",
      "a/error.ts",
      "a/warning.ts",
      "b/warning.ts",
    ]);
    expect(second).toEqual(first);
  });

  it("returns no findings when CODEOWNERS is unavailable", () => {
    expect(
      toFindings({
        available: false,
        reason: "codeowners_not_found",
        warnings: [],
      }),
    ).toEqual([]);
  });
});

describe("normalizePathPrefix", () => {
  it("normalizes dot, slash and backslash prefixes", () => {
    expect(normalizePathPrefix("./src")).toBe("src");
    expect(normalizePathPrefix("src/")).toBe("src");
    expect(normalizePathPrefix(".\\src\\lib")).toBe("src/lib");
    expect(normalizePathPrefix("")).toBe("");
    expect(normalizePathPrefix(".")).toBe("");
  });
});

describe("filterFindings", () => {
  const findings = toFindings(
    createAudit([
      createFile("src/critical.ts", "unowned-critical"),
      createFile("src/lib/ghost.ts", "ghosted"),
      createFile("test/drift.ts", "drifted"),
    ]),
  );

  it("matches a file and everything inside a directory prefix", () => {
    expect(filterFindings(findings, { path: "src" }).map((finding) => finding.path)).toEqual([
      "src/critical.ts",
      "src/lib/ghost.ts",
    ]);
    expect(filterFindings(findings, { path: "src/lib" }).map((finding) => finding.path)).toEqual([
      "src/lib/ghost.ts",
    ]);
  });

  it("filters by severity, rule and status", () => {
    expect(filterFindings(findings, { severity: "warning" })).toHaveLength(1);
    expect(filterFindings(findings, { rule: "ownership/ghost-owner" })).toHaveLength(1);
    expect(filterFindings(findings, { status: "drifted" })).toHaveLength(1);
  });
});

describe("cursor pagination", () => {
  it("round-trips cursors and treats an absent cursor as offset zero", () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(37))).toBe(37);
  });

  it("rejects garbage cursors", () => {
    expect(() => decodeCursor("garbage")).toThrow(McpToolError);
    try {
      decodeCursor("garbage");
    } catch (error) {
      expect((error as McpToolError).code).toBe("invalid_argument");
    }
  });

  it("handles empty, exact, next and last pages", () => {
    expect(paginate([], 0, 20)).toEqual({ page: [], nextCursor: null });

    const items = [1, 2, 3, 4, 5];
    expect(paginate(items, 0, 5)).toEqual({ page: items, nextCursor: null });

    const first = paginate(items, 0, 2);
    expect(first.page).toEqual([1, 2]);
    expect(first.nextCursor).not.toBeNull();

    const second = paginate(items, decodeCursor(first.nextCursor ?? undefined), 2);
    expect(second.page).toEqual([3, 4]);
    expect(decodeCursor(second.nextCursor ?? undefined)).toBe(4);

    const last = paginate(items, 4, 2);
    expect(last).toEqual({ page: [5], nextCursor: null });
    expect(paginate(items, 10, 2)).toEqual({ page: [], nextCursor: null });
  });

  it("keeps hotspot ranks absolute across pages", () => {
    const hotspots: RiskHotspot[] = [
      { file: "a.ts", score: 90, factors: { structural: 1, evolution: 2, external: 3 } },
      { file: "b.ts", score: 80, factors: { structural: 1, evolution: 2, external: 3 } },
      { file: "c.ts", score: 70, factors: { structural: 1, evolution: 2, external: 3 } },
    ];
    const page = paginate(hotspots, 1, 1);
    expect(toHotspots(page.page, 1)).toEqual([
      {
        rank: 2,
        path: "b.ts",
        score: 80,
        factors: { structural: 1, evolution: 2, external: 3 },
      },
    ]);
  });
});

describe("trend helpers", () => {
  const withOwnership = createTrendPoint("2026-02-01T00:00:00.000Z", {
    unownedCritical: 3,
    ghostOwners: 4,
    driftPercent: 12.5,
  });

  it("reads every metric, including missing ownership", () => {
    expect(trendValue(withOwnership, "riskScore")).toBe(40);
    expect(trendValue(withOwnership, "healthScore")).toBe(70);
    expect(trendValue(withOwnership, "unownedCriticalCount")).toBe(3);
    expect(trendValue(withOwnership, "ghostOwnerCount")).toBe(4);
    expect(trendValue(withOwnership, "driftPercent")).toBe(12.5);

    const withoutOwnership = createTrendPoint("2026-02-01T00:00:00.000Z", null);
    expect(trendValue(withoutOwnership, "unownedCriticalCount")).toBeNull();
    expect(trendValue(withoutOwnership, "ghostOwnerCount")).toBeNull();
    expect(trendValue(withoutOwnership, "driftPercent")).toBeNull();
  });

  it("filters ISO bounds inclusively", () => {
    const series = [
      createTrendPoint("2026-01-31T23:59:59.999Z", null),
      createTrendPoint("2026-02-01T00:00:00.000Z", null),
      createTrendPoint("2026-02-28T12:00:00.000Z", null),
      createTrendPoint("2026-02-28T23:59:59.999Z", null),
      createTrendPoint("2026-03-01T00:00:00.000Z", null),
    ];

    expect(
      filterTrendByIsoDate(series, { since: "2026-02-01", until: "2026-02-28" }).map(
        (point) => point.generatedAt,
      ),
    ).toEqual(["2026-02-01T00:00:00.000Z", "2026-02-28T12:00:00.000Z", "2026-02-28T23:59:59.999Z"]);

    expect(
      filterTrendByIsoDate(series, {
        since: "2026-02-28T12:00:00.000Z",
        until: "2026-02-28T12:00:00.000Z",
      }),
    ).toHaveLength(1);
  });
});

describe("changedFilesFromGitOutput", () => {
  it("normalizes CRLF, duplicates, empty lines and backslashes", () => {
    expect(changedFilesFromGitOutput("b.ts\r\n\r\na.ts\r\na.ts\n./c.ts\\d.ts\n")).toEqual([
      "a.ts",
      "b.ts",
      "c.ts/d.ts",
    ]);
  });
});

describe("shortCommit", () => {
  it("returns seven characters or null", () => {
    expect(shortCommit("0123456789abcdef")).toBe("0123456");
    expect(shortCommit("abc")).toBe("abc");
    expect(shortCommit(null)).toBeNull();
  });
});

describe("toFileOwner", () => {
  it("formats declared owners, teams and observed evidence", () => {
    const file: FileOwnershipAudit = {
      ...createFile("src/lib/math.ts", "unknown"),
      declared: [
        { kind: "team", org: "Acme", slug: "Math" },
        { kind: "user", handle: "Alice" },
        { kind: "email", address: "Bob@Example.com" },
      ],
      matchLine: 2,
      observed: {
        commits: 4,
        recentCommits: 2,
        dormant: false,
        authors: 2,
        topAuthorId: "alice@example.com",
        topAuthorShare: 0.75,
        busFactor: 0.5,
        lastCommitUnix: 1_700_000_000,
      },
    };

    expect(toFileOwner(file, "HEAD", ["warning"])).toEqual({
      path: "src/lib/math.ts",
      ref: "HEAD",
      owners: [
        { kind: "team", value: "@acme/math" },
        { kind: "user", value: "@alice" },
        { kind: "email", value: "bob@example.com" },
      ],
      teams: ["Acme/Math"],
      status: "unknown",
      matchLine: 2,
      topAuthor: { id: "alice@example.com", share: 0.75 },
      observed: {
        commits: 4,
        recentCommits: 2,
        authors: 2,
        dormant: false,
        busFactor: 0.5,
        lastCommitUnix: 1_700_000_000,
      },
      criticality: {
        isCritical: false,
        isHotspot: false,
        fanIn: null,
        riskScore: null,
      },
      warnings: ["warning"],
    });
  });
});
