import { describe, expect, it } from "vitest";
import { parseGitLog } from "./git-log-parser.js";

describe("parseGitLog", () => {
  it("parses commits and resolves renamed destination paths", () => {
    const raw = [
      "\u001eabc123\u001f1700000000\u001fAlice\u001fALICE@EXAMPLE.COM",
      "3\t1\tsrc/a.ts",
      "2\t0\tsrc/{old.ts => new.ts}",
      "",
      "\u001edef456\u001f1700003600\u001fBob\u001fbob@example.com",
      "-\t-\tassets/logo.png",
      "",
    ].join("\n");

    const commits = parseGitLog(raw);

    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: "abc123",
      authoredAtUnix: 1700000000,
      authorId: "alice@example.com",
    });
    expect(commits[0]?.fileChanges).toEqual([
      { filePath: "src/a.ts", additions: 3, deletions: 1 },
      { filePath: "src/new.ts", additions: 2, deletions: 0 },
    ]);

    expect(commits[1]?.fileChanges).toEqual([
      { filePath: "assets/logo.png", additions: 0, deletions: 0 },
    ]);
  });

  it("normalizes email casing and github noreply numeric prefixes", () => {
    const raw = [
      "\u001ea1\u001f1700000000\u001fAleix Alonso\u001fALEIXALONSO@HOTMAIL.COM",
      "1\t0\tsrc/a.ts",
      "",
      "\u001ea2\u001f1700001000\u001fAleix Alonso\u001faleixalonso@hotmail.com",
      "1\t0\tsrc/a.ts",
      "",
      "\u001ea3\u001f1700002000\u001fAleix Alonso\u001f64553911+aleixalonso@users.noreply.github.com",
      "1\t0\tsrc/a.ts",
      "",
      "\u001ea4\u001f1700003000\u001fdependabot[bot]\u001f49699333+dependabot[bot]@users.noreply.github.com",
      "1\t0\tsrc/a.ts",
      "",
    ].join("\n");

    const commits = parseGitLog(raw);

    expect(commits.map((commit) => commit.authorId)).toEqual([
      "aleixalonso@hotmail.com",
      "aleixalonso@hotmail.com",
      "aleixalonso@users.noreply.github.com",
      "49699333+dependabot[bot]@users.noreply.github.com",
    ]);
  });
});
