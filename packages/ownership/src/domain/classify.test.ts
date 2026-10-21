import { describe, expect, it } from "vitest";
import type { DeclaredOwner } from "./codeowners.js";
import {
  CHURN_CRITICALITY_PERCENTILE,
  DEFAULT_FAN_IN_CRITICALITY_THRESHOLD,
  classifyOwnershipStatus,
  isCriticalFile,
  ownershipStatusRank,
  resolveCriticalityPolicy,
  type CriticalityEvidence,
  type OwnershipClassificationInput,
} from "./classify.js";
import type { OwnerResolution, OwnerResolutionKind } from "./identity.js";

const user = (handle: string): DeclaredOwner => ({ kind: "user", handle });

const resolution = (
  handle: string,
  kind: OwnerResolutionKind,
  activeAuthorIds: readonly string[] = [],
): OwnerResolution => ({ owner: user(handle), kind, activeAuthorIds });

const active = (handle: string, authorIds: readonly string[]): OwnerResolution =>
  resolution(handle, "email_local_part", authorIds);

const inactive = (handle: string): OwnerResolution => resolution(handle, "no_activity");

const classification = (
  overrides: Partial<OwnershipClassificationInput> = {},
): OwnershipClassificationInput => ({
  declaredCount: 1,
  isCritical: false,
  commits: 5,
  minCommits: 2,
  topAuthorId: "marta@company.com",
  hasAuthorEvidence: true,
  resolutions: [inactive("marta")],
  ...overrides,
});

describe("classifyOwnershipStatus", () => {
  it("matrix: no declaration is unowned, or unowned-critical when critical", () => {
    expect(classifyOwnershipStatus(classification({ declaredCount: 0, resolutions: [] }))).toBe(
      "unowned",
    );
    expect(
      classifyOwnershipStatus(
        classification({ declaredCount: 0, resolutions: [], isCritical: true }),
      ),
    ).toBe("unowned-critical");
  });

  it("matrix: a reset entry wins over any amount of evidence", () => {
    // A winning entry with no owners is a deliberate reset: unowned, never "no match".
    expect(
      classifyOwnershipStatus(
        classification({ declaredCount: 0, resolutions: [], commits: 500, isCritical: true }),
      ),
    ).toBe("unowned-critical");
  });

  it("matrix: below min-commits is insufficient-evidence, even with an active owner", () => {
    expect(
      classifyOwnershipStatus(
        classification({ commits: 1, resolutions: [active("marta", ["marta@company.com"])] }),
      ),
    ).toBe("insufficient-evidence");
  });

  it("matrix: no declared owner with activity is ghosted", () => {
    expect(classifyOwnershipStatus(classification())).toBe("ghosted");
  });

  it("matrix: top author among the declared owners is aligned", () => {
    expect(
      classifyOwnershipStatus(
        classification({ resolutions: [active("marta", ["marta@company.com"])] }),
      ),
    ).toBe("aligned");
  });

  it("matrix: an active declared owner that is not the top author is drifted", () => {
    expect(
      classifyOwnershipStatus(
        classification({
          topAuthorId: "nuria@company.com",
          resolutions: [active("marta", ["marta@company.com"])],
        }),
      ),
    ).toBe("drifted");
  });

  it("matrix: an unexpanded team downgrades a would-be ghost to unknown", () => {
    expect(
      classifyOwnershipStatus(
        classification({
          declaredCount: 2,
          resolutions: [inactive("marta"), resolution("ops-team", "team_unverified")],
        }),
      ),
    ).toBe("unknown");
  });

  it("matrix: an alias that never shows up downgrades a would-be ghost to unknown", () => {
    expect(
      classifyOwnershipStatus(
        classification({ resolutions: [resolution("marta", "alias_unresolved")] }),
      ),
    ).toBe("unknown");
  });

  it("reports unknown when commits exist but the author breakdown does not", () => {
    expect(
      classifyOwnershipStatus(classification({ hasAuthorEvidence: false, topAuthorId: null })),
    ).toBe("unknown");
  });

  it("ranks statuses by severity in a stable order", () => {
    const ranked = (
      [
        "aligned",
        "insufficient-evidence",
        "unknown",
        "unowned",
        "drifted",
        "ghosted",
        "unowned-critical",
      ] as const
    )
      .slice()
      .sort((a, b) => ownershipStatusRank(a) - ownershipStatusRank(b));

    expect(ranked).toEqual([
      "unowned-critical",
      "ghosted",
      "drifted",
      "unowned",
      "unknown",
      "insufficient-evidence",
      "aligned",
    ]);
  });
});

describe("criticality", () => {
  const structural = (fanIn: number | null, isHotspot = false, riskScore: number | null = null) => {
    const evidence: CriticalityEvidence = { fanIn, isHotspot, riskScore };
    return evidence;
  };

  it("uses fanIn >= 5 or hotspot by default", () => {
    const policy = resolveCriticalityPolicy([structural(6), structural(4), structural(1, true)]);

    expect(policy.structuralDataAvailable).toBe(true);
    expect(policy.churnThreshold).toBeNull();
    expect(isCriticalFile(structural(5), policy)).toBe(true);
    expect(isCriticalFile(structural(4), policy)).toBe(false);
    expect(isCriticalFile(structural(0, true), policy)).toBe(true);
    expect(isCriticalFile(undefined, policy)).toBe(false);
  });

  it("honours a custom fan-in threshold", () => {
    const policy = resolveCriticalityPolicy([structural(3)], { fanInThreshold: 3 });
    expect(isCriticalFile(structural(3), policy)).toBe(true);
  });

  it("falls back to hotspot plus churn when no file carries structural data", () => {
    const evidence: readonly CriticalityEvidence[] = [
      { fanIn: null, isHotspot: true, churnTotal: 10 },
      { fanIn: null, churnTotal: 20 },
      { fanIn: null, churnTotal: 30 },
      { fanIn: null, churnTotal: 40 },
      { fanIn: null, churnTotal: 50 },
      { fanIn: null, churnTotal: 60 },
      { fanIn: null, churnTotal: 70 },
      { fanIn: null, churnTotal: 80 },
      { fanIn: null, churnTotal: 90 },
      { fanIn: null, churnTotal: 100 },
    ];
    const policy = resolveCriticalityPolicy(evidence);

    expect(policy.structuralDataAvailable).toBe(false);
    // p90 of ten values with the nearest-rank method is the ninth value, 90.
    expect(policy.churnThreshold).toBe(90);
    expect(isCriticalFile({ fanIn: null, churnTotal: 95 }, policy)).toBe(true);
    expect(isCriticalFile({ fanIn: null, churnTotal: 80 }, policy)).toBe(false);
    expect(isCriticalFile({ fanIn: null, isHotspot: true, churnTotal: 0 }, policy)).toBe(true);
    expect(CHURN_CRITICALITY_PERCENTILE).toBe(0.9);
  });

  it("adds the risk score upper quartile when there are enough samples", () => {
    const policy = resolveCriticalityPolicy([
      { fanIn: 0, riskScore: 1 },
      { fanIn: 0, riskScore: 2 },
      { fanIn: 0, riskScore: 3 },
      { fanIn: 0, riskScore: 4 },
    ]);

    expect(policy.riskScoreThreshold).toBe(3);
    expect(isCriticalFile({ fanIn: 0, riskScore: 4 }, policy)).toBe(true);
    expect(isCriticalFile({ fanIn: 0, riskScore: 2 }, policy)).toBe(false);
  });

  it("ignores the risk score quartile with too few samples", () => {
    const policy = resolveCriticalityPolicy([
      { fanIn: 0, riskScore: 1 },
      { fanIn: 0, riskScore: 9 },
    ]);

    expect(policy.riskScoreThreshold).toBeNull();
    expect(isCriticalFile({ fanIn: 0, riskScore: 9 }, policy)).toBe(false);
    expect(DEFAULT_FAN_IN_CRITICALITY_THRESHOLD).toBe(5);
  });
});
