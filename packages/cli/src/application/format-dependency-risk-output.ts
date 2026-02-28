import type { AnalyzeDependencyCandidateResult } from "@codesentinel/dependency-firewall";

export type DependencyRiskOutputMode = "summary" | "json";

type DependencyRiskSummaryShape =
  | {
      available: false;
      reason: AnalyzeDependencyCandidateResult extends { available: false; reason: infer R } ? R : never;
      dependency: string;
    }
  | {
      available: true;
      dependency: AnalyzeDependencyCandidateResult extends { available: true; dependency: infer D } ? D : never;
      graph: AnalyzeDependencyCandidateResult extends { available: true; graph: infer G } ? G : never;
      assumptions: readonly string[];
      external: {
        metrics: Extract<AnalyzeDependencyCandidateResult, { available: true }>["external"] extends {
          available: true;
          metrics: infer M;
        }
          ? M
          : never;
        ownRiskSignals: readonly string[];
        inheritedRiskSignals: readonly string[];
        highRiskDependenciesTop: readonly string[];
        transitiveExposureDependenciesTop: readonly string[];
      };
    };

const createSummaryShape = (result: AnalyzeDependencyCandidateResult): DependencyRiskSummaryShape => {
  if (!result.available) {
    return {
      available: false,
      reason: result.reason,
      dependency: result.dependency,
    };
  }

  const direct = result.external.dependencies[0];

  return {
    available: true,
    dependency: result.dependency,
    graph: result.graph,
    assumptions: result.assumptions,
    external: {
      metrics: result.external.metrics,
      ownRiskSignals: direct?.ownRiskSignals ?? [],
      inheritedRiskSignals: direct?.inheritedRiskSignals ?? [],
      highRiskDependenciesTop: result.external.highRiskDependencies.slice(0, 10),
      transitiveExposureDependenciesTop: result.external.transitiveExposureDependencies.slice(0, 10),
    },
  };
};

export const formatDependencyRiskOutput = (
  result: AnalyzeDependencyCandidateResult,
  mode: DependencyRiskOutputMode,
): string => (mode === "json" ? JSON.stringify(result, null, 2) : JSON.stringify(createSummaryShape(result), null, 2));
