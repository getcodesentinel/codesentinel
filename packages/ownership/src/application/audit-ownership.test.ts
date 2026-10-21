import { describe, expect, it } from "vitest";
import { declaredOwnerKey } from "../domain/codeowners.js";
import type { OwnershipAuditAvailable } from "../domain/codeowners.js";
import { DEFAULT_MIN_COMMITS, auditOwnership } from "./audit-ownership.js";
import type { AuditOwnershipInput, OwnershipFileEvidence } from "./audit-ownership.js";
import { parseCodeowners } from "./parse-codeowners.js";

const CODEOWNERS_TEXT = `# Ownership map for the fixture repository
/apps/payments/  @marta @jordi
/apps/auth/      @acme/ops-team
/docs/           docs@example.com
/legacy/         @ghost
/quiet/          @quiet
/generated/
`;

const TRACKED_FILES = [
  "apps/payments/refund.ts",
  "apps/payments/ledger.ts",
  "apps/auth/session.ts",
  "docs/guide.md",
  "legacy/old.ts",
  "legacy/v1.ts",
  "legacy/archive/deep.ts",
  "quiet/notes.md",
  "generated/schema.ts",
  "infra/main.tf",
  "misc/tool.ts",
] as const;

const fixtureEvidence = (): OwnershipFileEvidence[] => [
  {
    filePath: "apps/payments/refund.ts",
    commits: 5,
    authors: [
      { authorId: "marta@company.com", commits: 4 },
      { authorId: "jordi@company.com", commits: 1 },
    ],
    lastCommitUnix: 1_700_000_000,
    busFactor: 2,
    criticality: { fanIn: 6 },
  },
  {
    filePath: "apps/payments/ledger.ts",
    commits: 4,
    authors: [
      { authorId: "nuria@company.com", commits: 3 },
      { authorId: "marta@company.com", commits: 1 },
    ],
    criticality: { fanIn: 3 },
  },
  {
    filePath: "apps/auth/session.ts",
    commits: 4,
    authors: [{ authorId: "someone@company.com", commits: 3 }],
    criticality: { fanIn: 9 },
  },
  {
    filePath: "docs/guide.md",
    commits: 3,
    authors: [{ authorId: "docs@example.com", commits: 3 }],
    criticality: { fanIn: 1 },
  },
  {
    filePath: "legacy/old.ts",
    commits: 3,
    authors: [{ authorId: "other@company.com", commits: 3 }],
    criticality: { fanIn: 1 },
  },
  {
    filePath: "legacy/v1.ts",
    commits: 2,
    authors: [{ authorId: "other@company.com", commits: 2 }],
    criticality: { fanIn: 1 },
  },
  {
    filePath: "legacy/archive/deep.ts",
    commits: 3,
    authors: [{ authorId: "third@company.com", commits: 3 }],
    criticality: { fanIn: 1 },
  },
  {
    filePath: "quiet/notes.md",
    commits: 1,
    authors: [{ authorId: "other@company.com", commits: 1 }],
    criticality: { fanIn: 1 },
  },
  {
    filePath: "generated/schema.ts",
    commits: 7,
    authors: [{ authorId: "someone@company.com", commits: 7 }],
    criticality: { fanIn: 12 },
  },
  {
    filePath: "infra/main.tf",
    commits: 3,
    authors: [{ authorId: "someone@company.com", commits: 3 }],
    criticality: { fanIn: 12 },
  },
  {
    filePath: "misc/tool.ts",
    commits: 3,
    authors: [{ authorId: "someone@company.com", commits: 3 }],
    criticality: { fanIn: 0 },
  },
];

const fixtureCodeowners = () => parseCodeowners(CODEOWNERS_TEXT, { source: "CODEOWNERS" });

const runAudit = (overrides: Partial<AuditOwnershipInput> = {}): OwnershipAuditAvailable => {
  const audit = auditOwnership({
    codeowners: fixtureCodeowners(),
    trackedFiles: [...TRACKED_FILES],
    evidence: fixtureEvidence(),
    ...overrides,
  });
  if (!audit.available) throw new Error("expected an available audit");
  return audit;
};

const statusOf = (audit: OwnershipAuditAvailable, filePath: string) =>
  audit.files.find((file) => file.filePath === filePath)?.status;

describe("auditOwnership", () => {
  it("defaults to two commits of evidence", () => {
    expect(DEFAULT_MIN_COMMITS).toBe(2);
  });

  it("classifies every state of the matrix with controlled evidence", () => {
    const audit = runAudit();

    expect(Object.fromEntries(audit.files.map((file) => [file.filePath, file.status]))).toEqual({
      "apps/payments/refund.ts": "aligned",
      "apps/payments/ledger.ts": "drifted",
      "apps/auth/session.ts": "unknown",
      "docs/guide.md": "aligned",
      "legacy/old.ts": "ghosted",
      "legacy/v1.ts": "ghosted",
      "legacy/archive/deep.ts": "ghosted",
      "quiet/notes.md": "insufficient-evidence",
      "generated/schema.ts": "unowned-critical",
      "infra/main.tf": "unowned-critical",
      "misc/tool.ts": "unowned",
    });
  });

  it("keeps the winning line of the entry and reports a reset as unowned, not unmatched", () => {
    const audit = runAudit();

    const generated = audit.files.find((file) => file.filePath === "generated/schema.ts");
    expect(generated?.matchLine).toBe(7);
    expect(generated?.declared).toEqual([]);
    expect(generated?.criticality.isCritical).toBe(true);

    const unmatched = audit.files.find((file) => file.filePath === "infra/main.tf");
    expect(unmatched?.matchLine).toBeNull();
    expect(unmatched?.declared).toEqual([]);
  });

  it("records the observed history with the top author excluded from bots", () => {
    const audit = runAudit();
    const refund = audit.files.find((file) => file.filePath === "apps/payments/refund.ts");

    expect(refund?.observed).toEqual({
      commits: 5,
      authors: 2,
      topAuthorId: "marta@company.com",
      topAuthorShare: 0.8,
      busFactor: 2,
      lastCommitUnix: 1_700_000_000,
    });
    expect(refund?.criticality).toEqual({
      fanIn: 6,
      isHotspot: false,
      riskScore: null,
      isCritical: true,
    });
  });

  it("computes the aggregate metrics over the tracked universe", () => {
    const audit = runAudit();

    expect(audit.metrics).toEqual({
      // 8 of 11 tracked files carry a declaration.
      declaredCoveragePercent: 72.73,
      // 2 of the 4 critical files are declared: refund.ts and session.ts.
      declaredCoverageCriticalPercent: 50,
      // 1 drifted file out of 8 declared files.
      driftPercent: 12.5,
      // @ghost (three files) and @jordi (co-owner of a drifted file).
      ghostOwnerCount: 2,
      unownedCriticalCount: 2,
      // docs, legacy and quiet each have a single declared owner across the module.
      singleOwnerModuleCount: 3,
    });
  });

  it("lists ghost owners with at most three sample paths, sorted", () => {
    const audit = runAudit();

    expect(audit.ghostOwners).toEqual([
      {
        owner: { kind: "user", handle: "ghost" },
        samplePaths: ["legacy/archive/deep.ts", "legacy/old.ts", "legacy/v1.ts"],
      },
      { owner: { kind: "user", handle: "jordi" }, samplePaths: ["apps/payments/ledger.ts"] },
    ]);
  });

  it("never counts an unexpanded team as a ghost and says so", () => {
    const audit = runAudit();

    expect(statusOf(audit, "apps/auth/session.ts")).toBe("unknown");
    expect(audit.ghostOwners.some((ghost) => ghost.owner.kind === "team")).toBe(false);
    expect(audit.warnings).toEqual([
      "1 team owner cannot be verified offline; teams are never reported as ghost owners.",
    ]);
  });

  it("does not call a quiet owner a ghost when the file lacks evidence", () => {
    const audit = runAudit();
    expect(audit.ghostOwners.some((ghost) => declaredOwnerKey(ghost.owner) === "@quiet")).toBe(
      false,
    );
  });

  it("orders files by status severity, criticality and path", () => {
    const audit = runAudit();

    expect(audit.files.map((file) => file.filePath)).toEqual([
      "generated/schema.ts",
      "infra/main.tf",
      "legacy/archive/deep.ts",
      "legacy/old.ts",
      "legacy/v1.ts",
      "apps/payments/ledger.ts",
      "misc/tool.ts",
      "apps/auth/session.ts",
      "quiet/notes.md",
      "apps/payments/refund.ts",
      "docs/guide.md",
    ]);
  });

  it("is byte-deterministic across runs and input orderings", () => {
    const first = JSON.stringify(runAudit());
    const second = JSON.stringify(runAudit());

    const shuffled = JSON.stringify(
      runAudit({
        trackedFiles: [...TRACKED_FILES].reverse(),
        evidence: fixtureEvidence().reverse(),
      }),
    );

    expect(second).toBe(first);
    expect(shuffled).toBe(first);
  });

  it("respects a custom min-commits", () => {
    const audit = runAudit({ minCommits: 5 });

    expect(statusOf(audit, "apps/payments/refund.ts")).toBe("aligned");
    expect(statusOf(audit, "apps/payments/ledger.ts")).toBe("insufficient-evidence");
  });

  it("resolves identities through the alias map", () => {
    const evidence: OwnershipFileEvidence[] = [
      {
        filePath: "payments/refund.ts",
        commits: 4,
        authors: [{ authorId: "marta.gil@company.com", commits: 4 }],
        criticality: { fanIn: 2 },
      },
    ];
    const base = {
      codeowners: parseCodeowners("/payments/ @marta\n"),
      trackedFiles: ["payments/refund.ts"],
      evidence,
    };

    expect(statusOf(runAudit(base), "payments/refund.ts")).toBe("ghosted");
    expect(
      statusOf(
        runAudit({ ...base, aliases: { marta: ["marta.gil@company.com"] } }),
        "payments/refund.ts",
      ),
    ).toBe("aligned");
  });

  it("degrades to unknown when declared owners come through an unresolved alias", () => {
    const audit = runAudit({
      codeowners: parseCodeowners("/payments/ @marta\n"),
      trackedFiles: ["payments/refund.ts"],
      evidence: [
        {
          filePath: "payments/refund.ts",
          commits: 4,
          authors: [{ authorId: "someone@company.com", commits: 4 }],
          criticality: { fanIn: 2 },
        },
      ],
      aliases: { marta: ["marta.gil@company.com"] },
    });

    expect(audit.files[0]?.status).toBe("unknown");
    expect(audit.ghostOwners).toEqual([]);
    expect(audit.metrics.ghostOwnerCount).toBe(0);
    expect(audit.warnings).toEqual([
      "1 declared owner has identity aliases that were not observed in the window; their files are reported as unknown.",
    ]);
  });

  it("does not attribute bot-only activity to a human owner", () => {
    const audit = runAudit({
      codeowners: parseCodeowners("/ci/ @marta\n"),
      trackedFiles: ["ci/pipeline.yml"],
      evidence: [
        {
          filePath: "ci/pipeline.yml",
          commits: 9,
          authors: [{ authorId: "marta[bot]@users.noreply.github.com", commits: 9 }],
          criticality: { fanIn: 1 },
        },
      ],
    });

    expect(audit.files[0]?.status).toBe("unknown");
    expect(audit.files[0]?.observed.topAuthorId).toBeNull();
    expect(audit.files[0]?.observed.authors).toBe(1);
    expect(audit.warnings).toContain(
      "1 declared file has commits but no human author evidence; they are reported as unknown.",
    );
  });

  it("falls back to hotspot plus churn when there is no structural data", () => {
    const trackedFiles = Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`);
    const audit = runAudit({
      codeowners: parseCodeowners("/src/file-8.ts @marta\n"),
      trackedFiles,
      evidence: trackedFiles.map((filePath, index) => ({
        filePath,
        commits: 3,
        authors: [{ authorId: "other@company.com", commits: 3 }],
        criticality: { fanIn: null, churnTotal: (index + 1) * 10 },
      })),
    });

    expect(audit.warnings).toContain(
      "No structural analysis available: criticality falls back to hotspots and churn (p90).",
    );
    // Churn 100 is the peak and 90 is the p90 cutoff: both files are critical without structure.
    expect(audit.files[0]?.filePath).toBe("src/file-9.ts");
    expect(audit.files[0]?.status).toBe("unowned-critical");
    expect(
      audit.files.find((file) => file.filePath === "src/file-8.ts")?.criticality.isCritical,
    ).toBe(true);
    expect(audit.metrics.unownedCriticalCount).toBe(1);
  });

  it("uses the hotspot flag for criticality when structure is missing", () => {
    const audit = runAudit({
      codeowners: parseCodeowners("/hot/ @marta\n"),
      trackedFiles: ["hot/a.ts", "cold/b.ts"],
      evidence: [
        {
          filePath: "hot/a.ts",
          commits: 3,
          authors: [{ authorId: "other@company.com", commits: 3 }],
          criticality: { fanIn: null, churnTotal: 5 },
        },
        {
          filePath: "cold/b.ts",
          commits: 3,
          authors: [{ authorId: "other@company.com", commits: 3 }],
          criticality: { fanIn: null, churnTotal: 1, isHotspot: true },
        },
      ],
    });

    expect(statusOf(audit, "hot/a.ts")).toBe("ghosted");
    expect(audit.files.find((file) => file.filePath === "cold/b.ts")?.status).toBe(
      "unowned-critical",
    );
  });

  it("warns about duplicate evidence and evidence outside the tracked universe", () => {
    const [firstEvidence] = fixtureEvidence();
    if (firstEvidence === undefined) throw new Error("fixture is missing its first evidence entry");

    const audit = runAudit({
      evidence: [
        ...fixtureEvidence(),
        { ...firstEvidence, commits: 99 },
        {
          filePath: "removed/file.ts",
          commits: 4,
          authors: [{ authorId: "x@company.com", commits: 4 }],
          criticality: { fanIn: 1 },
        },
      ],
    });

    expect(
      audit.files.find((file) => file.filePath === "apps/payments/refund.ts")?.observed.commits,
    ).toBe(5);
    expect(audit.warnings).toHaveLength(3);
    expect(audit.warnings[1]).toBe(
      "Ignored 1 duplicate file evidence entry: the first entry per path wins.",
    );
    expect(audit.warnings[2]).toBe("Ignored 1 file evidence entry outside the tracked universe.");
  });

  it("reports an unavailable audit when no CODEOWNERS was found", () => {
    const audit = auditOwnership({
      codeowners: null,
      trackedFiles: ["src/index.ts"],
      warnings: ["owners.json was not found."],
    });

    expect(audit).toEqual({
      available: false,
      reason: "codeowners_not_found",
      warnings: [
        "owners.json was not found.",
        "No CODEOWNERS file was found; the ownership audit is unavailable.",
      ],
    });
  });
});
