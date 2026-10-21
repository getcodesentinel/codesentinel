import { describe, expect, it } from "vitest";
import { parseCodeowners } from "../application/parse-codeowners.js";
import { CodeownersError } from "./codeowners.js";
import {
  compileCodeownersPattern,
  createCodeownersMatcher,
  findOwningEntry,
  matchCodeownersPattern,
} from "./matcher.js";

const MATCH_CASES: readonly (readonly [pattern: string, filePath: string, expected: boolean])[] = [
  // `*` — everything, root included.
  ["*", "README.md", true],
  ["*", "apps/web/index.ts", true],

  // `*.js` — no internal slash, so it matches at any depth.
  ["*.js", "index.js", true],
  ["*.js", "src/deep/nested/index.js", true],
  ["*.js", "index.ts", false],
  ["*.js", "index.jsx", false],
  ["*.js", "src/index.json", false],

  // `/build/logs/` — root directory and its subtree only.
  ["/build/logs/", "build/logs/run.log", true],
  ["/build/logs/", "build/logs/2026/01/run.log", true],
  ["/build/logs/", "src/build/logs/run.log", false],
  ["/build/logs/", "build/logsb/run.log", false],
  ["/build/logs/", "build/logs", false],

  // `docs/*` — one level, not recursive.
  ["docs/*", "docs/getting-started.md", true],
  ["docs/*", "docs/build-app/troubleshooting.md", false],
  ["docs/*", "other/docs/getting-started.md", false],

  // `apps/` — any `apps` directory at any level.
  ["apps/", "apps/web/index.ts", true],
  ["apps/", "packages/apps/index.ts", true],
  ["apps/", "myapps/index.ts", false],
  ["apps/", "apps", false],

  // A directory without trailing slash owns its subtree too (GitHub docs: `/apps/github`).
  ["apps", "apps/web/index.ts", true],
  ["apps", "src/apps/web/index.ts", true],
  ["apps", "apps.ts", false],
  ["apps", "myapps/index.ts", false],
  ["/apps/github", "apps/github/index.ts", true],
  ["/apps/github", "apps/github/deep/index.ts", true],
  ["/apps/github", "apps/github", true],
  ["/apps/github", "apps/githubx/index.ts", false],
  ["/apps/github", "src/apps/github/index.ts", false],

  // `/docs/` — root only.
  ["/docs/", "docs/a.md", true],
  ["/docs/", "src/docs/a.md", false],

  // `**` crosses segments.
  ["docs/**", "docs/a.md", true],
  ["docs/**", "docs/a/b/c.md", true],
  ["docs/**", "other/docs/a.md", false],
  ["**/logs", "logs/app.log", true],
  ["**/logs", "src/logs/app.log", true],
  ["**/logs", "src/a/b/logs/deep/app.log", true],
  ["**/logs", "src/logs.txt", false],
  ["**/logs", "src/mylogs/app.log", false],
  ["src/**/test/*.ts", "src/test/a.ts", true],
  ["src/**/test/*.ts", "src/unit/test/a.ts", true],
  ["src/**/test/*.ts", "src/unit/test/deep/a.ts", false],

  // `?` matches exactly one character and never crosses a segment.
  ["?.md", "a.md", true],
  ["?.md", "ab.md", false],
  ["?.md", "docs/a.md", true],
  ["src/?.ts", "src/a.ts", true],
  ["src/?.ts", "src/ab.ts", false],
  ["src/?.ts", "lib/src/a.ts", false],

  // Case-sensitive on every platform.
  ["*.JS", "a.js", false],
  ["*.js", "a.JS", false],
  ["Docs/*", "docs/a.md", false],
  ["docs/*", "Docs/a.md", false],

  // GitHub does not implement negation or character classes: they stay literal.
  ["!*.js", "a.js", false],
  ["!*.js", "!a.js", true],
  ["[abc].ts", "a.ts", false],
  ["[abc].ts", "[abc].ts", true],
  ["a[bc]d.ts", "abd.ts", false],

  // Regex metacharacters in patterns are literals.
  ["src/(a)+.ts", "src/(a)+.ts", true],
  ["src/(a)+.ts", "src/aaa.ts", false],

  // Candidate paths are repo-relative; leading `./` and `/` are tolerated.
  ["src/*.js", "./src/a.js", true],
  ["src/*.js", "/src/a.js", true],
  ["src/*.js", "src/a.js/", true],
];

describe("matcher — gitignore-compatible pattern semantics", () => {
  for (const [pattern, filePath, expected] of MATCH_CASES) {
    it(`"${pattern}" ${expected ? "matches" : "does not match"} "${filePath}"`, () => {
      expect(matchCodeownersPattern(pattern, filePath)).toBe(expected);
    });
  }
});

describe("matcher — last match wins", () => {
  const parse = (text: string) => parseCodeowners(text).entries;

  it("lets a later entry override an earlier one", () => {
    const matcher = createCodeownersMatcher(
      parse("*       @global\n*.js    @js-owner\nsrc/**/*.ts @ts-team\n"),
    );

    expect(matcher("README.md")).toMatchObject({ pattern: "*", line: 1 });
    expect(matcher("a.js")).toMatchObject({ pattern: "*.js", line: 2 });
    expect(matcher("src/a/b.ts")).toMatchObject({ pattern: "src/**/*.ts", line: 3 });
  });

  it("treats an ownerless entry as an explicit clear of the subtree", () => {
    const matcher = createCodeownersMatcher(parse("* @global\nsrc/**/*.ts\n"));

    expect(matcher("src/a.ts")).toMatchObject({ pattern: "src/**/*.ts", owners: [] });
    expect(matcher("lib/a.ts")).toMatchObject({ pattern: "*", line: 1 });
  });

  it("resets ownership below an ownerless directory entry", () => {
    const matcher = createCodeownersMatcher(
      parse("* @global\n/apps/github @doctocat\n/apps/github/legacy\n"),
    );

    expect(matcher("apps/github/index.ts")).toMatchObject({
      owners: [{ kind: "user", handle: "doctocat" }],
    });
    expect(matcher("apps/github/legacy/old.ts")).toMatchObject({
      pattern: "/apps/github/legacy",
      owners: [],
    });
    expect(matcher("apps/web/index.ts")).toMatchObject({ pattern: "*" });
  });

  it("skips ignored lines instead of letting them win", () => {
    const entries = parse("*.js bob\n* @global\n");
    const matcher = createCodeownersMatcher(entries);

    expect(entries[0]?.ignored).toBe(true);
    expect(matcher("a.js")).toMatchObject({ pattern: "*", line: 2 });
  });

  it("returns null when nothing matches", () => {
    const matcher = createCodeownersMatcher(parse("docs/ @docs\n"));

    expect(matcher("src/index.ts")).toBeNull();
    expect(matcher("")).toBeNull();
    expect(createCodeownersMatcher([])("a.ts")).toBeNull();
  });

  it("is deterministic across repeated calls and recompilations", () => {
    const entries = parse("* @global\n*.js @js\n*.js @js-second\n");

    expect(createCodeownersMatcher(entries)("a.js")).toMatchObject({ line: 3 });
    expect(createCodeownersMatcher(entries)("a.js")).toMatchObject({ line: 3 });
    expect(findOwningEntry(entries, "a.js")).toMatchObject({ line: 3 });
  });
});

describe("matcher — compileCodeownersPattern", () => {
  it("compiles to an anchored, case-sensitive expression", () => {
    const compiled = compileCodeownersPattern("*.js");

    expect(compiled.pattern).toBe("*.js");
    expect(compiled.regex.test("a.js")).toBe(true);
    expect(compiled.regex.test("src/a.js")).toBe(true);
    expect(compiled.regex.test("a.JS")).toBe(false);
    expect(compiled.regex.flags).not.toContain("i");
  });

  it("rejects patterns that cannot match any path", () => {
    for (const pattern of ["", "/", "   ", "///"]) {
      expect(() => compileCodeownersPattern(pattern)).toThrow(CodeownersError);
      try {
        compileCodeownersPattern(pattern);
      } catch (error) {
        expect((error as CodeownersError).code).toBe("codeowners_invalid_pattern");
      }
    }
  });
});
