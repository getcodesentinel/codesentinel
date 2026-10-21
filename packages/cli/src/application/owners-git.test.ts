import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitIdentityEnvironment,
  runGit,
  stripInheritedGitVariables,
} from "../test-support/git-fixture.js";
import {
  collectOwnershipEvidence,
  normalizeGitAuthorIdentity,
  normalizeRepositoryPath,
  readRepositorySnapshot,
} from "./owners-git.js";

stripInheritedGitVariables();

describe("normalizeGitAuthorIdentity", () => {
  it("collapses numeric-prefixed GitHub noreply addresses to the handle form used by CODEOWNERS", () => {
    expect(normalizeGitAuthorIdentity("Marta Gil", "64553911+marta@users.noreply.github.com")).toBe(
      "marta@users.noreply.github.com",
    );
  });

  it("keeps the bare noreply address and lowercases plain emails", () => {
    expect(normalizeGitAuthorIdentity("Marta", "Marta@users.noreply.github.com")).toBe(
      "marta@users.noreply.github.com",
    );
    expect(normalizeGitAuthorIdentity("Marta Gil", "Marta.Gil@Example.com")).toBe(
      "marta.gil@example.com",
    );
  });

  it("keeps the bot marker so bots never resolve to a human handle", () => {
    expect(
      normalizeGitAuthorIdentity(
        "dependabot[bot]",
        "49699333+dependabot[bot]@users.noreply.github.com",
      ),
    ).toBe("49699333+dependabot[bot]@users.noreply.github.com");
  });

  it("falls back to the author name when the email is empty", () => {
    expect(normalizeGitAuthorIdentity("Marta Gil", "   ")).toBe("marta gil");
  });
});

describe("normalizeRepositoryPath", () => {
  it("normalizes explicit CODEOWNERS paths to repository-relative posix form", () => {
    expect(normalizeRepositoryPath("./docs/CODEOWNERS")).toBe("docs/CODEOWNERS");
    expect(normalizeRepositoryPath("/.github/CODEOWNERS")).toBe(".github/CODEOWNERS");
    expect(normalizeRepositoryPath("docs\\CODEOWNERS")).toBe("docs/CODEOWNERS");
  });
});

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "codesentinel-owners-git-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

const writeAndCommit = (
  repositoryPath: string,
  author: { name: string; email: string },
  authoredAt: string,
  files: Readonly<Record<string, string>>,
  message: string,
): void => {
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = join(repositoryPath, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  runGit(repositoryPath, ["add", "--all"]);
  runGit(
    repositoryPath,
    ["commit", "--no-gpg-sign", "-m", message],
    commitIdentityEnvironment(author, authoredAt),
  );
};

describe("collectOwnershipEvidence", () => {
  it("projects one full-history pass onto lifetime and activity-window horizons", () => {
    const repositoryPath = createTemporaryDirectory();
    runGit(repositoryPath, ["init", "--initial-branch=main"]);
    runGit(repositoryPath, ["config", "commit.gpgsign", "false"]);

    writeAndCommit(
      repositoryPath,
      { name: "Alice", email: "alice@example.com" },
      "2020-01-01T10:00:00Z",
      { "src/app.ts": "old line\n", "src/old.ts": "old file\n" },
      "feat: initial files",
    );
    writeAndCommit(
      repositoryPath,
      { name: "Bob", email: "bob@example.com" },
      "2020-06-01T10:00:00Z",
      { "src/app.ts": "old line\nrecent line\n" },
      "feat: extend app",
    );

    const snapshot = readRepositorySnapshot(repositoryPath, "HEAD");
    const evidence = collectOwnershipEvidence(snapshot, 90);

    const app = evidence.files.find((file) => file.filePath === "src/app.ts");
    expect(app?.commits).toBe(2);
    expect(app?.recentCommits).toBe(1);
    expect(app?.authors?.map((author) => author.authorId)).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(app?.recentAuthors).toEqual([
      expect.objectContaining({ authorId: "bob@example.com", commits: 1 }),
    ]);

    const old = evidence.files.find((file) => file.filePath === "src/old.ts");
    expect(old?.commits).toBe(1);
    expect(old?.recentCommits).toBe(0);
    expect(old?.recentAuthors).toEqual([]);
  });
});
