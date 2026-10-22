import type { DeclaredOwner } from "@codesentinel/ownership";
import type { ReadingPath, ReadingPathPerson, ReadingStepRole } from "@codesentinel/reading-path";

/**
 * Renderers for `codesentinel path`.
 *
 * The JSON payload is the stable contract: fixed keys, fixed order, no timestamps. Console and
 * Markdown are rendered from the same `ReadingPath`, so the three formats cannot disagree.
 */

export const PATH_SCHEMA_VERSION = "codesentinel.path.v1";

export type PathOutputFormat = "console" | "md" | "json";

export type PathJsonStep = {
  order: number;
  filePath: string;
  role: ReadingStepRole;
  reason: string;
  owner: readonly DeclaredOwner[] | null;
  observedTopAuthor: string | null;
  commits: number;
  churn: number;
  fanInInternal: number;
  testFiles: readonly string[];
};

export type PathJsonPayload = {
  schemaVersion: typeof PATH_SCHEMA_VERSION;
  target: string;
  targetKind: "file" | "directory";
  steps: readonly PathJsonStep[];
  people: readonly ReadingPathPerson[];
  commands: readonly string[];
  warnings: readonly string[];
  truncated: boolean;
};

const toPayloadOwner = (owner: DeclaredOwner): DeclaredOwner => {
  if (owner.kind === "user") return { kind: "user", handle: owner.handle };
  if (owner.kind === "team") return { kind: "team", org: owner.org, slug: owner.slug };
  return { kind: "email", address: owner.address };
};

export const buildPathPayload = (path: ReadingPath): PathJsonPayload => ({
  schemaVersion: PATH_SCHEMA_VERSION,
  target: path.target,
  targetKind: path.targetKind,
  steps: path.steps.map((step) => ({
    order: step.order,
    filePath: step.filePath,
    role: step.role,
    reason: step.reason,
    owner: step.owner === null ? null : step.owner.map(toPayloadOwner),
    observedTopAuthor: step.observedTopAuthor,
    commits: step.commits,
    churn: step.churn,
    fanInInternal: step.fanInInternal,
    testFiles: [...step.testFiles],
  })),
  people: path.people.map((person) => ({
    authorId: person.authorId,
    files: [...person.files],
    commits: person.commits,
  })),
  commands: [...path.commands],
  warnings: [...path.warnings],
  truncated: path.truncated,
});

const formatOwner = (owner: DeclaredOwner): string => {
  if (owner.kind === "user") return `@${owner.handle}`;
  if (owner.kind === "team") return `@${owner.org}/${owner.slug}`;
  return owner.address;
};

const formatOwnerText = (owner: readonly DeclaredOwner[] | null): string => {
  if (owner === null) return "not analysed (no CODEOWNERS)";
  if (owner.length === 0) return "none declared";
  return owner.map(formatOwner).join(", ");
};

const formatStepsCount = (count: number): string => `${count} ${count === 1 ? "step" : "steps"}`;

const appendConsoleSection = (lines: string[], title: string, items: readonly string[]): void => {
  if (items.length === 0) return;
  lines.push("");
  lines.push(title);
  for (const item of items) {
    lines.push(` - ${item}`);
  }
};

const renderConsole = (path: ReadingPath): string => {
  const lines: string[] = [];
  lines.push(`Reading path: ${path.target} (${path.targetKind})`);
  lines.push(
    `${formatStepsCount(path.steps.length)}${path.truncated === true ? " (truncated)" : ""}`,
  );
  lines.push("");

  if (path.steps.length === 0) {
    lines.push("No files to read.");
  } else {
    for (const step of path.steps) {
      lines.push(` ${step.order}. ${step.filePath}  [${step.role}]`);
      lines.push(`    ${step.reason}`);
      lines.push(
        `    owner: ${formatOwnerText(step.owner)} · observed: ${step.observedTopAuthor ?? "unknown"} · commits ${step.commits} · churn ${step.churn} · fan-in ${step.fanInInternal}`,
      );
      if (step.testFiles.length > 0) {
        lines.push(`    tests: ${step.testFiles.join(", ")}`);
      }
    }
  }

  appendConsoleSection(
    lines,
    "People to ask",
    path.people.map(
      (person) =>
        `${person.authorId} (${person.commits} commits): ${person.files.length > 0 ? person.files.join(", ") : "no single file"}`,
    ),
  );
  appendConsoleSection(
    lines,
    "Suggested commands (not discovered, not run)",
    path.commands.map((command) => command),
  );
  appendConsoleSection(
    lines,
    "Warnings",
    path.warnings.map((warning) => warning),
  );

  return lines.join("\n");
};

const escapeTableCell = (value: string): string => value.replace(/\|/g, "\\|");

const renderMarkdownTable = (header: readonly string[], rows: readonly string[][]): string[] => {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of rows) {
    lines.push(`| ${row.map(escapeTableCell).join(" | ")} |`);
  }
  return lines;
};

const formatMarkdownObserved = (value: string | null): string =>
  value === null ? "unknown" : `\`${value}\``;

const formatMarkdownTests = (testFiles: readonly string[]): string =>
  testFiles.length === 0 ? "none" : testFiles.map((file) => `\`${file}\``).join(", ");

const appendMarkdownSection = (lines: string[], title: string, items: readonly string[]): void => {
  if (items.length === 0) return;
  lines.push("");
  lines.push(title);
  lines.push("");
  for (const item of items) {
    lines.push(`- ${item}`);
  }
};

const renderMarkdown = (path: ReadingPath): string => {
  const lines: string[] = [];
  lines.push(`## Reading path: \`${path.target}\``);
  lines.push("");
  lines.push(`- target kind: \`${path.targetKind}\``);
  lines.push(`- steps: ${path.steps.length}${path.truncated === true ? " (truncated)" : ""}`);
  lines.push("");

  if (path.steps.length === 0) {
    lines.push("No files to read.");
  } else {
    for (const step of path.steps) {
      lines.push(`${step.order}. **\`${step.filePath}\`** — \`${step.role}\``);
      lines.push(`   - ${step.reason}`);
      lines.push(
        `   - owner: ${formatOwnerText(step.owner)} · observed: ${formatMarkdownObserved(step.observedTopAuthor)} · commits \`${step.commits}\` · churn \`${step.churn}\` · fan-in \`${step.fanInInternal}\``,
      );
      if (step.testFiles.length > 0) {
        lines.push(`   - tests: ${formatMarkdownTests(step.testFiles)}`);
      }
    }

    lines.push("");
    lines.push("### Steps");
    lines.push("");
    lines.push(
      ...renderMarkdownTable(
        [
          "#",
          "File",
          "Role",
          "Commits",
          "Churn",
          "Fan-in",
          "Observed author",
          "Declared owner",
          "Tests",
        ],
        path.steps.map((step) => [
          `${step.order}`,
          `\`${step.filePath}\``,
          `\`${step.role}\``,
          `${step.commits}`,
          `${step.churn}`,
          `${step.fanInInternal}`,
          formatMarkdownObserved(step.observedTopAuthor),
          formatOwnerText(step.owner),
          formatMarkdownTests(step.testFiles),
        ]),
      ),
    );
  }

  appendMarkdownSection(
    lines,
    "### People to ask",
    path.people.map(
      (person) =>
        `\`${person.authorId}\` (${person.commits} commits): ${person.files.length > 0 ? person.files.map((file) => `\`${file}\``).join(", ") : "no single file"}`,
    ),
  );
  appendMarkdownSection(
    lines,
    "### Suggested commands (not discovered, not run)",
    path.commands.map((command) => `\`${command}\``),
  );
  appendMarkdownSection(
    lines,
    "### Warnings",
    path.warnings.map((warning) => warning),
  );

  return lines.join("\n");
};

export const formatPathOutput = (path: ReadingPath, format: PathOutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(buildPathPayload(path), null, 2);
  }

  return format === "md" ? renderMarkdown(path) : renderConsole(path);
};
