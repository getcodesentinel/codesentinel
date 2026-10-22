import type { AnalyzeSummary, RiskTrace } from "@codesentinel/core";
import {
  RISK_MODEL_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS,
  type CodeSentinelSnapshot,
  type OwnershipAuditReport,
  type SupportedSnapshotSchemaVersion,
} from "./domain.js";

export type CreateSnapshotInput = {
  analysis: AnalyzeSummary;
  trace?: RiskTrace;
  generatedAt?: string;
  analysisConfig?: Readonly<Record<string, string | number | boolean | null>>;
  source?: { commit?: string; ref?: string };
  ownership?: OwnershipAuditReport;
};

export const createSnapshot = (input: CreateSnapshotInput): CodeSentinelSnapshot => ({
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  generatedAt: input.generatedAt ?? new Date().toISOString(),
  riskModelVersion: RISK_MODEL_VERSION,
  source: {
    targetPath: input.analysis.structural.targetPath,
    ...(input.source?.commit === undefined ? {} : { commit: input.source.commit }),
    ...(input.source?.ref === undefined ? {} : { ref: input.source.ref }),
  },
  analysis: input.analysis,
  ...(input.trace === undefined ? {} : { trace: input.trace }),
  ...(input.analysisConfig === undefined ? {} : { analysisConfig: input.analysisConfig }),
  ...(input.ownership === undefined ? {} : { ownership: input.ownership }),
});

const isSupportedSchemaVersion = (value: unknown): value is SupportedSnapshotSchemaVersion =>
  typeof value === "string" &&
  (SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS as readonly string[]).includes(value);

export const parseSnapshot = (raw: string): CodeSentinelSnapshot => {
  const parsed = JSON.parse(raw) as Partial<CodeSentinelSnapshot>;
  if (!isSupportedSchemaVersion(parsed.schemaVersion)) {
    throw new Error("unsupported_snapshot_schema");
  }

  if (typeof parsed.generatedAt !== "string") {
    throw new Error("invalid_snapshot_generated_at");
  }

  if (parsed.analysis === undefined || parsed.analysis === null) {
    throw new Error("invalid_snapshot_analysis");
  }

  if (parsed.source === undefined || typeof parsed.source.targetPath !== "string") {
    throw new Error("invalid_snapshot_source");
  }

  if (
    parsed.source.commit !== undefined &&
    (typeof parsed.source.commit !== "string" || parsed.source.commit.length === 0)
  ) {
    throw new Error("invalid_snapshot_source_commit");
  }

  if (
    parsed.source.ref !== undefined &&
    (typeof parsed.source.ref !== "string" || parsed.source.ref.length === 0)
  ) {
    throw new Error("invalid_snapshot_source_ref");
  }

  if (
    parsed.ownership !== undefined &&
    (typeof parsed.ownership !== "object" ||
      parsed.ownership === null ||
      Array.isArray(parsed.ownership))
  ) {
    throw new Error("invalid_snapshot_ownership");
  }

  return parsed as CodeSentinelSnapshot;
};
