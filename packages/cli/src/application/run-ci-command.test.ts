import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit, stripInheritedGitVariables } from "../test-support/git-fixture.js";
import { GovernanceConfigurationError, runCiCommand } from "./run-ci-command.js";

stripInheritedGitVariables();

/**
 * Integration tests against the same real git fixture used by the owners command tests.
 *
 *   tracked files      payments/refund.txt, api/webhooks.txt, docs/guide.txt, scripts/deploy.txt
 *   CODEOWNERS         /payments/ @bob   /api/* @alice   /docs/ @carol
 *   authors            alice, bob, dave (each commit adds exactly one line)
 *
 *   payments/refund.txt  bob   x2        -> aligned
 *   api/webhooks.txt     alice x1, dave x3 -> drifted
 *   docs/guide.txt       dave  x2        -> ghosted (@carol has no activity)
 *   scripts/deploy.txt   dave  x6        -> unowned and the churniest file, so critical
 *
 * The observation window is anchored to the CODEOWNERS commit, so the fixture does not depend on
 * the wall clock.
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

  runGit(repositoryPath, ["add", "--", filePath]);
  runGit(
    repositoryPath,
    [
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
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  );
};

const createFixtureRepository = (withCodeowners = true): string => {
  commitClock = 0;
  const repositoryPath = createTemporaryDirectory("codesentinel-ci-");
  initRepository(repositoryPath);

  const payments: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    payments.push(`refund line ${index + 1}`);
    commitFile(
      repositoryPath,
      BOB,
      "payments/refund.txt",
      `${payments.join("\n")}\n`,
      `fix(payments): refund change ${index + 1}`,
    );
  }

  const webhooks: string[] = [];
  webhooks.push("webhook line 1");
  commitFile(
    repositoryPath,
    ALICE,
    "api/webhooks.txt",
    `${webhooks.join("\n")}\n`,
    "feat(api): add webhook",
  );
  for (let index = 0; index < 3; index += 1) {
    webhooks.push(`webhook line ${index + 2}`);
    commitFile(
      repositoryPath,
      DAVE,
      "api/webhooks.txt",
      `${webhooks.join("\n")}\n`,
      `feat(api): webhook change ${index + 1}`,
    );
  }

  const guide: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    guide.push(`guide line ${index + 1}`);
    commitFile(
      repositoryPath,
      DAVE,
      "docs/guide.txt",
      `${guide.join("\n")}\n`,
      `docs: guide change ${index + 1}`,
    );
  }

  const deploy: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    deploy.push(`deploy line ${index + 1}`);
    commitFile(
      repositoryPath,
      DAVE,
      "scripts/deploy.txt",
      `${deploy.join("\n")}\n`,
      `chore(deploy): change ${index + 1}`,
    );
  }

  if (withCodeowners) {
    commitFile(repositoryPath, BOB, "CODEOWNERS", CODEOWNERS, "chore: declare owners");
  }

  return repositoryPath;
};

describe("runCiCommand ownership gates against a git fixture", () => {
  it("fails every ownership gate with deterministic violation order", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await runCiCommand(repositoryPath, "strict_email", {
      includeTrace: false,
      recentWindowDays: 30,
      gateConfig: {
        maxUnownedCritical: 0,
        maxGhostOwners: 0,
        maxDrift: 0.1,
        failOn: "error",
      },
    });

    expect(result.gateResult.exitCode).toBe(1);
    expect(result.gateResult.violations.map((violation) => violation.id)).toEqual([
      "max-drift",
      "max-ghost-owners",
      "max-unowned-critical",
    ]);
    expect(result.machineReadable.ownership?.available).toBe(true);
    expect(result.machineReadable.ownership?.codeownersSource).toBe("CODEOWNERS");
    expect(result.markdownSummary).toContain("### Ownership");
    expect(result.markdownSummary).toContain("- unowned critical: `1`");
  });

  it("passes when every threshold is satisfied and still reports the metrics", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await runCiCommand(repositoryPath, "strict_email", {
      includeTrace: false,
      recentWindowDays: 30,
      gateConfig: {
        maxUnownedCritical: 1,
        maxGhostOwners: 1,
        maxDrift: 1,
        failOn: "error",
      },
    });

    expect(result.gateResult.exitCode).toBe(0);
    expect(result.gateResult.violations).toEqual([]);
    expect(result.machineReadable.ownership).toMatchObject({
      available: true,
      codeownersSource: "CODEOWNERS",
      metrics: {
        unownedCriticalCount: 1,
        ghostOwnerCount: 1,
        driftPercent: 33.33,
      },
    });
    expect(result.markdownSummary).toContain("- unowned critical: `1`");
  });

  it("warns and stays green when the repository has no CODEOWNERS", async () => {
    const repositoryPath = createFixtureRepository(false);

    const result = await runCiCommand(repositoryPath, "strict_email", {
      includeTrace: false,
      recentWindowDays: 30,
      gateConfig: {
        maxUnownedCritical: 0,
        maxGhostOwners: 0,
        maxDrift: 0,
        failOn: "error",
      },
    });

    expect(result.gateResult.exitCode).toBe(0);
    expect(result.gateResult.violations).toEqual([]);
    expect(result.machineReadable.ownership).toMatchObject({
      available: false,
      codeownersSource: null,
      metrics: null,
    });
    expect(result.gateResult.evaluatedGates).not.toContain("max-unowned-critical");
    expect(result.gateResult.evaluatedGates).not.toContain("max-ghost-owners");
    expect(result.gateResult.evaluatedGates).not.toContain("max-drift");
    expect(result.markdownSummary).toContain("### Warnings");
    expect(result.markdownSummary).toContain("No CODEOWNERS file was found");
  });

  it("behaves byte-identically when no ownership threshold is configured", async () => {
    const repositoryPath = createFixtureRepository();

    const result = await runCiCommand(repositoryPath, "strict_email", {
      includeTrace: false,
      recentWindowDays: 30,
      gateConfig: { failOn: "error" },
    });

    expect(result.machineReadable).not.toHaveProperty("ownership");
    expect(result).not.toHaveProperty("ownership");
    expect(result.markdownSummary).not.toContain("### Ownership");
    expect(result.markdownSummary).not.toContain("### Warnings");
  });

  it("rejects an invalid ownership threshold", async () => {
    const repositoryPath = createFixtureRepository();

    await expect(
      runCiCommand(repositoryPath, "strict_email", {
        includeTrace: false,
        recentWindowDays: 30,
        gateConfig: { maxDrift: 1.5, failOn: "error" },
      }),
    ).rejects.toBeInstanceOf(GovernanceConfigurationError);
  });
});
