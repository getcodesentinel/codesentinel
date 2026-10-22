import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Application layer for `codesentinel init`: plans the CI scaffold for a target repository and
 * writes the missing files. Planning is pure so the rendered output and the writes stay aligned.
 */

export const CODESENTINEL_WORKFLOW_PATH = ".github/workflows/codesentinel.yml";
export const CODESENTINEL_OWNERS_PATH = ".codesentinel/owners.json";

export const CODESENTINEL_WORKFLOW_TEMPLATE = `name: CodeSentinel

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  codesentinel:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Run CodeSentinel
        run: npx --yes @getcodesentinel/codesentinel@latest ci --baseline-ref auto --fail-on error --snapshot codesentinel-snapshot.json

      - name: Build ownership report
        if: hashFiles('CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS') != ''
        run: npx --yes @getcodesentinel/codesentinel@latest owners --format md --output ownership.md

      - name: Upload CodeSentinel artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: codesentinel
          path: |
            codesentinel-snapshot.json
            ownership.md
          retention-days: 90
          if-no-files-found: warn
`;

export const CODESENTINEL_OWNERS_FILE_CONTENT = `{"aliases": {}}\n`;

const CODEOWNERS_CANDIDATES = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"] as const;
const SKIPPED_REASON = "already exists (use --force to overwrite)";

export type InitCiMode = "github" | "none";

export type InitCommandOptions = {
  force?: boolean;
  ci?: InitCiMode;
  dryRun?: boolean;
};

export type InitActionStatus = "created" | "updated" | "skipped" | "disabled";

export type InitAction = {
  status: InitActionStatus;
  path: string;
  content?: string;
  reason?: string;
};

export type InitPlan = {
  actions: InitAction[];
};

export type InitPlanInput = {
  hasCodeownersFile: boolean;
  workflowExists: boolean;
  ownersFileExists: boolean;
  options?: InitCommandOptions;
};

export type InitCommandResult = {
  targetPath: string;
  plan: InitPlan;
  rendered: string;
  exitCode: number;
};

const action = (
  status: InitActionStatus,
  path: string,
  extra: { content?: string; reason?: string } = {},
): InitAction => ({
  status,
  path,
  ...(extra.content === undefined ? {} : { content: extra.content }),
  ...(extra.reason === undefined ? {} : { reason: extra.reason }),
});

export const buildInitPlan = (input: InitPlanInput): InitPlan => {
  const ci = input.options?.ci ?? "github";
  const force = input.options?.force === true;
  const actions: InitAction[] = [];

  if (ci === "none") {
    actions.push(
      action("disabled", CODESENTINEL_WORKFLOW_PATH, { reason: "disabled by --ci none" }),
    );
  } else if (!input.workflowExists) {
    actions.push(
      action("created", CODESENTINEL_WORKFLOW_PATH, { content: CODESENTINEL_WORKFLOW_TEMPLATE }),
    );
  } else if (force) {
    actions.push(
      action("updated", CODESENTINEL_WORKFLOW_PATH, { content: CODESENTINEL_WORKFLOW_TEMPLATE }),
    );
  } else {
    actions.push(action("skipped", CODESENTINEL_WORKFLOW_PATH, { reason: SKIPPED_REASON }));
  }

  if (input.hasCodeownersFile) {
    if (!input.ownersFileExists) {
      actions.push(
        action("created", CODESENTINEL_OWNERS_PATH, {
          content: CODESENTINEL_OWNERS_FILE_CONTENT,
        }),
      );
    } else if (force) {
      actions.push(
        action("updated", CODESENTINEL_OWNERS_PATH, {
          content: CODESENTINEL_OWNERS_FILE_CONTENT,
        }),
      );
    } else {
      actions.push(action("skipped", CODESENTINEL_OWNERS_PATH, { reason: SKIPPED_REASON }));
    }
  }

  return { actions };
};

const SECTION_ORDER: InitActionStatus[] = ["created", "updated", "skipped", "disabled"];
const SECTION_LABELS: Record<InitActionStatus, string> = {
  created: "Created",
  updated: "Updated",
  skipped: "Skipped",
  disabled: "Disabled",
};

const indentContent = (content: string): string[] =>
  content
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => `    ${line}`);

export const renderInitOutput = (
  plan: InitPlan,
  options: { dryRun?: boolean; ci?: InitCiMode } = {},
): string => {
  const dryRun = options.dryRun === true;
  const ci = options.ci ?? "github";
  const lines: string[] = [];
  lines.push(dryRun ? "CodeSentinel init (dry run)" : "CodeSentinel init");
  lines.push("");

  for (const status of SECTION_ORDER) {
    const actions = plan.actions.filter((entry) => entry.status === status);
    if (actions.length === 0) {
      continue;
    }

    lines.push(SECTION_LABELS[status]);
    for (const entry of actions) {
      const suffix = entry.reason === undefined ? "" : ` — ${entry.reason}`;
      lines.push(`  ${entry.path}${suffix}`);
      if (dryRun && (status === "created" || status === "updated") && entry.content !== undefined) {
        lines.push(...indentContent(entry.content));
      }
    }
    lines.push("");
  }

  lines.push("Next steps");
  lines.push("  1. Review and commit the generated files.");
  lines.push(
    ci === "none"
      ? "  2. Add `codesentinel ci` to your existing CI pipeline."
      : "  2. Push or open a pull request so the workflow runs.",
  );
  lines.push(
    "  3. Download the codesentinel artifact with `gh run download` to keep history for `codesentinel trend`.",
  );

  return lines.join("\n");
};

const fileExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const anyFileExists = async (
  targetPath: string,
  candidates: readonly string[],
): Promise<boolean> => {
  for (const candidate of candidates) {
    if (await fileExists(join(targetPath, candidate))) {
      return true;
    }
  }

  return false;
};

const resolveTargetPath = (inputPath: string | undefined): string => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  return resolve(invocationCwd, inputPath ?? ".");
};

export const runInitCommand = async (
  inputPath: string | undefined,
  options: InitCommandOptions = {},
): Promise<InitCommandResult> => {
  const targetPath = resolveTargetPath(inputPath);
  const ci = options.ci ?? "github";
  const hasCodeownersFile = await anyFileExists(targetPath, CODEOWNERS_CANDIDATES);

  const plan = buildInitPlan({
    hasCodeownersFile,
    workflowExists:
      ci === "github" && (await fileExists(join(targetPath, CODESENTINEL_WORKFLOW_PATH))),
    ownersFileExists:
      hasCodeownersFile && (await fileExists(join(targetPath, CODESENTINEL_OWNERS_PATH))),
    options: { ...options, ci },
  });

  if (options.dryRun !== true) {
    for (const entry of plan.actions) {
      if (entry.status !== "created" && entry.status !== "updated") {
        continue;
      }

      const absolutePath = join(targetPath, entry.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, entry.content ?? "", "utf8");
    }
  }

  return {
    targetPath,
    plan,
    rendered: renderInitOutput(plan, { dryRun: options.dryRun === true, ci }),
    exitCode: 0,
  };
};
