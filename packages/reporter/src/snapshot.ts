import type { AnalyzeSummary, RiskTrace } from "@codesentinel/core";
import {
  RISK_MODEL_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  type CodeSentinelSnapshot,
} from "./domain.js";

export type CreateSnapshotInput = {
  analysis: AnalyzeSummary;
  trace?: RiskTrace;
  generatedAt?: string;
  analysisConfig?: Readonly<Record<string, string | number | boolean | null>>;
};

export const createSnapshot = (input: CreateSnapshotInput): CodeSentinelSnapshot => ({
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  generatedAt: input.generatedAt ?? new Date().toISOString(),
  riskModelVersion: RISK_MODEL_VERSION,
  source: {
    targetPath: input.analysis.structural.targetPath,
  },
  analysis: input.analysis,
  ...(input.trace === undefined ? {} : { trace: input.trace }),
  ...(input.analysisConfig === undefined ? {} : { analysisConfig: input.analysisConfig }),
});

export const parseSnapshot = (raw: string): CodeSentinelSnapshot => {
  const parsed = JSON.parse(raw) as Partial<CodeSentinelSnapshot>;
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
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

  return parsed as CodeSentinelSnapshot;
};
