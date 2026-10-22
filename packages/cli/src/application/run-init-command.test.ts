import { accessSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  CODESENTINEL_OWNERS_FILE_CONTENT,
  CODESENTINEL_OWNERS_PATH,
  CODESENTINEL_WORKFLOW_PATH,
  CODESENTINEL_WORKFLOW_TEMPLATE,
  runInitCommand,
} from "./run-init-command.js";

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};

type WorkflowDocument = {
  name?: string;
  on?: {
    push?: { branches?: string[] };
    pull_request?: unknown;
  };
  jobs?: {
    codesentinel?: {
      steps?: WorkflowStep[];
    };
  };
};

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "codesentinel-init-"));
  temporaryDirectories.push(directory);
  return directory;
};

const fileExists = (absolutePath: string): boolean => {
  try {
    accessSync(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const readGeneratedWorkflow = (targetPath: string): string =>
  readFileSync(join(targetPath, CODESENTINEL_WORKFLOW_PATH), "utf8");

const findStep = (steps: WorkflowStep[], name: string): WorkflowStep => {
  const step = steps.find((entry) => entry.name === name);
  if (step === undefined) {
    throw new Error(`missing workflow step: ${name}`);
  }

  return step;
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("runInitCommand", () => {
  it("scaffolds a workflow and owners file when CODEOWNERS exists", async () => {
    const targetPath = createTemporaryDirectory();
    writeFileSync(join(targetPath, "CODEOWNERS"), "* @alice\n", "utf8");

    const result = await runInitCommand(targetPath);

    expect(result.exitCode).toBe(0);
    expect(readGeneratedWorkflow(targetPath)).toBe(CODESENTINEL_WORKFLOW_TEMPLATE);
    expect(readFileSync(join(targetPath, CODESENTINEL_OWNERS_PATH), "utf8")).toBe(
      CODESENTINEL_OWNERS_FILE_CONTENT,
    );
    expect(result.rendered).toContain("Created");
    expect(result.rendered).toContain(CODESENTINEL_WORKFLOW_PATH);
    expect(result.rendered).toContain(CODESENTINEL_OWNERS_PATH);
    expect(result.rendered.match(/Next steps/g)).toHaveLength(1);
  });

  it("is idempotent on a second run", async () => {
    const targetPath = createTemporaryDirectory();
    writeFileSync(join(targetPath, "CODEOWNERS"), "* @alice\n", "utf8");

    await runInitCommand(targetPath);
    const workflowBefore = readGeneratedWorkflow(targetPath);
    const ownersBefore = readFileSync(join(targetPath, CODESENTINEL_OWNERS_PATH), "utf8");

    const second = await runInitCommand(targetPath);

    expect(second.exitCode).toBe(0);
    expect(readGeneratedWorkflow(targetPath)).toBe(workflowBefore);
    expect(readFileSync(join(targetPath, CODESENTINEL_OWNERS_PATH), "utf8")).toBe(ownersBefore);
    expect(second.plan.actions.map((entry) => entry.status)).toEqual(["skipped", "skipped"]);
    expect(second.rendered).toContain("Skipped");
    expect(second.rendered).toContain(CODESENTINEL_WORKFLOW_PATH);
    expect(second.rendered).toContain(CODESENTINEL_OWNERS_PATH);
  });

  it("rewrites a modified workflow with --force", async () => {
    const targetPath = createTemporaryDirectory();
    mkdirSync(join(targetPath, ".github/workflows"), { recursive: true });
    writeFileSync(join(targetPath, CODESENTINEL_WORKFLOW_PATH), "modified: true\n", "utf8");

    const result = await runInitCommand(targetPath, { force: true });

    expect(readGeneratedWorkflow(targetPath)).toBe(CODESENTINEL_WORKFLOW_TEMPLATE);
    expect(result.rendered).toContain("Updated");
    expect(result.plan.actions[0]?.status).toBe("updated");
  });

  it("writes nothing during a dry run but prints the planned content", async () => {
    const targetPath = createTemporaryDirectory();
    writeFileSync(join(targetPath, "CODEOWNERS"), "* @alice\n", "utf8");

    const result = await runInitCommand(targetPath, { dryRun: true });

    expect(result.exitCode).toBe(0);
    expect(fileExists(join(targetPath, CODESENTINEL_WORKFLOW_PATH))).toBe(false);
    expect(fileExists(join(targetPath, CODESENTINEL_OWNERS_PATH))).toBe(false);
    expect(result.rendered).toContain("dry run");
    expect(result.rendered).toContain("name: CodeSentinel");
    expect(result.rendered).toContain(CODESENTINEL_OWNERS_FILE_CONTENT.trim());
  });

  it("does not create the owners file without a CODEOWNERS file", async () => {
    const targetPath = createTemporaryDirectory();

    const result = await runInitCommand(targetPath);

    expect(readGeneratedWorkflow(targetPath)).toBe(CODESENTINEL_WORKFLOW_TEMPLATE);
    expect(fileExists(join(targetPath, CODESENTINEL_OWNERS_PATH))).toBe(false);
    expect(result.rendered).toContain("Created");
    expect(result.rendered).not.toContain(CODESENTINEL_OWNERS_PATH);
  });

  it("skips the workflow when --ci none is selected", async () => {
    const targetPath = createTemporaryDirectory();
    writeFileSync(join(targetPath, "CODEOWNERS"), "* @alice\n", "utf8");

    const result = await runInitCommand(targetPath, { ci: "none" });

    expect(fileExists(join(targetPath, CODESENTINEL_WORKFLOW_PATH))).toBe(false);
    expect(readFileSync(join(targetPath, CODESENTINEL_OWNERS_PATH), "utf8")).toBe(
      CODESENTINEL_OWNERS_FILE_CONTENT,
    );
    expect(result.rendered).toContain("Disabled");
    expect(result.rendered).toContain(CODESENTINEL_WORKFLOW_PATH);
    expect(result.rendered).toContain("Add `codesentinel ci` to your existing CI pipeline.");
    expect(result.rendered).not.toContain("Push or open a pull request");
    expect(result.rendered).not.toContain("already exists (use --force to overwrite)");
  });

  it("generates a workflow that satisfies the CI contract", () => {
    const workflow = parse(CODESENTINEL_WORKFLOW_TEMPLATE) as WorkflowDocument;
    const steps = workflow.jobs?.codesentinel?.steps ?? [];

    expect(workflow.name).toBe("CodeSentinel");
    expect(workflow.on?.push?.branches).toContain("main");
    expect(workflow.on).toHaveProperty("pull_request");

    const checkout = findStep(steps, "Checkout");
    expect(checkout.uses).toBe("actions/checkout@v4");
    expect(checkout.with?.["fetch-depth"]).toBe(0);

    const setupNode = findStep(steps, "Setup Node.js");
    expect(setupNode.uses).toBe("actions/setup-node@v4");
    expect(setupNode.with?.["node-version"]).toBe(24);

    const runStep = findStep(steps, "Run CodeSentinel");
    expect(runStep.run).toContain(
      "--baseline-ref auto --fail-on error --snapshot codesentinel-snapshot.json",
    );

    const ownersStep = findStep(steps, "Build ownership report");
    expect(ownersStep.if).toContain(
      "hashFiles('CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS') != ''",
    );
    expect(ownersStep.run).toContain("--format md --output ownership.md");

    const uploadStep = findStep(steps, "Upload CodeSentinel artifacts");
    expect(uploadStep.with?.["retention-days"]).toBe(90);
    expect(uploadStep.with?.["if-no-files-found"]).toBe("warn");
  });

  it("never touches package.json", async () => {
    const targetPath = createTemporaryDirectory();
    const packageJson = '{\n  "name": "fixture",\n  "private": true\n}\n';
    writeFileSync(join(targetPath, "package.json"), packageJson, "utf8");
    writeFileSync(join(targetPath, "CODEOWNERS"), "* @alice\n", "utf8");

    await runInitCommand(targetPath, { force: true });

    expect(readFileSync(join(targetPath, "package.json"), "utf8")).toBe(packageJson);
  });
});
