import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileOwnershipAudit } from "@codesentinel/ownership";
import { OwnersConfigurationError, runOwnersCommand } from "./run-owners-command.js";

/**
 * Integration tests against a real git fixture.
 *
 * The fixture is deliberately tiny and hand-checkable:
 *
 *   tracked files            payments/refund.txt, api/webhooks.txt, docs/guide.txt, scripts/deploy.txt
 *   CODEOWNERS               /payments/ @bob   /api/* @alice   /docs/ @carol
 *   authors                  alice, bob, dave (each commit adds exactly one line, so churn == commits)
 *
 *   payments/refund.txt      bob   x2   -> aligned
 *   api/webhooks.txt         alice x1, dave x3 -> drifted (dave owns 75% of the commits)
 *   docs/guide.txt           dave  x2   -> ghosted (@carol has no activity and is verifiable)
 *   scripts/deploy.txt       dave  x1   -> unowned (no pattern matches)
 *
 * Churn per file is [1, 2, 2, 4]; the p90 nearest-rank cutoff is 4, so api/webhooks.txt is the
 * only critical file. That makes every metric below computable by hand.
 */

const ALICE = { name: "Alice", email: "alice@example.com" };
const BOB = { name: "Bob", email: "bob@example.com" };
const DAVE = { name: "Dave", email: "dave@example.com" };

const CODEOWNERS = ["/payments/   @bob", "/api/*       @alice", "/docs/       @carol", ""].join(
  "\n",
);

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
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

const runGit = (repositoryPath: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const initRepository = (repositoryPath: string): void => {
  runGit(repositoryPath, ["init", "--initial-branch=main"]);
  runGit(repositoryPath, ["config", "commit.gpgsign", "false"]);
};

let commitClock = 0;

const commitFile = (
  repositoryPath: string,
  author: { name: string; email: string },
  filePath: string,
  content: string,
  message: string,
): void => {
  const absolutePath = join(repositoryPath, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
  const date = new Date(Date.UTC(2026, 8, 1, 10, commitClock, 0)).toISOString();
  commitClock += 1;

  execFileSync("git", ["-C", repositoryPath, "add", "--", filePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync(
    "git",
    [
      "-C",
      repositoryPath,
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      "commit",
      "--no-gpg-sign",
      "-m",
      message,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  );
};

const createFixtureRepository = (): string => {
  commitClock = 0;
  const repositoryPath = createTemporaryDirectory("codesentinel-owners-");
  initRepository(repositoryPath);
  writeFileSync(join(repositoryPath, "CODEOWNERS"), CODEOWNERS, "utf8");

  commitFile(
    repositoryPath,
    BOB,
    "payments/refund.txt",
    "refund line 1\n",
    "feat(payments): add refund",
  );
  commitFile(
    repositoryPath,
    ALICE,
    "api/webhooks.txt",
    "webhook line 1\n",
    "feat(api): add webhook",
  );
  commitFile(repositoryPath, DAVE, "docs/guide.txt", "guide line 1\n", "docs: add guide");
  commitFile(
    repositoryPath,
    DAVE,
    "scripts/deploy.txt",
    "deploy line 1\n",
    "chore: add deploy script",
  );
  commitFile(
    repositoryPath,
    BOB,
    "payments/refund.txt",
    "refund line 1\nrefund line 2\n",
    "fix(payments): refund rounding",
  );
  commitFile(
    repositoryPath,
    DAVE,
    "docs/guide.txt",
    "guide line 1\nguide line 2\n",
    "docs: extend guide",
  );
  commitFile(
    repositoryPath,
    DAVE,
    "api/webhooks.txt",
    "webhook line 1\nwebhook line 2\n",
    "feat(api): webhook retries",
  );
  commitFile(
    repositoryPath,
    DAVE,
    "api/webhooks.txt",
    "webhook line 1\nwebhook line 2\nwebhook line 3\n",
    "feat(api): webhook timeout",
  );
  commitFile(
    repositoryPath,
    DAVE,
    "api/webhooks.txt",
    "webhook line 1\nwebhook line 2\nwebhook line 3\nwebhook line 4\n",
    "feat(api): webhook signing",
  );
  runGit(repositoryPath, ["add", "CODEOWNERS"]);
  execFileSync(
    "git",
    [
      "-C",
      repositoryPath,
      "-c",
      `user.name=${BOB.name}`,
      "-c",
      `user.email=${BOB.email}`,
      "commit",
      "--no-gpg-sign",
      "-m",
      "chore: declare owners",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-09-02T10:00:00Z",
        GIT_COMMITTER_DATE: "2026-09-02T10:00:00Z",
      },
    },
  );

  return repositoryPath;
};

const findFile = (files: readonly FileOwnershipAudit[], filePath: string): FileOwnershipAudit => {
  const file = files.find((item) => item.filePath === filePath);
  if (file === undefined) {
    throw new Error(`expected an audit row for ${filePath}`);
  }
  return file;
};

describe("runOwnersCommand against a git fixture", () => {
  it("classifies declared vs observed ownership with hand-checkable metrics", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await runOwnersCommand(repositoryPath, {
      windowDays: 90,
      minCommits: 2,
      format: "json",
    });

    expect(result.report.available).toBe(true);
    expect(result.trackedFileCount).toBe(5);
    expect(result.report.codeowners).toMatchObject({
      source: "CODEOWNERS",
      entryCount: 3,
      errorCount: 0,
    });

    expect(result.report.fileCounts).toEqual({
      trackedFiles: 5,
      declaredFiles: 3,
      criticalFiles: 1,
      declaredCriticalFiles: 1,
      driftedFiles: 1,
    });
    expect(result.report.metrics).toMatchObject({
      declaredCoveragePercent: 60,
      declaredCoverageCriticalPercent: 100,
      driftPercent: 33.33,
      ghostOwnerCount: 1,
      unownedCriticalCount: 0,
      singleOwnerModuleCount: 3,
    });

    const files = result.audit.available ? result.audit.files : [];
    expect(files.map((file) => file.filePath)).toEqual([
      "docs/guide.txt",
      "api/webhooks.txt",
      "CODEOWNERS",
      "scripts/deploy.txt",
      "payments/refund.txt",
    ]);

    const refund = findFile(files, "payments/refund.txt");
    expect(refund.status).toBe("aligned");
    expect(refund.observed.commits).toBe(2);
    expect(refund.observed.topAuthorId).toBe("bob@example.com");
    expect(refund.matchLine).toBe(1);

    const webhooks = findFile(files, "api/webhooks.txt");
    expect(webhooks.status).toBe("drifted");
    expect(webhooks.observed.commits).toBe(4);
    expect(webhooks.observed.topAuthorId).toBe("dave@example.com");
    expect(webhooks.observed.topAuthorShare).toBe(0.75);
    expect(webhooks.criticality.isCritical).toBe(true);
    expect(webhooks.matchLine).toBe(2);

    const guide = findFile(files, "docs/guide.txt");
    expect(guide.status).toBe("ghosted");
    expect(guide.declared).toEqual([{ kind: "user", handle: "carol" }]);
    expect(guide.matchLine).toBe(3);

    const deploy = findFile(files, "scripts/deploy.txt");
    expect(deploy.status).toBe("unowned");
    expect(deploy.matchLine).toBeNull();
    expect(deploy.declared).toEqual([]);

    expect(result.report.ghostOwners).toEqual([
      { owner: { kind: "user", handle: "carol" }, samplePaths: ["docs/guide.txt"] },
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("produces byte-identical JSON across runs", async () => {
    const repositoryPath = createFixtureRepository();

    const first = await runOwnersCommand(repositoryPath, { format: "json" });
    const second = await runOwnersCommand(repositoryPath, { format: "json" });

    expect(second.rendered).toBe(first.rendered);
    expect(first.rendered).not.toContain("generatedAt");
  });

  it("treats a winning entry with no owners as unowned with a match line", async () => {
    const repositoryPath = createFixtureRepository();
    writeFileSync(
      join(repositoryPath, "CODEOWNERS"),
      ["*  @bob", "/payments/", ""].join("\n"),
      "utf8",
    );
    runGit(repositoryPath, ["add", "CODEOWNERS"]);
    execFileSync(
      "git",
      [
        "-C",
        repositoryPath,
        "-c",
        "user.name=Bob",
        "-c",
        "user.email=bob@example.com",
        "commit",
        "--no-gpg-sign",
        "-m",
        "chore: reset payments ownership",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-09-03T10:00:00Z",
          GIT_COMMITTER_DATE: "2026-09-03T10:00:00Z",
        },
      },
    );

    const result = await runOwnersCommand(repositoryPath, { format: "json" });
    const files = result.audit.available ? result.audit.files : [];
    const refund = findFile(files, "payments/refund.txt");

    expect(refund.declared).toEqual([]);
    expect(refund.status).toBe("unowned");
    expect(refund.matchLine).toBe(2);
  });

  it("exits 1 when a threshold is exceeded with --fail-on error and 0 with warn", async () => {
    const repositoryPath = createFixtureRepository();

    const failing = await runOwnersCommand(repositoryPath, {
      format: "json",
      thresholds: { failOn: "error", maxGhostOwners: 0 },
    });
    expect(failing.report.thresholds.violations).toHaveLength(1);
    expect(failing.report.thresholds.violations[0]).toMatchObject({
      threshold: "max-ghost-owners",
      limit: 0,
      actual: 1,
    });
    expect(failing.exitCode).toBe(1);

    const warning = await runOwnersCommand(repositoryPath, {
      format: "json",
      thresholds: { failOn: "warn", maxGhostOwners: 0 },
    });
    expect(warning.exitCode).toBe(0);

    const ignored = await runOwnersCommand(repositoryPath, {
      format: "json",
      thresholds: { failOn: "none", maxGhostOwners: 0 },
    });
    expect(ignored.exitCode).toBe(0);
  });

  it("reports the audit as unavailable, with exit 0, when there is no CODEOWNERS", async () => {
    const repositoryPath = createTemporaryDirectory("codesentinel-owners-none-");
    initRepository(repositoryPath);
    commitFile(repositoryPath, DAVE, "src/app.txt", "one line\n", "feat: app");

    const result = await runOwnersCommand(repositoryPath, { format: "json" });

    expect(result.report.available).toBe(false);
    expect(result.report.codeowners).toBeNull();
    expect(result.report.metrics).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.rendered).toContain("No CODEOWNERS file was found");

    const consoleOutput = await runOwnersCommand(repositoryPath, { format: "console" });
    expect(consoleOutput.rendered).toContain("The ownership audit is unavailable.");
  });

  it("fails with a configuration error when the explicit CODEOWNERS path is not tracked", async () => {
    const repositoryPath = createFixtureRepository();

    await expect(
      runOwnersCommand(repositoryPath, { codeownersPath: "docs/CODEOWNERS", format: "json" }),
    ).rejects.toBeInstanceOf(OwnersConfigurationError);
  });

  it("fails with a configuration error when CODEOWNERS is above the GitHub size limit", async () => {
    const repositoryPath = createTemporaryDirectory("codesentinel-owners-large-");
    initRepository(repositoryPath);
    const padding = `${"#".repeat(100)}\n`.repeat(32_000);
    writeFileSync(join(repositoryPath, "CODEOWNERS"), `${padding}* @bob\n`, "utf8");
    writeFileSync(join(repositoryPath, "app.txt"), "one line\n", "utf8");
    runGit(repositoryPath, ["add", "--all"]);
    execFileSync(
      "git",
      [
        "-C",
        repositoryPath,
        "-c",
        "user.name=Bob",
        "-c",
        "user.email=bob@example.com",
        "commit",
        "--no-gpg-sign",
        "-m",
        "chore: oversized codeowners",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-09-01T10:00:00Z",
          GIT_COMMITTER_DATE: "2026-09-01T10:00:00Z",
        },
      },
    );

    await expect(runOwnersCommand(repositoryPath, { format: "json" })).rejects.toThrow(
      /above the \d+ byte limit/,
    );
  });

  it("warns instead of failing when --resolve-github is requested", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await runOwnersCommand(repositoryPath, { format: "json", resolveGithub: true });

    expect(result.report.warnings.some((warning) => warning.includes("--resolve-github"))).toBe(
      true,
    );
    expect(result.exitCode).toBe(0);
  });
});
