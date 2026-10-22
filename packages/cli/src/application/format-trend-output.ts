/**
 * Report payload and renderers for `codesentinel trend`.
 *
 * The payload is the JSON contract. Console and Markdown are rendered from the same object, so the
 * three formats always describe the same series.
 */

export const TREND_SCHEMA_VERSION = "codesentinel.trend.v1";

export type TrendOutputFormat = "console" | "json" | "md";

export type TrendOwnership = {
  unownedCritical: number;
  ghostOwners: number;
  driftPercent: number;
};

export type TrendPoint = {
  file: string;
  generatedAt: string;
  commit: string | null;
  riskScore: number;
  healthScore: number;
  ownership: TrendOwnership | null;
};

export type TrendDeltas = {
  riskScore: number;
  healthScore: number;
  unownedCritical: number | null;
  ghostOwners: number | null;
  driftPercent: number | null;
};

export type TrendReport = {
  schemaVersion: typeof TREND_SCHEMA_VERSION;
  series: readonly TrendPoint[];
  deltas: TrendDeltas | null;
  warnings: readonly string[];
};

export const buildTrendReport = (
  series: readonly TrendPoint[],
  warnings: readonly string[],
): TrendReport => {
  const first = series[0];
  const last = series[series.length - 1];
  const deltas =
    series.length < 2 || first === undefined || last === undefined
      ? null
      : buildDeltas(first, last);

  return {
    schemaVersion: TREND_SCHEMA_VERSION,
    series: [...series],
    deltas,
    warnings: [...warnings],
  };
};

export const roundToHundredths = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

const buildDeltas = (first: TrendPoint, last: TrendPoint): TrendDeltas => ({
  riskScore: roundToHundredths(last.riskScore - first.riskScore),
  healthScore: roundToHundredths(last.healthScore - first.healthScore),
  unownedCritical:
    first.ownership === null || last.ownership === null
      ? null
      : roundToHundredths(last.ownership.unownedCritical - first.ownership.unownedCritical),
  ghostOwners:
    first.ownership === null || last.ownership === null
      ? null
      : roundToHundredths(last.ownership.ghostOwners - first.ownership.ghostOwners),
  driftPercent:
    first.ownership === null || last.ownership === null
      ? null
      : roundToHundredths(last.ownership.driftPercent - first.ownership.driftPercent),
});

const formatDate = (value: string): string =>
  new Date(value).toISOString().slice(0, 16).replace("T", " ");

const formatCommit = (commit: string | null): string =>
  commit === null ? "—" : commit.slice(0, 7);

const formatNumber = (value: number): string => String(roundToHundredths(value));

const formatPercent = (value: number): string => `${formatNumber(value)}%`;

const formatDelta = (value: number): string => {
  const rounded = roundToHundredths(value);
  return rounded === 0 ? "0" : rounded > 0 ? `+${formatNumber(rounded)}` : formatNumber(rounded);
};

const pointCells = (point: TrendPoint): string[] => [
  formatDate(point.generatedAt),
  formatCommit(point.commit),
  formatNumber(point.riskScore),
  formatNumber(point.healthScore),
  point.ownership === null ? "—" : formatNumber(point.ownership.unownedCritical),
  point.ownership === null ? "—" : formatNumber(point.ownership.ghostOwners),
  point.ownership === null ? "—" : formatPercent(point.ownership.driftPercent),
];

const renderDeltas = (deltas: TrendDeltas): string =>
  [
    `Δ risk ${formatDelta(deltas.riskScore)}`,
    `Δ health ${formatDelta(deltas.healthScore)}`,
    `Δ unowned ${deltas.unownedCritical === null ? "—" : formatDelta(deltas.unownedCritical)}`,
    `Δ ghosts ${deltas.ghostOwners === null ? "—" : formatDelta(deltas.ghostOwners)}`,
    `Δ drift ${deltas.driftPercent === null ? "—" : `${formatDelta(deltas.driftPercent)}pp`}`,
  ].join("  ");

const renderHeader = (report: TrendReport): string => {
  const count = report.series.length;
  const label = `${count} ${count === 1 ? "snapshot" : "snapshots"}`;
  const first = report.series[0];
  const last = report.series[count - 1];
  if (first === undefined || last === undefined) {
    return `Snapshot trend — ${label}`;
  }

  return `Snapshot trend — ${label} (${formatDate(first.generatedAt)} → ${formatDate(last.generatedAt)})`;
};

const appendWarnings = (lines: string[], warnings: readonly string[]): void => {
  if (warnings.length === 0) return;
  lines.push("");
  lines.push("Warnings");
  for (const warning of warnings) {
    lines.push(`  - ${warning}`);
  }
};

const TREND_HEADERS = ["Date", "Commit", "Risk", "Health", "Unowned", "Ghosts", "Drift"];

const renderAlignedRow = (cells: readonly string[], widths: readonly number[]): string =>
  cells
    .map((cell, index) => {
      const width = widths[index] ?? cell.length;
      return index < 2 ? cell.padEnd(width) : cell.padStart(width);
    })
    .join("  ");

const renderConsole = (report: TrendReport): string => {
  const rows = report.series.map(pointCells);
  const widths = TREND_HEADERS.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );

  const lines: string[] = [renderHeader(report), ""];
  lines.push(renderAlignedRow(TREND_HEADERS, widths).trimEnd());
  for (const row of rows) {
    lines.push(renderAlignedRow(row, widths).trimEnd());
  }

  if (report.deltas === null) {
    lines.push("");
    lines.push("not enough history for a trend");
  } else {
    lines.push("");
    lines.push(renderDeltas(report.deltas));
  }

  appendWarnings(lines, report.warnings);
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

const renderMarkdown = (report: TrendReport): string => {
  const lines: string[] = ["# Snapshot trend", ""];
  lines.push(`- snapshots: ${report.series.length}`);
  const first = report.series[0];
  const last = report.series[report.series.length - 1];
  if (first !== undefined && last !== undefined) {
    lines.push(`- window: ${formatDate(first.generatedAt)} → ${formatDate(last.generatedAt)}`);
  }
  lines.push("");
  lines.push(...renderMarkdownTable(TREND_HEADERS, report.series.map(pointCells)));

  if (report.deltas === null) {
    lines.push("");
    lines.push("not enough history for a trend");
  } else {
    lines.push("");
    lines.push(renderDeltas(report.deltas));
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

export const formatTrendOutput = (report: TrendReport, format: TrendOutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  return format === "md" ? renderMarkdown(report) : renderConsole(report);
};
