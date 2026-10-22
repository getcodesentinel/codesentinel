import { describe, expect, it } from "vitest";
import {
  PR_COMMENT_MARKER,
  PrCommentConfigurationError,
  hasPrCommentChanges,
  parsePrCommentInput,
  renderPrCommentBody,
} from "./format-pr-comment.js";

const fullInput = {
  current: {
    analysis: {
      risk: { riskScore: 42.13 },
      health: { healthScore: 78.4 },
    },
    ownership: {
      available: true,
      metrics: {
        unownedCriticalCount: 3,
        ghostOwnerCount: 1,
        driftPercent: 23.29,
      },
      files: [
        {
          filePath: "payments/refund.ts",
          status: "unowned-critical",
          declared: [],
          observed: { commits: 31, authors: 4, topAuthorId: "nuria@example.com" },
          criticality: { fanIn: 12 },
        },
        {
          filePath: "api/webhooks.ts",
          status: "ghosted",
          declared: [{ kind: "team", org: "acme", slug: "ops-team" }],
          observed: { commits: 44, topAuthorId: "nuria@example.com" },
          criticality: { fanIn: 3 },
        },
        {
          filePath: "api/drift.ts",
          status: "drifted",
          declared: [{ kind: "user", handle: "alice" }],
          observed: { topAuthorId: "nuria@example.com", topAuthorShare: 0.64 },
          criticality: { fanIn: 1 },
        },
        {
          filePath: "api/unknown.ts",
          status: "unknown",
          declared: [{ kind: "email", address: "ops@example.com" }],
          observed: {},
          criticality: {},
        },
      ],
    },
  },
  baseline: {
    analysis: { health: { healthScore: 78.6 } },
    ownership: {
      metrics: {
        unownedCriticalCount: 2,
        ghostOwnerCount: 1,
        driftPercent: 21.79,
      },
    },
  },
  diff: { riskScoreDelta: 0.42 },
};

const noBaselineInput = {
  current: {
    analysis: {
      risk: { riskScore: 42 },
      health: { healthScore: 78 },
    },
    ownership: {
      available: true,
      metrics: {
        unownedCriticalCount: 2,
        ghostOwnerCount: 0,
        driftPercent: 10,
      },
      files: [],
    },
  },
};

const noOwnershipInput = {
  current: {
    analysis: {
      risk: { riskScore: 42 },
      health: { healthScore: 78 },
    },
  },
  ownership: { available: false, metrics: null, warnings: [] },
};

describe("renderPrCommentBody", () => {
  it("renders deltas and offenders for a full CI payload", () => {
    const body = renderPrCommentBody(parsePrCommentInput(fullInput));

    expect(body).toMatchInlineSnapshot(`
      "<!-- codesentinel:summary -->

      ### CodeSentinel summary

      | Signal | Current | Delta |
      | --- | --- | --- |
      | Risk | 42.13 | +0.42 |
      | Health | 78.4 | -0.2 |
      | Unowned critical | 3 | +1 |
      | Ghost owners | 1 | 0 |
      | Drift | 23.29% | +1.5 pp |

      **Top offenders**

      | File | Status | Owner | Evidence |
      | --- | --- | --- | --- |
      | \`payments/refund.ts\` | unowned-critical | — | fan-in 12, 31 commits, 4 authors |
      | \`api/webhooks.ts\` | ghosted | @acme/ops-team | no commits in the window, top author nuria@example.com |
      | \`api/drift.ts\` | drifted | @alice | top author nuria@example.com (64%) |
      | \`api/unknown.ts\` | unknown | ops@example.com | ownership cannot be verified offline |"
    `);
  });

  it("renders n/a deltas when there is no baseline", () => {
    const body = renderPrCommentBody(parsePrCommentInput(noBaselineInput));

    expect(body).toMatchInlineSnapshot(`
      "<!-- codesentinel:summary -->

      ### CodeSentinel summary

      | Signal | Current | Delta |
      | --- | --- | --- |
      | Risk | 42 | n/a |
      | Health | 78 | n/a |
      | Unowned critical | 2 | n/a |
      | Ghost owners | 0 | n/a |
      | Drift | 10% | n/a |

      **Top offenders**

      No ownership findings."
    `);
  });

  it("renders the unavailable ownership line without inventing metrics", () => {
    const body = renderPrCommentBody(parsePrCommentInput(noOwnershipInput));

    expect(body).toMatchInlineSnapshot(`
      "<!-- codesentinel:summary -->

      ### CodeSentinel summary

      | Signal | Current | Delta |
      | --- | --- | --- |
      | Risk | 42 | n/a |
      | Health | 78 | n/a |
      | Unowned critical | n/a | n/a |
      | Ghost owners | n/a | n/a |
      | Drift | n/a | n/a |

      _Ownership audit unavailable: no CODEOWNERS file was found._

      **Top offenders**

      No ownership findings."
    `);
  });

  it("is deterministic and never embeds a timestamp", () => {
    const first = renderPrCommentBody(parsePrCommentInput(fullInput));
    const second = renderPrCommentBody(parsePrCommentInput(fullInput));

    expect(second).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("puts the marker on the first line and uses no other HTML", () => {
    const body = renderPrCommentBody(parsePrCommentInput(fullInput));

    expect(body.split("\n")[0]).toBe(PR_COMMENT_MARKER);
    expect(body.replace(PR_COMMENT_MARKER, "")).not.toContain("<");
  });
});

describe("parsePrCommentInput", () => {
  it("rejects non-objects and missing or invalid score fields", () => {
    expect(() => parsePrCommentInput(null)).toThrow(PrCommentConfigurationError);
    expect(() => parsePrCommentInput("payload")).toThrow("root");

    expect(() => parsePrCommentInput({})).toThrow("current");
    expect(() =>
      parsePrCommentInput({ current: { analysis: { risk: {}, health: { healthScore: 1 } } } }),
    ).toThrow("current.analysis.risk.riskScore");
    expect(() =>
      parsePrCommentInput({
        current: { analysis: { risk: { riskScore: 1 }, health: {} } },
      }),
    ).toThrow("current.analysis.health.healthScore");
    expect(() =>
      parsePrCommentInput({
        current: {
          analysis: { risk: { riskScore: "42" }, health: { healthScore: 78 } },
        },
      }),
    ).toThrow(PrCommentConfigurationError);
  });

  it("caps offenders at five and keeps the input order", () => {
    const files = Array.from({ length: 7 }, (_value, index) => ({
      filePath: `src/file-${index}.ts`,
      status: "unknown",
      declared: [{ kind: "user", handle: `owner-${index}` }],
      observed: {},
      criticality: {},
    }));

    const parsed = parsePrCommentInput({
      current: {
        analysis: {
          risk: { riskScore: 1 },
          health: { healthScore: 99 },
        },
        ownership: {
          available: true,
          metrics: {
            unownedCriticalCount: 0,
            ghostOwnerCount: 0,
            driftPercent: 0,
          },
          files,
        },
      },
    });

    expect(parsed.offenders).toHaveLength(5);
    expect(parsed.offenders.map((offender) => offender.filePath)).toEqual([
      "src/file-0.ts",
      "src/file-1.ts",
      "src/file-2.ts",
      "src/file-3.ts",
      "src/file-4.ts",
    ]);
  });
});

describe("hasPrCommentChanges", () => {
  it("treats a missing body as changed and ignores surrounding whitespace", () => {
    expect(hasPrCommentChanges(null, "body")).toBe(true);
    expect(hasPrCommentChanges("body\n", "body")).toBe(false);
    expect(hasPrCommentChanges("old", "new")).toBe(true);
  });
});
