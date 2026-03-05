import type { AnalyzeSummary } from "@codesentinel/core";

export type AnalyzeOutputMode = "summary" | "json";

type EvolutionAvailable = Extract<AnalyzeSummary["evolution"], { available: true }>;
type ExternalAvailable = Extract<AnalyzeSummary["external"], { available: true }>;

const toHealthTier = (score: number): "critical" | "weak" | "fair" | "good" | "excellent" => {
  if (score < 20) {
    return "critical";
  }
  if (score < 40) {
    return "weak";
  }
  if (score < 60) {
    return "fair";
  }
  if (score < 80) {
    return "good";
  }
  return "excellent";
};

type SummaryShape = {
  targetPath: string;
  structural: AnalyzeSummary["structural"]["metrics"];
  evolution:
    | {
        available: false;
        reason: "not_git_repository";
      }
    | {
        available: true;
        metrics: EvolutionAvailable["metrics"];
        hotspotsTop: readonly string[];
      };
  external:
    | {
        available: false;
        reason:
          | "package_json_not_found"
          | "lockfile_not_found"
          | "unsupported_lockfile_format"
          | "invalid_lockfile";
      }
    | {
        available: true;
        metrics: ExternalAvailable["metrics"];
        highRiskDependenciesTop: readonly string[];
        highRiskDevelopmentDependenciesTop: readonly string[];
        transitiveExposureDependenciesTop: readonly string[];
      };
  risk: {
    riskScore: number;
    normalizedScore: number;
    hotspotsTop: ReadonlyArray<{
      file: string;
      score: number;
    }>;
    fragileClusterCount: number;
    dependencyAmplificationZoneCount: number;
  };
  health: {
    healthScore: number;
    healthTier: "critical" | "weak" | "fair" | "good" | "excellent";
    normalizedScore: number;
    dimensions: AnalyzeSummary["health"]["dimensions"];
    topIssues: AnalyzeSummary["health"]["topIssues"];
  };
};

const createSummaryShape = (summary: AnalyzeSummary): SummaryShape => ({
  targetPath: summary.structural.targetPath,
  structural: summary.structural.metrics,
  evolution: summary.evolution.available
    ? {
        available: true,
        metrics: summary.evolution.metrics,
        hotspotsTop: summary.evolution.hotspots.slice(0, 5).map((hotspot) => hotspot.filePath),
      }
    : {
        available: false,
        reason: summary.evolution.reason,
      },
  external: summary.external.available
    ? {
        available: true,
        metrics: summary.external.metrics,
        highRiskDependenciesTop: summary.external.highRiskDependencies.slice(0, 10),
        highRiskDevelopmentDependenciesTop: summary.external.highRiskDevelopmentDependencies.slice(
          0,
          10,
        ),
        transitiveExposureDependenciesTop: summary.external.transitiveExposureDependencies.slice(
          0,
          10,
        ),
      }
    : {
        available: false,
        reason: summary.external.reason,
      },
  risk: {
    riskScore: summary.risk.riskScore,
    normalizedScore: summary.risk.normalizedScore,
    hotspotsTop: summary.risk.hotspots.slice(0, 5).map((hotspot) => ({
      file: hotspot.file,
      score: hotspot.score,
    })),
    fragileClusterCount: summary.risk.fragileClusters.length,
    dependencyAmplificationZoneCount: summary.risk.dependencyAmplificationZones.length,
  },
  health: {
    healthScore: summary.health.healthScore,
    healthTier: toHealthTier(summary.health.healthScore),
    normalizedScore: summary.health.normalizedScore,
    dimensions: summary.health.dimensions,
    topIssues: summary.health.topIssues.slice(0, 5),
  },
});

export const formatAnalyzeOutput = (summary: AnalyzeSummary, mode: AnalyzeOutputMode): string =>
  mode === "json"
    ? JSON.stringify(summary, null, 2)
    : JSON.stringify(createSummaryShape(summary), null, 2);
