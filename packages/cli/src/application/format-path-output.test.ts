import type { DeclaredOwner } from "@codesentinel/ownership";
import type { ReadingPath, ReadingStep } from "@codesentinel/reading-path";
import { describe, expect, it } from "vitest";
import { PATH_SCHEMA_VERSION, buildPathPayload, formatPathOutput } from "./format-path-output.js";

const owners: readonly DeclaredOwner[] = [
  { kind: "user", handle: "alice" },
  { kind: "team", org: "acme", slug: "platform" },
  { kind: "email", address: "a@b.c" },
];

const step = (overrides: Partial<ReadingStep> = {}): ReadingStep => ({
  order: 1,
  filePath: "src/index.ts",
  role: "entry",
  reason: "entry point: 2 imports from outside the module",
  owner: owners,
  observedTopAuthor: "bob@example.com",
  commits: 3,
  churn: 99,
  fanInInternal: 0,
  testFiles: ["src/index.test.ts"],
  ...overrides,
});

const readingPath = (overrides: Partial<ReadingPath> = {}): ReadingPath => ({
  target: "src",
  targetKind: "directory",
  steps: [
    step(),
    step({
      order: 2,
      filePath: "src/helper.ts",
      role: "helper",
      reason: "co-changes with src/index.ts",
      owner: [],
      observedTopAuthor: null,
      commits: 1,
      churn: 5,
      fanInInternal: 2,
      testFiles: [],
    }),
  ],
  people: [{ authorId: "bob@example.com", files: ["src/index.ts"], commits: 3 }],
  commands: ["pnpm test"],
  warnings: ["example warning"],
  truncated: false,
  ...overrides,
});

describe("formatPathOutput console", () => {
  it("renders the exact console contract", () => {
    const expected = [
      "Reading path: src (directory)",
      "2 steps",
      "",
      " 1. src/index.ts  [entry]",
      "    entry point: 2 imports from outside the module",
      "    owner: @alice, @acme/platform, a@b.c · observed: bob@example.com · commits 3 · churn 99 · fan-in 0",
      "    tests: src/index.test.ts",
      " 2. src/helper.ts  [helper]",
      "    co-changes with src/index.ts",
      "    owner: none declared · observed: unknown · commits 1 · churn 5 · fan-in 2",
      "",
      "People to ask",
      " - bob@example.com (3 commits): src/index.ts",
      "",
      "Suggested commands (not discovered, not run)",
      " - pnpm test",
      "",
      "Warnings",
      " - example warning",
    ].join("\n");

    expect(formatPathOutput(readingPath(), "console")).toBe(expected);
  });

  it("surfaces truncation and renders an empty path without a trailing newline", () => {
    const truncated = readingPath({
      truncated: true,
      warnings: ["showing 1 of 2 files (truncated)"],
    });
    const consoleOutput = formatPathOutput(truncated, "console");
    expect(consoleOutput).toContain("2 steps (truncated)");
    expect(consoleOutput).toContain("Warnings\n - showing 1 of 2 files (truncated)");
    expect(consoleOutput.endsWith("\n")).toBe(false);

    const empty = readingPath({
      steps: [],
      people: [],
      commands: [],
      warnings: [],
      truncated: false,
    });
    expect(formatPathOutput(empty, "console")).toBe(
      "Reading path: src (directory)\n0 steps\n\nNo files to read.",
    );
    expect(formatPathOutput(empty, "md")).toContain("No files to read.");
  });
});

describe("formatPathOutput markdown", () => {
  it("renders the ordered list, steps table and the optional sections", () => {
    const markdown = formatPathOutput(readingPath(), "md");

    expect(markdown).toContain("## Reading path: `src`");
    expect(markdown).toContain("- target kind: `directory`");
    expect(markdown).toContain("- steps: 2");
    expect(markdown).toContain("1. **`src/index.ts`** — `entry`");
    expect(markdown).toContain(
      "   - owner: @alice, @acme/platform, a@b.c · observed: `bob@example.com` · commits `3` · churn `99` · fan-in `0`",
    );
    expect(markdown).toContain("   - tests: `src/index.test.ts`");
    expect(markdown).toContain("### Steps");
    expect(markdown).toContain(
      "| # | File | Role | Commits | Churn | Fan-in | Observed author | Declared owner | Tests |",
    );
    expect(markdown).toContain(
      "| 1 | `src/index.ts` | `entry` | 3 | 99 | 0 | `bob@example.com` | @alice, @acme/platform, a@b.c | `src/index.test.ts` |",
    );
    expect(markdown).toContain("### People to ask");
    expect(markdown).toContain("- `bob@example.com` (3 commits): `src/index.ts`");
    expect(markdown).toContain("### Suggested commands (not discovered, not run)");
    expect(markdown).toContain("- `pnpm test`");
    expect(markdown).toContain("### Warnings");
    expect(markdown).toContain("- example warning");
    expect(markdown).not.toContain("`@alice`");
    expect(markdown.endsWith("\n")).toBe(false);
  });

  it("escapes pipe characters in table cells", () => {
    const markdown = formatPathOutput(
      readingPath({ steps: [step({ filePath: "src/a|b.ts" })] }),
      "md",
    );

    expect(markdown).toContain("| 1 | `src/a\\|b.ts` |");
  });
});

describe("formatPathOutput json", () => {
  it("publishes the documented keys in order and serialises every owner kind", () => {
    const payload = buildPathPayload(readingPath());

    expect(Object.keys(payload)).toEqual([
      "schemaVersion",
      "target",
      "targetKind",
      "steps",
      "people",
      "commands",
      "warnings",
      "truncated",
    ]);
    expect(payload.schemaVersion).toBe(PATH_SCHEMA_VERSION);
    expect(payload.steps).toHaveLength(2);

    const firstStep = payload.steps[0];
    if (firstStep === undefined) throw new Error("expected a first step");

    expect(Object.keys(firstStep)).toEqual([
      "order",
      "filePath",
      "role",
      "reason",
      "owner",
      "observedTopAuthor",
      "commits",
      "churn",
      "fanInInternal",
      "testFiles",
    ]);
    expect(firstStep.owner).toEqual([
      { kind: "user", handle: "alice" },
      { kind: "team", org: "acme", slug: "platform" },
      { kind: "email", address: "a@b.c" },
    ]);
    expect(firstStep.owner?.map((owner) => Object.keys(owner))).toEqual([
      ["kind", "handle"],
      ["kind", "org", "slug"],
      ["kind", "address"],
    ]);
    expect(payload.steps[1]?.owner).toEqual([]);
  });

  it("keeps owner null when no ownership data is available", () => {
    const payload = buildPathPayload(readingPath({ steps: [step({ owner: null })] }));
    expect(payload.steps[0]?.owner).toBeNull();
  });

  it("is byte-identical across two calls", () => {
    const path = readingPath();
    expect(formatPathOutput(path, "json")).toBe(formatPathOutput(path, "json"));
  });
});
