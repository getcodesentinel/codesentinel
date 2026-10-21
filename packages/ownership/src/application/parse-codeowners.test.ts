import { describe, expect, it } from "vitest";
import type { DeclaredOwner } from "../domain/codeowners.js";
import { CODEOWNERS_MAX_BYTES, CodeownersError } from "../domain/codeowners.js";
import {
  CODEOWNERS_CANDIDATE_PATHS,
  discoverCodeowners,
  parseCodeowners,
} from "./parse-codeowners.js";

const GITHUB_DOCS_FIXTURE = `# This is a comment.
# Each line is a file pattern followed by one or more owners.

# These owners will be the default owners for everything in
# the repo. Unless a later match takes precedence,
# @global-owner1 and @global-owner2 will be requested for
# review when someone opens a pull request.
*       @global-owner1 @global-owner2

# Order is important; the last matching pattern takes the most
# precedence. When someone opens a pull request that only
# modifies JS files, only @js-owner and not the global
# owner(s) will be requested for a review.
*.js    @js-owner

# You can also use email addresses if you prefer. They'll be
# used to look up users just like we do for commit author
# emails.
*.go docs@example.com

# Teams can be specified as code owners as well. Teams should
# be identified in the format @org/team-name.
*.txt @octo-org/octocats

# In this example, @doctocat owns any file in the \`/docs\`
# directory in the root of your repository and any of its
# subdirectories.
/docs/ @doctocat

# In this example, @octocat owns any file in the \`/apps\`
# directory in the root of your repository and any of its
# subdirectories.
/apps/ @octocat

# In this example, @octocat owns any file in an apps directory
# anywhere in the repository.
apps/ @octocat

# In this example, @doctocat owns any file in the \`/apps/github\`
# directory in the root of your repository and any of its
# subdirectories.
/apps/github @doctocat

# The \`docs/*\` pattern will match files like
# \`docs/getting-started.md\` but not further nested files like
# \`docs/build-app/troubleshooting.md\`.
docs/*  docs@example.com

# In this example, @doctocat owns any file in the build/logs
# directory in the repository root.
/build/logs/ @doctocat
`;

describe("parseCodeowners — GitHub documentation fixtures", () => {
  it("parses the documented example file in order and without errors", () => {
    const parsed = parseCodeowners(GITHUB_DOCS_FIXTURE, { source: ".github/CODEOWNERS" });

    expect(parsed.source).toBe(".github/CODEOWNERS");
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignoredSources).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.pattern, entry.owners, entry.ignored])).toEqual([
      [
        "*",
        [
          { kind: "user", handle: "global-owner1" },
          { kind: "user", handle: "global-owner2" },
        ],
        false,
      ],
      ["*.js", [{ kind: "user", handle: "js-owner" }], false],
      ["*.go", [{ kind: "email", address: "docs@example.com" }], false],
      ["*.txt", [{ kind: "team", org: "octo-org", slug: "octocats" }], false],
      ["/docs/", [{ kind: "user", handle: "doctocat" }], false],
      ["/apps/", [{ kind: "user", handle: "octocat" }], false],
      ["apps/", [{ kind: "user", handle: "octocat" }], false],
      ["/apps/github", [{ kind: "user", handle: "doctocat" }], false],
      ["docs/*", [{ kind: "email", address: "docs@example.com" }], false],
      ["/build/logs/", [{ kind: "user", handle: "doctocat" }], false],
    ]);
  });

  it("reports every entry with its 1-based source line", () => {
    const parsed = parseCodeowners(GITHUB_DOCS_FIXTURE);
    const fixtureLines = GITHUB_DOCS_FIXTURE.split("\n");
    const lines = parsed.entries.map((entry) => entry.line);

    expect(lines).toEqual([...lines].sort((left, right) => left - right));
    expect(new Set(lines).size).toBe(lines.length);
    for (const entry of parsed.entries) {
      expect(fixtureLines[entry.line - 1]?.startsWith(entry.pattern)).toBe(true);
    }
  });

  it("returns an empty, well-formed result for empty input", () => {
    expect(parseCodeowners("")).toEqual({
      source: "CODEOWNERS",
      entries: [],
      errors: [],
      ignoredSources: [],
    });
  });
});

describe("parseCodeowners — owners", () => {
  const ownerCases: readonly (readonly [
    pattern: string,
    line: string,
    owners: readonly DeclaredOwner[],
  ])[] = [
    [
      "*",
      "* @global-owner1 @global-owner2",
      [
        { kind: "user", handle: "global-owner1" },
        { kind: "user", handle: "global-owner2" },
      ],
    ],
    ["*.go", "*.go docs@example.com", [{ kind: "email", address: "docs@example.com" }]],
    ["*.txt", "*.txt @octo-org/octocats", [{ kind: "team", org: "octo-org", slug: "octocats" }]],
    ["*.js", "*.js @js-owner # inline comment", [{ kind: "user", handle: "js-owner" }]],
    [
      "src/app.ts",
      "src/app.ts @octocat docs@example.com @org/team",
      [
        { kind: "user", handle: "octocat" },
        { kind: "email", address: "docs@example.com" },
        { kind: "team", org: "org", slug: "team" },
      ],
    ],
  ];

  for (const [pattern, line, owners] of ownerCases) {
    it(`parses owners of "${line}"`, () => {
      const parsed = parseCodeowners(line);
      expect(parsed.entries).toEqual([{ pattern, owners, line: 1, ignored: false }]);
      expect(parsed.errors).toEqual([]);
    });
  }

  it("keeps a pattern with no owners as a valid, meaningful entry", () => {
    const parsed = parseCodeowners("* @global-owner\n/apps/github\n");

    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      {
        pattern: "*",
        owners: [{ kind: "user", handle: "global-owner" }],
        line: 1,
        ignored: false,
      },
      { pattern: "/apps/github", owners: [], line: 2, ignored: false },
    ]);
  });

  const invalidOwnerCases: readonly (readonly [line: string, reason: string])[] = [
    ["*.js bob", 'invalid owner "bob"'],
    ["*.js @", 'invalid owner "@"'],
    ["*.js @org/", 'invalid owner "@org/"'],
    ["*.js @/team", 'invalid owner "@/team"'],
    ["*.js @org/team/extra", 'invalid owner "@org/team/extra"'],
    ["*.js @a@b", 'invalid owner "@a@b"'],
    ["*.js @org/team bob", 'invalid owner "bob"'],
  ];

  for (const [line, reason] of invalidOwnerCases) {
    it(`flags malformed owners in "${line}"`, () => {
      const parsed = parseCodeowners(line);

      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]).toMatchObject({ ignored: true, line: 1 });
      expect(parsed.errors).toEqual([{ line: 1, reason }]);
    });
  }

  it("keeps the well-formed owners of an invalid line for diagnostics", () => {
    const parsed = parseCodeowners("*.js @js-owner bob");

    expect(parsed.entries[0]?.owners).toEqual([{ kind: "user", handle: "js-owner" }]);
    expect(parsed.entries[0]?.ignored).toBe(true);
    expect(parsed.errors).toEqual([{ line: 1, reason: 'invalid owner "bob"' }]);
  });

  it("reports one error per malformed owner token", () => {
    const parsed = parseCodeowners("*.js bob alice");

    expect(parsed.errors).toEqual([
      { line: 1, reason: 'invalid owner "bob"' },
      { line: 1, reason: 'invalid owner "alice"' },
    ]);
  });
});

describe("parseCodeowners — comments and unsupported syntax", () => {
  it("ignores full-line comments, including indented ones", () => {
    const parsed = parseCodeowners("# * @owner\n   # *.js @other\n\t# @third\n");

    expect(parsed.entries).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  it("strips inline comments after whitespace", () => {
    const parsed = parseCodeowners("* @owner\t# team-wide default\n*.js @js  # js files\n");

    expect(parsed.entries.map((entry) => [entry.pattern, entry.owners])).toEqual([
      ["*", [{ kind: "user", handle: "owner" }]],
      ["*.js", [{ kind: "user", handle: "js" }]],
    ]);
  });

  it("treats # after whitespace as a comment start, so the pattern keeps no owners", () => {
    const parsed = parseCodeowners("docs/ #anchor @owner\n");

    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([{ pattern: "docs/", owners: [], line: 1, ignored: false }]);
  });

  it("keeps # inside a pattern when it is not preceded by whitespace", () => {
    const parsed = parseCodeowners("docs/#anchor @owner\n");

    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      {
        pattern: "docs/#anchor",
        owners: [{ kind: "user", handle: "owner" }],
        line: 1,
        ignored: false,
      },
    ]);
  });

  it("keeps ! and [ ] as literal pattern characters instead of gitignore operators", () => {
    const parsed = parseCodeowners("!*.js @owner\n[abc].ts @owner2\n");

    expect(parsed.entries.map((entry) => [entry.pattern, entry.ignored])).toEqual([
      ["!*.js", false],
      ["[abc].ts", false],
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("flags a pattern that cannot match any path", () => {
    const parsed = parseCodeowners("// @owner\n");

    expect(parsed.entries).toEqual([
      { pattern: "//", owners: [{ kind: "user", handle: "owner" }], line: 1, ignored: true },
    ]);
    expect(parsed.errors).toEqual([{ line: 1, reason: 'invalid pattern "//"' }]);
  });

  it("flags patterns containing control characters", () => {
    const parsed = parseCodeowners("src/a\u0001b.ts @owner\n");

    expect(parsed.entries[0]?.ignored).toBe(true);
    expect(parsed.errors).toEqual([{ line: 1, reason: 'invalid pattern "src/a\u0001b.ts"' }]);
  });
});

describe("parseCodeowners — line handling", () => {
  it("skips blank and whitespace-only lines while keeping real line numbers", () => {
    const parsed = parseCodeowners("# header\n\n   \n*.js @a\n");

    expect(parsed.entries).toEqual([
      { pattern: "*.js", owners: [{ kind: "user", handle: "a" }], line: 4, ignored: false },
    ]);
  });

  it("handles CRLF input and reports lines on the invalid one", () => {
    const parsed = parseCodeowners("# comment\r\n*.js @a\r\n\r\n*.ts bob\r\n");

    expect(parsed.entries.map((entry) => [entry.pattern, entry.line, entry.ignored])).toEqual([
      ["*.js", 2, false],
      ["*.ts", 4, true],
    ]);
    expect(parsed.entries[0]?.owners).toEqual([{ kind: "user", handle: "a" }]);
    expect(parsed.errors).toEqual([{ line: 4, reason: 'invalid owner "bob"' }]);
  });

  it("strips a UTF-8 BOM before parsing", () => {
    const parsed = parseCodeowners("\uFEFF*.js @a\n");

    expect(parsed.entries[0]?.pattern).toBe("*.js");
  });

  it("keeps entries in file order", () => {
    const parsed = parseCodeowners("b/ @b\na/ @a\n* @all\n");

    expect(parsed.entries.map((entry) => entry.pattern)).toEqual(["b/", "a/", "*"]);
  });
});

describe("parseCodeowners — size limit", () => {
  it("accepts content of exactly 3 MB", () => {
    const text = Buffer.alloc(CODEOWNERS_MAX_BYTES, 0x61).toString("utf8");
    const parsed = parseCodeowners(text);

    expect(CODEOWNERS_MAX_BYTES).toBe(3 * 1024 * 1024);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.errors).toEqual([]);
  });

  it("rejects content above 3 MB with an explicit too-large error", () => {
    const text = Buffer.alloc(CODEOWNERS_MAX_BYTES + 1, 0x61).toString("utf8");

    expect(() => parseCodeowners(text)).toThrow(CodeownersError);
    try {
      parseCodeowners(text);
    } catch (error) {
      expect(error).toBeInstanceOf(CodeownersError);
      expect((error as CodeownersError).code).toBe("codeowners_too_large");
      expect((error as CodeownersError).message).toContain("3145728");
    }
  });

  it("measures the limit in bytes, not characters", () => {
    const text = "é".repeat(CODEOWNERS_MAX_BYTES / 2 + 1);

    expect(text.length).toBeLessThan(CODEOWNERS_MAX_BYTES);
    expect(() => parseCodeowners(text)).toThrow(/above the 3145728 byte limit/);
  });
});

describe("parseCodeowners — options", () => {
  it("defaults the source and carries ignored sources", () => {
    const parsed = parseCodeowners("* @a", { ignoredSources: ["docs/CODEOWNERS"] });

    expect(parsed.source).toBe("CODEOWNERS");
    expect(parsed.ignoredSources).toEqual(["docs/CODEOWNERS"]);
  });

  it("uses an explicit source", () => {
    expect(parseCodeowners("* @a", { source: "docs/CODEOWNERS" }).source).toBe("docs/CODEOWNERS");
  });
});

describe("discoverCodeowners", () => {
  it("prefers .github/CODEOWNERS and lists the rest as ignored", () => {
    expect(discoverCodeowners(["docs/CODEOWNERS", "CODEOWNERS", ".github/CODEOWNERS"])).toEqual({
      source: ".github/CODEOWNERS",
      ignoredSources: ["CODEOWNERS", "docs/CODEOWNERS"],
    });
  });

  it("falls back to the repository root and then docs", () => {
    expect(discoverCodeowners(["docs/CODEOWNERS", "CODEOWNERS"])).toEqual({
      source: "CODEOWNERS",
      ignoredSources: ["docs/CODEOWNERS"],
    });
    expect(discoverCodeowners(["docs/CODEOWNERS"])).toEqual({
      source: "docs/CODEOWNERS",
      ignoredSources: [],
    });
  });

  it("returns null when no candidate exists", () => {
    expect(discoverCodeowners(["CODEOWNERS.md", "src/CODEOWNERS"])).toBeNull();
    expect(discoverCodeowners([])).toBeNull();
  });

  it("normalizes ./ and leading / in the discovered paths", () => {
    expect(discoverCodeowners(["./CODEOWNERS", "/docs/CODEOWNERS"])).toEqual({
      source: "CODEOWNERS",
      ignoredSources: ["docs/CODEOWNERS"],
    });
  });

  it("exposes the documented lookup order", () => {
    expect(CODEOWNERS_CANDIDATE_PATHS).toEqual([
      ".github/CODEOWNERS",
      "CODEOWNERS",
      "docs/CODEOWNERS",
    ]);
  });
});
