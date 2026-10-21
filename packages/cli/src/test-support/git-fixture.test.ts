import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitFixtureEnvironment,
  INHERITED_GIT_VARIABLES,
  runGit,
  stripInheritedGitVariables,
  withoutInheritedGitVariables,
} from "./git-fixture.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "codesentinel-git-fixture-"));
  temporaryDirectories.push(directory);
  return directory;
};

const restoreProcessVariable = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("withoutInheritedGitVariables", () => {
  it("drops inherited git pointers and preserves unrelated entries", () => {
    const environment: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      FIXTURE_MARKER: "kept",
      GIT_DIR: "/decoy/.git",
      GIT_WORK_TREE: "/decoy",
      GIT_INDEX_FILE: "/decoy/.git/index",
      GIT_OBJECT_DIRECTORY: "/decoy/.git/objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/decoy/alternates",
      GIT_COMMON_DIR: "/decoy/.git",
    };

    const sanitized = withoutInheritedGitVariables(environment);

    expect(sanitized).toEqual({ PATH: "/usr/bin", FIXTURE_MARKER: "kept" });
    expect(environment["GIT_DIR"]).toBe("/decoy/.git");
  });
});

describe("createGitFixtureEnvironment", () => {
  it("keeps explicit overrides while dropping inherited pointers", () => {
    const previousGitDir = process.env["GIT_DIR"];
    const previousGitWorkTree = process.env["GIT_WORK_TREE"];
    process.env["GIT_DIR"] = "/inherited/.git";
    process.env["GIT_WORK_TREE"] = "/inherited";

    try {
      const environment = createGitFixtureEnvironment({
        PATH: "/fixture/bin",
        FIXTURE_MARKER: "kept",
      });

      expect(environment["PATH"]).toBe("/fixture/bin");
      expect(environment["FIXTURE_MARKER"]).toBe("kept");
      expect(environment["GIT_DIR"]).toBeUndefined();
      expect(environment["GIT_WORK_TREE"]).toBeUndefined();
    } finally {
      restoreProcessVariable("GIT_DIR", previousGitDir);
      restoreProcessVariable("GIT_WORK_TREE", previousGitWorkTree);
    }
  });
});

describe("stripInheritedGitVariables", () => {
  it("removes inherited git pointers from process.env", () => {
    const previous = new Map<string, string | undefined>();
    for (const variable of INHERITED_GIT_VARIABLES) {
      previous.set(variable, process.env[variable]);
      process.env[variable] = `/inherited/${variable}`;
    }

    try {
      stripInheritedGitVariables();

      for (const variable of INHERITED_GIT_VARIABLES) {
        expect(process.env[variable]).toBeUndefined();
      }
    } finally {
      for (const variable of INHERITED_GIT_VARIABLES) {
        restoreProcessVariable(variable, previous.get(variable));
      }
    }
  });
});

describe("runGit", () => {
  it("keeps fixture commits out of an inherited repository", () => {
    const decoyRepository = createTemporaryDirectory();
    const fixtureRepository = createTemporaryDirectory();

    runGit(decoyRepository, ["init", "--initial-branch=main"]);
    runGit(decoyRepository, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(decoyRepository, "decoy.txt"), "decoy\n", "utf8");
    runGit(decoyRepository, ["add", "--all"]);
    runGit(
      decoyRepository,
      [
        "-c",
        "user.name=Decoy",
        "-c",
        "user.email=decoy@example.com",
        "commit",
        "--no-gpg-sign",
        "-m",
        "chore: decoy commit",
      ],
      {
        GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
      },
    );

    const decoyHeadBefore = runGit(decoyRepository, ["rev-parse", "HEAD"]);
    const previousGitDir = process.env["GIT_DIR"];
    const previousGitWorkTree = process.env["GIT_WORK_TREE"];
    process.env["GIT_DIR"] = join(decoyRepository, ".git");
    process.env["GIT_WORK_TREE"] = decoyRepository;

    try {
      runGit(fixtureRepository, ["init", "--initial-branch=main"]);
      runGit(fixtureRepository, ["config", "commit.gpgsign", "false"]);
      writeFileSync(join(fixtureRepository, "fixture.txt"), "fixture\n", "utf8");
      runGit(fixtureRepository, ["add", "--all"]);
      runGit(
        fixtureRepository,
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "--no-gpg-sign",
          "-m",
          "feat: fixture commit",
        ],
        {
          GIT_AUTHOR_DATE: "2026-02-01T10:00:00Z",
          GIT_COMMITTER_DATE: "2026-02-01T10:00:00Z",
        },
      );

      expect(runGit(fixtureRepository, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
      expect(runGit(decoyRepository, ["rev-parse", "HEAD"])).toBe(decoyHeadBefore);
      expect(runGit(decoyRepository, ["status", "--porcelain"]).trim()).toBe("");
    } finally {
      restoreProcessVariable("GIT_DIR", previousGitDir);
      restoreProcessVariable("GIT_WORK_TREE", previousGitWorkTree);
      rmSync(decoyRepository, { recursive: true, force: true });
      rmSync(fixtureRepository, { recursive: true, force: true });
    }
  });
});
