import type {
  DeclaredOwner,
  FileOwnershipAudit,
  OwnershipAudit,
  OwnershipAuditMetrics,
  OwnershipStatus,
} from "@codesentinel/ownership";
import { formatOwnersSarif, type OwnersSarifContext } from "./format-owners-sarif.js";

/**
 * Report payload and renderers for `codesentinel owners`.
 *
 * The payload is the JSON contract: fixed keys, fixed order, no timestamps, no clock. Console and
 * Markdown are rendered from the same object, so the three formats can never disagree.
 */

export const OWNERS_SCHEMA_VERSION = "codesentinel.owners.v1";

export type OwnersOutputFormat = "console" | "json" | "md" | "sarif";

export const DEFAULT_SARIF_CONTEXT: OwnersSarifContext = { toolVersion: "0.0.0" };

export type OwnersFailOn = "none" | "warn" | "error";

export type OwnersThresholdConfig = {
  failOn: OwnersFailOn;
  maxUnownedCritical: number | null;
  maxGhostOwners: number | null;
  maxDrift: number | null;
};

export type OwnersThresholdViolation = {
  threshold: "max-unowned-critical" | "max-ghost-owners" | "max-drift";
  limit: number;
  actual: number;
  message: string;
};

export type OwnersReportCodeowners = {
  source: string;
  ignoredSources: readonly string[];
  entryCount: number;
  errorCount: number;
  errors: readonly { line: number; reason: string }[];
};

export type OwnersReportFileCounts = {
  trackedFiles: number;
  declaredFiles: number;
  criticalFiles: number;
  declaredCriticalFiles: number;
  driftedFiles: number;
};

export type OwnersReport = {
  schemaVersion: typeof OWNERS_SCHEMA_VERSION;
  available: boolean;
  ref: string;
  windowDays: number;
  minCommits: number;
  codeowners: OwnersReportCodeowners | null;
  fileCounts: OwnersReportFileCounts;
  metrics: OwnershipAuditMetrics | null;
  ghostOwners: readonly { owner: DeclaredOwner; samplePaths: readonly string[] }[];
  files: readonly FileOwnershipAudit[];
  warnings: readonly string[];
  thresholds: OwnersThresholdConfig & {
    violations: readonly OwnersThresholdViolation[];
  };
};

export const formatDeclaredOwner = (owner: DeclaredOwner): string => {
  if (owner.kind === "user") return `@${owner.handle}`;
  if (owner.kind === "team") return `@${owner.org}/${owner.slug}`;
  return owner.address;
};

export const formatDeclaredOwners = (owners: readonly DeclaredOwner[]): string =>
  owners.map(formatDeclaredOwner).join(", ");

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const countFileAudits = (
  files: readonly FileOwnershipAudit[],
  trackedFiles: number,
): OwnersReportFileCounts => {
  const declaredFiles = files.filter((file) => file.declared.length > 0);
  return {
    trackedFiles,
    declaredFiles: declaredFiles.length,
    criticalFiles: files.filter((file) => file.criticality.isCritical).length,
    declaredCriticalFiles: files.filter(
      (file) => file.declared.length > 0 && file.criticality.isCritical,
    ).length,
    driftedFiles: declaredFiles.filter((file) => file.status === "drifted").length,
  };
};

/**
 * Thresholds are evaluated against the published metrics, never against a recomputed value, so
 * `--fail-on error` fails exactly what the output shows.
 */
export const evaluateOwnersThresholds = (
  metrics: OwnershipAuditMetrics | null,
  config: OwnersThresholdConfig,
): readonly OwnersThresholdViolation[] => {
  if (metrics === null) {
    return [];
  }

  const violations: OwnersThresholdViolation[] = [];

  if (
    config.maxUnownedCritical !== null &&
    metrics.unownedCriticalCount > config.maxUnownedCritical
  ) {
    violations.push({
      threshold: "max-unowned-critical",
      limit: config.maxUnownedCritical,
      actual: metrics.unownedCriticalCount,
      message: `unowned critical files: ${metrics.unownedCriticalCount} (limit ${config.maxUnownedCritical})`,
    });
  }

  if (config.maxGhostOwners !== null && metrics.ghostOwnerCount > config.maxGhostOwners) {
    violations.push({
      threshold: "max-ghost-owners",
      limit: config.maxGhostOwners,
      actual: metrics.ghostOwnerCount,
      message: `ghost owners: ${metrics.ghostOwnerCount} (limit ${config.maxGhostOwners})`,
    });
  }

  if (config.maxDrift !== null) {
    const ratio = metrics.driftPercent / 100;
    if (ratio > config.maxDrift) {
      violations.push({
        threshold: "max-drift",
        limit: config.maxDrift,
        actual: ratio,
        message: `drift: ${metrics.driftPercent}% (limit ${formatRatio(config.maxDrift)})`,
      });
    }
  }

  return violations;
};

export type BuildOwnersReportInput = {
  audit: OwnershipAudit;
  ref: string;
  windowDays: number;
  minCommits: number;
  trackedFileCount: number;
  thresholds: OwnersThresholdConfig;
  violations: readonly OwnersThresholdViolation[];
};

export const buildOwnersReport = (input: BuildOwnersReportInput): OwnersReport => {
  const { audit } = input;
  const files = audit.available ? audit.files : [];
  const report: OwnersReport = {
    schemaVersion: OWNERS_SCHEMA_VERSION,
    available: audit.available,
    ref: input.ref,
    windowDays: input.windowDays,
    minCommits: input.minCommits,
    codeowners: audit.available
      ? {
          source: audit.codeowners.source,
          ignoredSources: [...audit.codeowners.ignoredSources].sort(compareText),
          entryCount: audit.codeowners.entries.length,
          errorCount: audit.codeowners.errors.length,
          errors: [...audit.codeowners.errors].sort((a, b) => a.line - b.line),
        }
      : null,
    fileCounts: countFileAudits(files, input.trackedFileCount),
    metrics: audit.available ? audit.metrics : null,
    ghostOwners: audit.available ? audit.ghostOwners : [],
    files,
    warnings: [...audit.warnings],
    thresholds: {
      ...input.thresholds,
      violations: [...input.violations],
    },
  };

  return report;
};

const formatPercent = (value: number): string => {
  const rounded = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  return `${rounded}%`;
};

const formatRatio = (value: number): string => {
  const percent = Math.round(value * 100);
  return `${percent}%`;
};

const formatShare = (share: number | null): string =>
  share === null ? "n/a" : `${Math.round(share * 100)}%`;

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const padLabel = (label: string): string => `${label}:`.padEnd(26, " ");

const topLimit = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

const renderConsoleSection = (
  title: string,
  lines: readonly string[],
  total: number,
  top: number,
): string[] => {
  if (total === 0) {
    return [`${title}: none`];
  }

  const shown = lines.slice(0, topLimit(top));
  const remaining = total - shown.length;
  return [
    title,
    ...shown.map((line) => `  ${line}`),
    ...(remaining > 0 ? [`  ... ${plural(remaining, "more file", "more files")}`] : []),
  ];
};

const statusFiles = (
  files: readonly FileOwnershipAudit[],
  status: OwnershipStatus,
): readonly FileOwnershipAudit[] => files.filter((file) => file.status === status);

const renderConsole = (report: OwnersReport, top: number): string => {
  const lines: string[] = [];
  lines.push(
    `Ownership audit — ${plural(report.fileCounts.trackedFiles, "tracked file", "tracked files")}, window ${report.windowDays}d, ref ${report.ref}`,
  );

  if (!report.available || report.metrics === null) {
    lines.push("");
    lines.push(`No CODEOWNERS file was found at ${report.ref}.`);
    lines.push(
      "Looked for .github/CODEOWNERS, CODEOWNERS and docs/CODEOWNERS. The ownership audit is unavailable.",
    );
    appendWarnings(lines, report.warnings);
    return lines.join("\n");
  }

  const { metrics, fileCounts, codeowners } = report;
  const source = codeowners === null ? "unknown" : codeowners.source;
  const errors = codeowners === null ? 0 : codeowners.errorCount;
  lines.push(
    `CODEOWNERS ${source} · ${plural(codeowners?.entryCount ?? 0, "entry", "entries")} · ${plural(errors, "invalid line", "invalid lines")}`,
  );
  lines.push("");
  lines.push(
    `${padLabel("Declared coverage")}${formatPercent(metrics.declaredCoveragePercent)}  (${fileCounts.declaredFiles}/${fileCounts.trackedFiles})`,
  );
  lines.push(
    `${padLabel("Critical coverage")}${formatPercent(metrics.declaredCoverageCriticalPercent)}  (${fileCounts.declaredCriticalFiles}/${fileCounts.criticalFiles})`,
  );
  lines.push(
    `${padLabel("Drift")}${formatPercent(metrics.driftPercent)}  (${fileCounts.driftedFiles}/${fileCounts.declaredFiles} declared files)`,
  );
  lines.push(
    `${padLabel("Owners without activity")}${plural(metrics.ghostOwnerCount, "owner", "owners")}`,
  );
  lines.push(`${padLabel("Unowned critical")}${metrics.unownedCriticalCount}`);
  lines.push(`${padLabel("Single-owner modules")}${metrics.singleOwnerModuleCount}`);
  lines.push("");

  const unownedCritical = statusFiles(report.files, "unowned-critical");
  lines.push(
    ...renderConsoleSection(
      "Unowned critical",
      unownedCritical.map(
        (file) =>
          `${file.filePath}  fan-in ${file.criticality.fanIn ?? "n/a"}  commits ${file.observed.commits}  authors ${file.observed.authors}`,
      ),
      unownedCritical.length,
      top,
    ),
  );
  lines.push("");

  const drifted = statusFiles(report.files, "drifted");
  lines.push(
    ...renderConsoleSection(
      "Drift — declared owner is not the top recent author",
      drifted.map(
        (file) =>
          `${file.filePath}  declared ${formatDeclaredOwners(file.declared)}  observed ${file.observed.topAuthorId ?? "unknown"} (${formatShare(file.observed.topAuthorShare)})`,
      ),
      drifted.length,
      top,
    ),
  );
  lines.push("");

  const ghosts = report.ghostOwners;
  lines.push(
    ...renderConsoleSection(
      "Ghost owners — declared, no commits in the window",
      ghosts.map(
        (entry) =>
          `${formatDeclaredOwner(entry.owner)}  ${entry.samplePaths.join(", ") || "no sample path"}`,
      ),
      ghosts.length,
      top,
    ),
  );

  appendWarnings(lines, report.warnings);
  return lines.join("\n");
};

const appendWarnings = (lines: string[], warnings: readonly string[]): void => {
  if (warnings.length === 0) return;
  lines.push("");
  lines.push("Warnings");
  for (const warning of warnings) {
    lines.push(`  - ${warning}`);
  }
};

const escapeTableCell = (value: string): string => value.replace(/\|/g, "\\|");

const renderMarkdownTable = (header: readonly string[], rows: readonly string[][]): string[] => {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of rows) {
    lines.push(`| ${row.map(escapeTableCell).join(" | ")} |`);
  }
  return lines;
};

const renderMarkdown = (report: OwnersReport, top: number): string => {
  const lines: string[] = [];
  lines.push("# Ownership audit");
  lines.push("");
  lines.push(`- ref: \`${report.ref}\``);
  lines.push(`- window: ${report.windowDays} days`);
  lines.push(`- tracked files: ${report.fileCounts.trackedFiles}`);
  lines.push(`- minimum commits per file: ${report.minCommits}`);

  if (!report.available || report.metrics === null) {
    lines.push("- CODEOWNERS: not found");
    lines.push("");
    lines.push(
      `No CODEOWNERS file was found at \`${report.ref}\` (looked for \`.github/CODEOWNERS\`, \`CODEOWNERS\` and \`docs/CODEOWNERS\`). The ownership audit is unavailable.`,
    );
    if (report.warnings.length > 0) {
      lines.push("");
      lines.push("## Warnings");
      lines.push("");
      for (const warning of report.warnings) {
        lines.push(`- ${warning}`);
      }
    }
    return lines.join("\n");
  }

  const { metrics, fileCounts, codeowners } = report;
  const source = codeowners === null ? "unknown" : codeowners.source;
  lines.push(`- CODEOWNERS: \`${source}\``);
  if (codeowners !== null && codeowners.ignoredSources.length > 0) {
    lines.push(
      `- ignored sources: ${codeowners.ignoredSources.map((item) => `\`${item}\``).join(", ")}`,
    );
  }
  lines.push("");

  lines.push("## Metrics");
  lines.push("");
  lines.push(
    ...renderMarkdownTable(
      ["Metric", "Value"],
      [
        [
          "Declared coverage",
          `${formatPercent(metrics.declaredCoveragePercent)} (${fileCounts.declaredFiles}/${fileCounts.trackedFiles})`,
        ],
        [
          "Critical coverage",
          `${formatPercent(metrics.declaredCoverageCriticalPercent)} (${fileCounts.declaredCriticalFiles}/${fileCounts.criticalFiles})`,
        ],
        [
          "Drift",
          `${formatPercent(metrics.driftPercent)} (${fileCounts.driftedFiles}/${fileCounts.declaredFiles})`,
        ],
        ["Owners without activity", `${metrics.ghostOwnerCount}`],
        ["Unowned critical", `${metrics.unownedCriticalCount}`],
        ["Single-owner modules", `${metrics.singleOwnerModuleCount}`],
      ],
    ),
  );

  const unownedCritical = statusFiles(report.files, "unowned-critical").slice(0, topLimit(top));
  lines.push("");
  lines.push("## Unowned critical");
  lines.push("");
  lines.push(
    ...(unownedCritical.length === 0
      ? ["None."]
      : renderMarkdownTable(
          ["Path", "Fan-in", "Commits", "Authors"],
          unownedCritical.map((file) => [
            `\`${file.filePath}\``,
            `${file.criticality.fanIn ?? "n/a"}`,
            `${file.observed.commits}`,
            `${file.observed.authors}`,
          ]),
        )),
  );

  const drifted = statusFiles(report.files, "drifted").slice(0, topLimit(top));
  lines.push("");
  lines.push("## Drift — declared owner is not the top recent author");
  lines.push("");
  lines.push(
    ...(drifted.length === 0
      ? ["None."]
      : renderMarkdownTable(
          ["Path", "Declared", "Observed", "Share"],
          drifted.map((file) => [
            `\`${file.filePath}\``,
            formatDeclaredOwners(file.declared),
            file.observed.topAuthorId ?? "unknown",
            formatShare(file.observed.topAuthorShare),
          ]),
        )),
  );

  const ghosts = report.ghostOwners.slice(0, topLimit(top));
  lines.push("");
  lines.push("## Ghost owners — declared, no commits in the window");
  lines.push("");
  lines.push(
    ...(ghosts.length === 0
      ? ["None."]
      : renderMarkdownTable(
          ["Owner", "Sample paths"],
          ghosts.map((entry) => [
            formatDeclaredOwner(entry.owner),
            entry.samplePaths.join(", ") || "no sample path",
          ]),
        )),
  );

  if (report.thresholds.violations.length > 0) {
    lines.push("");
    lines.push("## Threshold violations");
    lines.push("");
    for (const violation of report.thresholds.violations) {
      lines.push(`- \`${violation.threshold}\`: ${violation.message}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
};

export const formatOwnersOutput = (
  report: OwnersReport,
  format: OwnersOutputFormat,
  top: number,
  sarifContext?: OwnersSarifContext,
): string => {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format === "sarif") {
    return formatOwnersSarif(report, sarifContext ?? DEFAULT_SARIF_CONTEXT);
  }

  return format === "md" ? renderMarkdown(report, top) : renderConsole(report, top);
};
