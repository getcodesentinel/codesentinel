import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTrendCommand, TrendConfigurationError } from "./run-trend-command.js";
import type { TrendReport } from "./format-trend-output.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "codesentinel-trend-"));
  temporaryDirectories.push(directory);
  return directory;
};

const snapshotFixture = (input: {
  generatedAt: string;
  riskScore: number;
  healthScore: number;
  commit?: string;
  ownership?: { unownedCriticalCount: number; ghostOwnerCount: number; driftPercent: number };
}): Record<string, unknown> => ({
  schemaVersion: "codesentinel.snapshot.v1",
  generatedAt: input.generatedAt,
  riskModelVersion: "deterministic-v1",
  source: { targetPath: "." },
  analysis: {
    risk: { riskScore: input.riskScore, normalizedScore: 0 },
    health: { healthScore: input.healthScore, normalizedScore: 0 },
  },
  ...(input.commit === undefined ? {} : { commit: input.commit }),
  ...(input.ownership === undefined
    ? {}
    : { ownership: { available: true, metrics: input.ownership } }),
});

const writeSnapshot = (
  directory: string,
  fileName: string,
  input: Parameters<typeof snapshotFixture>[0],
): void => {
  writeFileSync(join(directory, fileName), JSON.stringify(snapshotFixture(input)), "utf8");
};

const writeRaw = (directory: string, fileName: string, content: string): void => {
  writeFileSync(join(directory, fileName), content, "utf8");
};

const ownership = (
  unownedCriticalCount: number,
  ghostOwnerCount: number,
  driftPercent: number,
) => ({
  unownedCriticalCount,
  ghostOwnerCount,
  driftPercent,
});

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("runTrendCommand", () => {
  it("orders a directory series and computes deltas", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "late.json", {
      generatedAt: "2026-10-21T10:00:00.000Z",
      riskScore: 54,
      healthScore: 78,
      commit: "0efe2d1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownership: ownership(1, 1, 11),
    });
    writeSnapshot(directory, "early.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
      commit: "3f2a1c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownership: ownership(4, 2, 18),
    });

    const result = await runTrendCommand({ from: directory });

    expect(result.exitCode).toBe(0);
    expect(result.report.series.map((point) => point.file)).toEqual(["early.json", "late.json"]);
    expect(result.report.deltas).toEqual({
      riskScore: -8,
      healthScore: 7,
      unownedCritical: -3,
      ghostOwners: -1,
      driftPercent: -7,
    });
  });

  it("renders the console header, rows and delta line", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
      commit: "3f2a1c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownership: ownership(4, 2, 18),
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-21T10:00:00.000Z",
      riskScore: 54,
      healthScore: 78,
      commit: "0efe2d1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownership: ownership(1, 1, 11),
    });

    const result = await runTrendCommand({ from: directory });

    expect(result.rendered).toContain(
      "Snapshot trend — 2 snapshots (2026-09-01 10:00 → 2026-10-21 10:00)",
    );
    expect(result.rendered).toContain("3f2a1c9");
    expect(result.rendered).toContain("0efe2d1");
    expect(result.rendered).toContain(
      "Δ risk -8  Δ health +7  Δ unowned -3  Δ ghosts -1  Δ drift -7pp",
    );
  });

  it("keeps a single snapshot as a non-error", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "only.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });

    const result = await runTrendCommand({ from: directory });

    expect(result.exitCode).toBe(0);
    expect(result.report.deltas).toBeNull();
    expect(result.report.series).toHaveLength(1);
    expect(result.rendered).toContain("not enough history for a trend");
  });

  it("skips a corrupt file and keeps the readable series", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-01T10:00:00.000Z",
      riskScore: 58,
      healthScore: 74,
    });
    writeRaw(directory, "broken.json", "{not json");

    const result = await runTrendCommand({ from: directory });

    expect(result.exitCode).toBe(0);
    expect(result.report.series).toHaveLength(2);
    expect(result.report.warnings).toEqual(["skipped broken.json: invalid JSON"]);
    expect(result.rendered).toContain("skipped broken.json: invalid JSON");
  });

  it("skips an unknown schema version without affecting other files", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "good.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });
    writeRaw(
      directory,
      "unknown.json",
      JSON.stringify({
        ...snapshotFixture({
          generatedAt: "2026-10-01T10:00:00.000Z",
          riskScore: 58,
          healthScore: 74,
        }),
        schemaVersion: "codesentinel.snapshot.v0",
      }),
    );

    const result = await runTrendCommand({ from: directory });

    expect(result.report.series.map((point) => point.file)).toEqual(["good.json"]);
    expect(result.report.warnings).toEqual([
      'skipped unknown.json: unsupported schema version "codesentinel.snapshot.v0"',
    ]);
  });

  it("never substitutes zero for a missing ownership block", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-01T10:00:00.000Z",
      riskScore: 58,
      healthScore: 74,
    });

    const result = await runTrendCommand({ from: directory });
    const json = await runTrendCommand({ from: directory, format: "json" });
    const parsed = JSON.parse(json.rendered) as TrendReport;

    expect(result.report.series.every((point) => point.ownership === null)).toBe(true);
    expect(result.report.deltas?.unownedCritical).toBeNull();
    expect(result.report.deltas?.ghostOwners).toBeNull();
    expect(result.report.deltas?.driftPercent).toBeNull();
    expect(parsed.series.every((point) => point.ownership === null)).toBe(true);
    expect(result.rendered).toContain("—");
  });

  it("treats a glob the same as the directory input", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-01T10:00:00.000Z",
      riskScore: 58,
      healthScore: 74,
    });

    const fromDirectory = await runTrendCommand({ from: directory });
    const fromGlob = await runTrendCommand({ from: join(directory, "*.json") });

    expect(fromGlob.report.series).toEqual(fromDirectory.report.series);
    expect(fromGlob.report.deltas).toEqual(fromDirectory.report.deltas);
  });

  it("renders byte-identical JSON without absolute paths", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
      commit: "3f2a1c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const first = await runTrendCommand({ from: directory, format: "json" });
    const second = await runTrendCommand({ from: directory, format: "json" });

    expect(first.rendered).toBe(second.rendered);
    expect(first.rendered).not.toContain(directory);
  });

  it("rejects a missing --from", async () => {
    await expect(runTrendCommand({})).rejects.toBeInstanceOf(TrendConfigurationError);
    await expect(runTrendCommand({})).rejects.toThrow("--from is required");
  });

  it("rejects an empty directory", async () => {
    const directory = createTemporaryDirectory();
    await expect(runTrendCommand({ from: directory })).rejects.toBeInstanceOf(
      TrendConfigurationError,
    );
  });

  it("applies --last to the newest snapshots", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-01T10:00:00.000Z",
      riskScore: 58,
      healthScore: 74,
    });

    const result = await runTrendCommand({ from: directory, last: 1 });

    expect(result.report.series.map((point) => point.file)).toEqual(["second.json"]);
    expect(result.report.deltas).toBeNull();
    expect(result.rendered).toContain("not enough history for a trend");
  });

  it("applies --since against the injected clock", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "old.json", {
      generatedAt: "2026-01-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
    });
    writeSnapshot(directory, "recent.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 58,
      healthScore: 74,
    });

    const result = await runTrendCommand({
      from: directory,
      since: "90d",
      now: () => new Date("2026-10-01T00:00:00.000Z"),
    });

    expect(result.report.series.map((point) => point.file)).toEqual(["recent.json"]);
  });

  it("collapses duplicate generatedAt and commit pairs by file name", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "b.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 58,
      healthScore: 74,
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    writeSnapshot(directory, "a.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    writeSnapshot(directory, "c.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 54,
      healthScore: 78,
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const result = await runTrendCommand({ from: directory });

    expect(result.report.series.map((point) => point.file)).toEqual(["a.json", "c.json"]);
    expect(result.report.series[0]?.riskScore).toBe(62);
  });

  it("rounds rendered scores while keeping raw series values in JSON", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-10-22T11:33:00.000Z",
      riskScore: 39.6,
      healthScore: 80.2477,
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-23T11:33:00.000Z",
      riskScore: 28.35,
      healthScore: 84.4701,
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const output = await runTrendCommand({ from: directory });
    const json = await runTrendCommand({ from: directory, format: "json" });
    const parsed = JSON.parse(json.rendered) as TrendReport;

    expect(output.rendered).toContain("80.25");
    expect(output.rendered).toContain("84.47");
    expect(output.rendered).toContain("Δ risk -11.25");
    expect(output.rendered).not.toContain("80.2477");
    expect(output.rendered).not.toMatch(/9999|0000000/);
    expect(parsed.series[0]?.healthScore).toBe(80.2477);
    expect(parsed.series[1]?.riskScore).toBe(28.35);
    expect(parsed.deltas?.riskScore).toBe(-11.25);
  });

  it("renders markdown with the table header and delta line", async () => {
    const directory = createTemporaryDirectory();
    writeSnapshot(directory, "first.json", {
      generatedAt: "2026-09-01T10:00:00.000Z",
      riskScore: 62,
      healthScore: 71,
      commit: "3f2a1c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownership: ownership(4, 2, 18),
    });
    writeSnapshot(directory, "second.json", {
      generatedAt: "2026-10-21T10:00:00.000Z",
      riskScore: 54,
      healthScore: 78,
      commit: "0efe2d1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownership: ownership(1, 1, 11),
    });

    const result = await runTrendCommand({ from: directory, format: "md" });

    expect(result.rendered).toContain(
      "| Date | Commit | Risk | Health | Unowned | Ghosts | Drift |",
    );
    expect(result.rendered).toContain(
      "Δ risk -8  Δ health +7  Δ unowned -3  Δ ghosts -1  Δ drift -7pp",
    );
  });
});
