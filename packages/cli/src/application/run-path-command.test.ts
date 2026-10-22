import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitIdentityEnvironment,
  runGit,
  stripInheritedGitVariables,
} from "../test-support/git-fixture.js";
import { PATH_EXIT_CODES, PathConfigurationError, runPathCommand } from "./run-path-command.js";

stripInheritedGitVariables();

const ALICE = { name: "Alice", email: "alice@example.com" };

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

const createFixtureRepository = (options: { lockfile?: boolean } = {}): string => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "codesentinel-path-"));
  temporaryDirectories.push(repositoryPath);

  runGit(repositoryPath, ["init", "--initial-branch=main"]);
  runGit(repositoryPath, ["config", "commit.gpgsign", "false"]);

  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "fixture", scripts: { test: "vitest run" } }, null, 2)}\n`,
    "a.ts": 'import { b } from "./b.js";\n\nexport const a = b + 1;\n',
    "b.ts": "export const b = 1;\n",
    "a.test.ts": 'import { a } from "./a.js";\n\nexport const value = a;\n',
  };
  if (options.lockfile !== false) {
    files["pnpm-lock.yaml"] = "lockfileVersion: '9.0'\n";
  }

  for (const [filePath, content] of Object.entries(files)) {
    writeFileSync(join(repositoryPath, filePath), content, "utf8");
  }

  runGit(repositoryPath, ["add", "--all"]);
  runGit(
    repositoryPath,
    ["commit", "--no-gpg-sign", "-m", "feat: add fixture sources"],
    commitIdentityEnvironment(ALICE, "2026-01-01T10:00:00Z"),
  );

  return repositoryPath;
};

const withRepositoryCwd = async <T>(
  repositoryPath: string,
  action: () => Promise<T>,
): Promise<T> => {
  const previous = process.env["INIT_CWD"];
  process.env["INIT_CWD"] = repositoryPath;
  try {
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env["INIT_CWD"];
    } else {
      process.env["INIT_CWD"] = previous;
    }
  }
};

describe("runPathCommand against a git fixture", () => {
  it("attaches test files and suggests the lockfile test command by default", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await withRepositoryCwd(repositoryPath, () =>
      runPathCommand("a.ts", { format: "json" }),
    );

    expect(result.exitCode).toBe(PATH_EXIT_CODES.ok);
    expect(result.relativeTarget).toBe("a.ts");
    expect(result.readingPath.target).toBe("a.ts");
    expect(result.readingPath.steps.some((step) => step.role === "test")).toBe(false);
    expect(result.readingPath.steps.some((step) => step.testFiles.length > 0)).toBe(true);
    expect(result.readingPath.commands).toEqual(["pnpm test"]);
  });

  it("suggests npm test when there is no lockfile", async () => {
    const repositoryPath = createFixtureRepository({ lockfile: false });

    const result = await withRepositoryCwd(repositoryPath, () => runPathCommand("a.ts", {}));

    expect(result.readingPath.commands).toEqual(["npm test"]);
  });

  it("promotes test files to their own steps when includeTests is true", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await withRepositoryCwd(repositoryPath, () =>
      runPathCommand("a.ts", { includeTests: true }),
    );

    expect(result.readingPath.steps.some((step) => step.role === "test")).toBe(true);
  });

  it("truncates and surfaces truncation when maxSteps is smaller than the module", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await withRepositoryCwd(repositoryPath, () =>
      runPathCommand("a.ts", { maxSteps: 1, format: "console" }),
    );

    expect(result.readingPath.steps).toHaveLength(1);
    expect(result.readingPath.truncated).toBe(true);
    expect(result.rendered).toContain("truncated");
  });

  it("rejects missing targets and targets outside the repository", async () => {
    const repositoryPath = createFixtureRepository();

    await withRepositoryCwd(repositoryPath, async () => {
      await expect(runPathCommand("missing.ts", {})).rejects.toBeInstanceOf(PathConfigurationError);
      return expect(runPathCommand("../outside", {})).rejects.toBeInstanceOf(
        PathConfigurationError,
      );
    });

    expect(PATH_EXIT_CODES.invalidTarget).toBe(2);
  });

  it("leaves declared owners null when no CODEOWNERS file exists", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await withRepositoryCwd(repositoryPath, () => runPathCommand("a.ts", {}));

    expect(result.readingPath.steps.every((step) => step.owner === null)).toBe(true);
    expect(result.readingPath.warnings).toContain(
      "no CODEOWNERS file found: declared owners are not reported",
    );
  });

  it("is deterministic across two json runs", async () => {
    const repositoryPath = createFixtureRepository();

    const first = await withRepositoryCwd(repositoryPath, () =>
      runPathCommand("a.ts", { format: "json" }),
    );
    const second = await withRepositoryCwd(repositoryPath, () =>
      runPathCommand("a.ts", { format: "json" }),
    );

    expect(second.rendered).toBe(first.rendered);
  });

  it("writes the rendered output with a trailing newline when outputPath is set", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await withRepositoryCwd(repositoryPath, () =>
      runPathCommand("a.ts", { format: "json", outputPath: "reading-path.json" }),
    );

    const outputPath = join(repositoryPath, "reading-path.json");
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf8")).toBe(`${result.rendered}\n`);
  });
});
