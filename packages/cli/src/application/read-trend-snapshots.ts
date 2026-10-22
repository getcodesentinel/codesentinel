import { glob, readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { SNAPSHOT_SCHEMA_VERSION } from "@codesentinel/reporter";
import type { TrendOwnership, TrendPoint } from "./format-trend-output.js";

/**
 * Discovery, tolerant parsing and filtering for `codesentinel trend`.
 *
 * Snapshots are CI artifacts, not repository files. Every file is parsed independently so one
 * stale or corrupt artifact cannot hide the rest of the history.
 */

export class TrendConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrendConfigurationError";
  }
}

export type ReadTrendSnapshotsOptions = {
  from?: string;
  since?: string;
  last?: number;
  now?: () => Date;
};

export type ReadTrendSnapshotsResult = {
  series: readonly TrendPoint[];
  warnings: readonly string[];
};

type SnapshotFile = {
  path: string;
  name: string;
};

type ParsedSnapshot = { point: TrendPoint; warning: null } | { point: null; warning: string };

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const readCommit = (snapshot: Record<string, unknown>): string | null => {
  const candidates = [
    snapshot["commit"],
    asRecord(snapshot["git"])?.["commit"],
    asRecord(snapshot["source"])?.["commit"],
    asRecord(snapshot["analysisConfig"])?.["commit"],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
};

const readOwnership = (snapshot: Record<string, unknown>): TrendOwnership | null => {
  const ownership = asRecord(snapshot["ownership"]);
  if (ownership === null || ownership["available"] === false) {
    return null;
  }

  const source = asRecord(ownership["metrics"]) ?? ownership;
  const unownedCritical = source["unownedCriticalCount"];
  const ghostOwners = source["ghostOwnerCount"];
  const driftPercent = source["driftPercent"];

  if (
    !isFiniteNumber(unownedCritical) ||
    !isFiniteNumber(ghostOwners) ||
    !isFiniteNumber(driftPercent)
  ) {
    return null;
  }

  return { unownedCritical, ghostOwners, driftPercent };
};

const formatSchemaVersion = (value: unknown): string => {
  if (value === undefined) return "missing";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value) ?? "invalid";
};

const parseSnapshot = (fileName: string, content: string): ParsedSnapshot => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { point: null, warning: `skipped ${fileName}: invalid JSON` };
  }

  const snapshot = asRecord(parsed);
  if (snapshot === null) {
    return { point: null, warning: `skipped ${fileName}: unsupported schema version "missing"` };
  }

  const schemaVersion = snapshot["schemaVersion"];
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    const label = formatSchemaVersion(schemaVersion);
    return {
      point: null,
      warning: `skipped ${fileName}: unsupported schema version "${label}"`,
    };
  }

  const generatedAt = snapshot["generatedAt"];
  if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
    return { point: null, warning: `skipped ${fileName}: missing or invalid generatedAt` };
  }

  const analysis = asRecord(snapshot["analysis"]);
  const riskScore = asRecord(analysis?.["risk"])?.["riskScore"];
  const healthScore = asRecord(analysis?.["health"])?.["healthScore"];
  if (!isFiniteNumber(riskScore) || !isFiniteNumber(healthScore)) {
    return { point: null, warning: `skipped ${fileName}: missing risk or health score` };
  }

  return {
    point: {
      file: fileName,
      generatedAt,
      commit: readCommit(snapshot),
      riskScore,
      healthScore,
      ownership: readOwnership(snapshot),
    },
    warning: null,
  };
};

const pathExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const discoverSnapshotFiles = async (from: string): Promise<readonly SnapshotFile[]> => {
  const cwd = process.env["INIT_CWD"] ?? process.cwd();
  const resolved = resolve(cwd, from);
  const exists = await pathExists(resolved);

  if (exists) {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      const entries = await readdir(resolved, { withFileTypes: true }).catch(() => {
        throw new TrendConfigurationError(`--from directory is not readable: ${from}`);
      });

      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => ({ path: join(resolved, entry.name), name: entry.name }))
        .sort((a, b) => compareText(a.name, b.name));

      if (files.length === 0) {
        throw new TrendConfigurationError(`no snapshot JSON files found in ${from}`);
      }

      return files;
    }
  }

  const hasGlobMetacharacters = /[*?[\]{}()!]/.test(from);
  if (!exists && !hasGlobMetacharacters) {
    throw new TrendConfigurationError(`--from path not found: ${from}`);
  }

  const matches: string[] = [];
  try {
    for await (const match of glob(from, { cwd })) {
      matches.push(match);
    }
  } catch {
    throw new TrendConfigurationError(`--from pattern could not be read: ${from}`);
  }

  const files: SnapshotFile[] = [];
  for (const match of matches.sort(compareText)) {
    const absolutePath = resolve(cwd, match);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile() || !absolutePath.endsWith(".json")) {
        continue;
      }
    } catch {
      continue;
    }
    files.push({ path: absolutePath, name: basename(absolutePath) });
  }

  if (files.length === 0) {
    throw new TrendConfigurationError(`--from matched no snapshot JSON files: ${from}`);
  }

  return files;
};

const parseSinceDays = (since: string | undefined): number | null => {
  if (since === undefined) {
    return null;
  }

  if (!/^\d+d$/.test(since)) {
    throw new TrendConfigurationError("--since must be a day window like 90d");
  }

  const days = Number.parseInt(since.slice(0, -1), 10);
  if (!Number.isInteger(days) || days <= 0) {
    throw new TrendConfigurationError("--since must be a day window like 90d");
  }

  return days;
};

const parseLast = (last: number | undefined): number | null => {
  if (last === undefined) {
    return null;
  }

  if (!Number.isInteger(last) || last <= 0) {
    throw new TrendConfigurationError("--last must be a positive integer");
  }

  return last;
};

const comparePoints = (a: TrendPoint, b: TrendPoint): number => {
  const timeDifference = Date.parse(a.generatedAt) - Date.parse(b.generatedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return compareText(a.file, b.file);
};

const deduplicatePoints = (points: readonly TrendPoint[]): readonly TrendPoint[] => {
  const seen = new Set<string>();
  const unique: TrendPoint[] = [];
  for (const point of points) {
    const key = point.generatedAt + "\u0000" + (point.commit ?? "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(point);
  }
  return unique;
};

export const readTrendSnapshots = async (
  options: ReadTrendSnapshotsOptions,
): Promise<ReadTrendSnapshotsResult> => {
  const from = options.from;
  if (from === undefined || from.trim().length === 0) {
    throw new TrendConfigurationError("--from is required");
  }

  const sinceDays = parseSinceDays(options.since);
  const last = parseLast(options.last);
  const files = await discoverSnapshotFiles(from);

  const warnings: string[] = [];
  const points: TrendPoint[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch {
      warnings.push(`skipped ${file.name}: invalid JSON`);
      continue;
    }

    const parsed = parseSnapshot(file.name, content);
    if (parsed.point === null) {
      warnings.push(parsed.warning);
      continue;
    }

    points.push(parsed.point);
  }

  if (points.length === 0) {
    throw new TrendConfigurationError("no readable snapshots were found");
  }

  const ordered = deduplicatePoints([...points].sort(comparePoints));

  let filtered = ordered;
  if (sinceDays !== null) {
    const now = (options.now ?? (() => new Date()))();
    const cutoff = now.getTime() - sinceDays * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((point) => Date.parse(point.generatedAt) >= cutoff);
  }

  if (last !== null) {
    filtered = filtered.slice(-last);
  }

  return { series: filtered, warnings };
};
