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
});
