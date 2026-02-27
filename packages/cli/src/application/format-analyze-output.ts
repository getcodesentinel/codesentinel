import type { AnalyzeSummary } from "@codesentinel/core";

export type AnalyzeOutputMode = "summary" | "json";

type EvolutionAvailable = Extract<AnalyzeSummary["evolution"], { available: true }>;
type ExternalAvailable = Extract<AnalyzeSummary["external"], { available: true }>;

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
        transitiveExposureDependenciesTop: readonly string[];
      };
  risk: {
    repositoryScore: number;
    normalizedScore: number;
    hotspotsTop: ReadonlyArray<{
      file: string;
      score: number;
    }>;
    fragileClusterCount: number;
    dependencyAmplificationZoneCount: number;
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
        transitiveExposureDependenciesTop: summary.external.transitiveExposureDependencies.slice(0, 10),
      }
    : {
        available: false,
        reason: summary.external.reason,
      },
  risk: {
    repositoryScore: summary.risk.repositoryScore,
    normalizedScore: summary.risk.normalizedScore,
    hotspotsTop: summary.risk.hotspots.slice(0, 5).map((hotspot) => ({
      file: hotspot.file,
      score: hotspot.score,
    })),
    fragileClusterCount: summary.risk.fragileClusters.length,
    dependencyAmplificationZoneCount: summary.risk.dependencyAmplificationZones.length,
  },
});

export const formatAnalyzeOutput = (summary: AnalyzeSummary, mode: AnalyzeOutputMode): string =>
  mode === "json"
    ? JSON.stringify(summary, null, 2)
    : JSON.stringify(createSummaryShape(summary), null, 2);
