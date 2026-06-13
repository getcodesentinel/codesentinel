import type { AnalyzeSummary } from "@codesentinel/core";

export type AnalyzeOutputMode = "summary" | "json";

type EvolutionAvailable = Extract<AnalyzeSummary["evolution"], { available: true }>;
type ExternalAvailable = Extract<AnalyzeSummary["external"], { available: true }>;
type WorkspaceSummaryShape = {
  structuralTop: ReadonlyArray<{
    path: string;
    fileCount: number;
    internalEdgeCount: number;
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
  }>;
  riskTop: ReadonlyArray<{
    path: string;
    score: number;
    fileCount: number;
    peakFileRisk: number;
  }>;
  evolutionTop: ReadonlyArray<{
    path: string;
    commitCount: number;
    churnTotal: number;
    recentVolatility: number;
  }>;
  dependencyExposureTop: ReadonlyArray<{
    path: string;
    directDependencies: number;
    sharedDependencies: number;
    highRiskDependencies: number;
    transitiveExposureDependencies: number;
  }>;
};

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
  workspaces: WorkspaceSummaryShape;
  health: {
    healthScore: number;
    healthTier: "critical" | "weak" | "fair" | "good" | "excellent";
    normalizedScore: number;
    dimensions: AnalyzeSummary["health"]["dimensions"];
    topIssues: AnalyzeSummary["health"]["topIssues"];
  };
};

const createWorkspaceSummaryShape = (summary: AnalyzeSummary): WorkspaceSummaryShape => ({
  structuralTop: [...(summary.structural.workspaces ?? [])]
    .sort(
      (a, b) =>
        b.incomingEdgeCount +
          b.outgoingEdgeCount +
          b.internalEdgeCount -
          (a.incomingEdgeCount + a.outgoingEdgeCount + a.internalEdgeCount) ||
        b.fileCount - a.fileCount ||
        a.path.localeCompare(b.path),
    )
    .slice(0, 5)
    .map((workspace) => ({
      path: workspace.path,
      fileCount: workspace.fileCount,
      internalEdgeCount: workspace.internalEdgeCount,
      incomingEdgeCount: workspace.incomingEdgeCount,
      outgoingEdgeCount: workspace.outgoingEdgeCount,
    })),
  riskTop: [...summary.risk.workspaceScores]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 5)
    .map((workspace) => ({
      path: workspace.path,
      score: workspace.score,
      fileCount: workspace.fileCount,
      peakFileRisk: workspace.peakFileRisk,
    })),
  evolutionTop: summary.evolution.available
    ? [...(summary.evolution.workspaces ?? [])]
        .sort(
          (a, b) =>
            b.recentVolatility - a.recentVolatility ||
            b.churnTotal - a.churnTotal ||
            b.commitCount - a.commitCount ||
            a.path.localeCompare(b.path),
        )
        .slice(0, 5)
        .map((workspace) => ({
          path: workspace.path,
          commitCount: workspace.commitCount,
          churnTotal: workspace.churnTotal,
          recentVolatility: workspace.recentVolatility,
        }))
    : [],
  dependencyExposureTop: summary.external.available
    ? [...(summary.external.workspaces ?? [])]
        .sort(
          (a, b) =>
            b.highRiskDependencies.length - a.highRiskDependencies.length ||
            b.transitiveExposureDependencies.length - a.transitiveExposureDependencies.length ||
            b.directDependencies - a.directDependencies ||
            a.path.localeCompare(b.path),
        )
        .slice(0, 5)
        .map((workspace) => ({
          path: workspace.path,
          directDependencies: workspace.directDependencies,
          sharedDependencies: workspace.sharedDependencies.length,
          highRiskDependencies: workspace.highRiskDependencies.length,
          transitiveExposureDependencies: workspace.transitiveExposureDependencies.length,
        }))
    : [],
});

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
  workspaces: createWorkspaceSummaryShape(summary),
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
