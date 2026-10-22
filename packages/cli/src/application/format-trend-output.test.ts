import { describe, expect, it } from "vitest";
import {
  TREND_SCHEMA_VERSION,
  buildTrendReport,
  formatTrendOutput,
  type TrendPoint,
} from "./format-trend-output.js";

const point = (overrides: Partial<TrendPoint> = {}): TrendPoint => ({
  file: "snapshot.json",
  generatedAt: "2026-09-01T10:00:00.000Z",
  commit: "3f2a1c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  riskScore: 62,
  healthScore: 71,
  ownership: { unownedCritical: 4, ghostOwners: 2, driftPercent: 18 },
  ...overrides,
});

const consoleReport = () =>
  buildTrendReport(
    [
      point(),
      point({
        file: "second.json",
        generatedAt: "2026-10-01T10:00:00.000Z",
        commit: "9b1e004aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        riskScore: 58,
        healthScore: 74,
        ownership: { unownedCritical: 3, ghostOwners: 2, driftPercent: 15 },
      }),
      point({
        file: "third.json",
        generatedAt: "2026-10-21T10:00:00.000Z",
        commit: "0efe2d1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        riskScore: 54,
        healthScore: 78,
        ownership: { unownedCritical: 1, ghostOwners: 1, driftPercent: 11 },
      }),
    ],
    [],
  );

const fractionalReport = () =>
  buildTrendReport(
    [
      point({
        generatedAt: "2026-10-22T11:33:00.000Z",
        commit: null,
        riskScore: 39.6,
        healthScore: 80.2477,
        ownership: null,
      }),
      point({
        file: "second.json",
        generatedAt: "2026-10-23T11:33:00.000Z",
        commit: null,
        riskScore: 28.35,
        healthScore: 84.4701,
        ownership: null,
      }),
    ],
    [],
  );

const tokenizeColumns = (line: string): { text: string; end: number }[] =>
  [...line.matchAll(/\S+(?: \S+)*/g)].map((match) => ({
    text: match[0],
    end: (match.index ?? 0) + match[0].length,
  }));

describe("formatTrendOutput", () => {
  it("renders the stable console table and delta line", () => {
    const rendered = formatTrendOutput(consoleReport(), "console");
    expect(rendered).toBe(
      [
        "Snapshot trend — 3 snapshots (2026-09-01 10:00 → 2026-10-21 10:00)",
        "",
        "Date              Commit   Risk  Health  Unowned  Ghosts  Drift",
        "2026-09-01 10:00  3f2a1c9    62      71        4       2    18%",
        "2026-10-01 10:00  9b1e004    58      74        3       2    15%",
        "2026-10-21 10:00  0efe2d1    54      78        1       1    11%",
        "",
        "Δ risk -8  Δ health +7  Δ unowned -3  Δ ghosts -1  Δ drift -7pp",
      ].join("\n"),
    );
  });

  it("rounds rendered numbers and derived deltas", () => {
    const report = fractionalReport();

    expect(report.deltas?.riskScore).toBe(-11.25);
    expect(report.deltas?.healthScore).toBe(4.22);

    const rendered = formatTrendOutput(report, "console");
    expect(rendered).toContain("Δ risk -11.25");
    expect(rendered).toContain("80.25");
    expect(rendered).toContain("84.47");
    expect(rendered).not.toMatch(/9999|0000000/);
  });

  it("rounds deltas without rewriting raw series values", () => {
    const report = buildTrendReport(
      [
        point({ riskScore: 39.6, generatedAt: "2026-10-22T11:33:00.000Z" }),
        point({
          file: "second.json",
          generatedAt: "2026-10-23T11:33:00.000Z",
          riskScore: 38.9498,
        }),
      ],
      [],
    );

    expect(report.deltas?.riskScore).toBe(-0.65);
    expect(report.series[1]?.riskScore).toBe(38.9498);
    expect(formatTrendOutput(report, "console")).toContain("Δ risk -0.65");
    expect(formatTrendOutput(report, "md")).toContain("Δ risk -0.65");
  });

  it("aligns console headers and cells on column boundaries", () => {
    const lines = formatTrendOutput(fractionalReport(), "console").split("\n");
    const header = lines[2] ?? "";
    const row = lines[3] ?? "";
    const headerColumns = tokenizeColumns(header);
    const rowColumns = tokenizeColumns(row);

    expect(header.split(/ {2,}/)).toHaveLength(7);
    expect(row.split(/ {2,}/)).toHaveLength(7);
    expect(headerColumns).toHaveLength(7);
    expect(rowColumns).toHaveLength(7);
    for (let index = 2; index < 7; index += 1) {
      expect(headerColumns[index]?.end).toBe(rowColumns[index]?.end);
    }
  });

  it("renders markdown from the same payload", () => {
    const rendered = formatTrendOutput(consoleReport(), "md");
    expect(rendered).toContain("# Snapshot trend");
    expect(rendered).toContain("- snapshots: 3");
    expect(rendered).toContain("- window: 2026-09-01 10:00 → 2026-10-21 10:00");
    expect(rendered).toContain("| Date | Commit | Risk | Health | Unowned | Ghosts | Drift |");
    expect(rendered).toContain("| 2026-09-01 10:00 | 3f2a1c9 | 62 | 71 | 4 | 2 | 18% |");
    expect(rendered).toContain("Δ risk -8  Δ health +7  Δ unowned -3  Δ ghosts -1  Δ drift -7pp");
  });

  it("keeps missing ownership cells and deltas explicit", () => {
    const report = buildTrendReport(
      [
        point({ ownership: null, commit: null }),
        point({
          file: "second.json",
          generatedAt: "2026-10-01T10:00:00.000Z",
          ownership: null,
          commit: null,
        }),
      ],
      [],
    );

    const rendered = formatTrendOutput(report, "console");
    expect(rendered).toContain("—");
    expect(report.deltas?.unownedCritical).toBeNull();
    expect(report.deltas?.ghostOwners).toBeNull();
    expect(report.deltas?.driftPercent).toBeNull();
  });

  it("renders fewer than two points without a delta line", () => {
    const report = buildTrendReport([point()], []);
    const rendered = formatTrendOutput(report, "console");
    expect(report.deltas).toBeNull();
    expect(rendered).toContain("not enough history for a trend");
    expect(rendered).not.toContain("Δ risk");
  });

  it("appends warnings to console and markdown output", () => {
    const report = buildTrendReport([point()], ["skipped broken.json: invalid JSON"]);
    expect(formatTrendOutput(report, "console")).toContain(
      "Warnings\n  - skipped broken.json: invalid JSON",
    );
    expect(formatTrendOutput(report, "md")).toContain(
      "## Warnings\n\n- skipped broken.json: invalid JSON",
    );
  });

  it("serializes the same payload as JSON", () => {
    const report = consoleReport();
    expect(JSON.parse(formatTrendOutput(report, "json"))).toEqual({
      schemaVersion: TREND_SCHEMA_VERSION,
      series: report.series,
      deltas: report.deltas,
      warnings: [],
    });
  });
});
