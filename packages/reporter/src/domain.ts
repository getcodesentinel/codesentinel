import type { AnalyzeSummary, RiskFactorTrace, RiskTrace } from "@codesentinel/core";

export const SNAPSHOT_SCHEMA_VERSION = "codesentinel.snapshot.v1" as const;
export const REPORT_SCHEMA_VERSION = "codesentinel.report.v1" as const;
export const RISK_MODEL_VERSION = "deterministic-v1" as const;

export type SnapshotSchemaVersion = typeof SNAPSHOT_SCHEMA_VERSION;
export type ReportSchemaVersion = typeof REPORT_SCHEMA_VERSION;

export type RiskTier = "low" | "moderate" | "elevated" | "high" | "very_high";

export type ReportFormat = "json" | "text" | "md";

export type CodeSentinelSnapshot = {
  schemaVersion: SnapshotSchemaVersion;
  generatedAt: string;
  riskModelVersion: string;
  source: {
    targetPath: string;
  };
  analysis: AnalyzeSummary;
  trace?: RiskTrace;
  analysisConfig?: Readonly<Record<string, string | number | boolean | null>>;
};

export type RenderedFactor = {
  id: string;
  label: string;
  contribution: number;
  confidence: number;
  evidence: string;
};

export type HotspotReportItem = {
  target: string;
  score: number;
  normalizedScore: number;
  topFactors: readonly RenderedFactor[];
  suggestedActions: readonly string[];
  biggestLevers: readonly string[];
};

export type SnapshotDiff = {
  repositoryScoreDelta: number;
  normalizedScoreDelta: number;
  fileRiskChanges: ReadonlyArray<{ target: string; before: number; after: number; delta: number }>;
  moduleRiskChanges: ReadonlyArray<{ target: string; before: number; after: number; delta: number }>;
  newHotspots: readonly string[];
  resolvedHotspots: readonly string[];
  newCycles: readonly string[];
  resolvedCycles: readonly string[];
  externalChanges: {
    highRiskAdded: readonly string[];
    highRiskRemoved: readonly string[];
    singleMaintainerAdded: readonly string[];
    singleMaintainerRemoved: readonly string[];
    abandonedAdded: readonly string[];
    abandonedRemoved: readonly string[];
  };
};

export type CodeSentinelReport = {
  schemaVersion: ReportSchemaVersion;
  generatedAt: string;
  repository: {
    targetPath: string;
    repositoryScore: number;
    normalizedScore: number;
    riskTier: RiskTier;
    confidence: number | null;
  };
  hotspots: readonly HotspotReportItem[];
  structural: {
    cycleCount: number;
    cycles: readonly string[];
    fragileClusters: ReadonlyArray<{ id: string; kind: string; score: number; files: readonly string[] }>;
  };
  external:
    | {
        available: false;
        reason: string;
      }
    | {
        available: true;
        highRiskDependencies: readonly string[];
        highRiskDevelopmentDependencies: readonly string[];
        singleMaintainerDependencies: readonly string[];
        abandonedDependencies: readonly string[];
      };
  appendix: {
    snapshotSchemaVersion: string;
    riskModelVersion: string;
    timestamp: string;
    normalization: string;
    analysisConfig?: Readonly<Record<string, string | number | boolean | null>>;
  };
  diff?: SnapshotDiff;
};

export const round4 = (value: number): number => Number(value.toFixed(4));

export const toRiskTier = (score: number): RiskTier => {
  if (score < 20) {
    return "low";
  }
  if (score < 40) {
    return "moderate";
  }
  if (score < 60) {
    return "elevated";
  }
  if (score < 80) {
    return "high";
  }
  return "very_high";
};

const factorLabelById: Readonly<Record<string, string>> = {
  "repository.structural": "Structural complexity",
  "repository.evolution": "Change volatility",
  "repository.external": "External dependency pressure",
  "repository.composite.interactions": "Intersection amplification",
  "file.structural": "File structural complexity",
  "file.evolution": "File change volatility",
  "file.external": "File external pressure",
  "file.composite.interactions": "File interaction amplification",
  "module.average_file_risk": "Average file risk",
  "module.peak_file_risk": "Peak file risk",
  "dependency.signals": "Dependency risk signals",
  "dependency.staleness": "Dependency staleness",
  "dependency.maintainer_concentration": "Maintainer concentration",
  "dependency.topology": "Dependency topology pressure",
  "dependency.bus_factor": "Dependency bus factor",
  "dependency.popularity_dampening": "Popularity dampening",
};

export const factorLabel = (factorId: string): string => factorLabelById[factorId] ?? factorId;

export const summarizeEvidence = (factor: RiskFactorTrace): string => {
  const entries = Object.entries(factor.rawMetrics)
    .filter(([, value]) => value !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`);

  if (entries.length > 0) {
    return entries.join(", ");
  }

  const evidence = [...factor.evidence]
    .map((entry) => {
      if (entry.kind === "file_metric") {
        return `${entry.target}:${entry.metric}`;
      }
      if (entry.kind === "dependency_metric") {
        return `${entry.target}:${entry.metric}`;
      }
      if (entry.kind === "repository_metric") {
        return entry.metric;
      }
      if (entry.kind === "graph_cycle") {
        return `cycle:${entry.cycleId}`;
      }
      return `${entry.fileA}<->${entry.fileB}`;
    })
    .sort((a, b) => a.localeCompare(b));

  return evidence.join(", ");
};
