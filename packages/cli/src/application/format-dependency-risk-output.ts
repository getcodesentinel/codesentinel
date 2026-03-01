import type { AnalyzeDependencyCandidateResult } from "@codesentinel/dependency-firewall";

export type DependencyRiskOutputMode = "summary" | "json";

type UnavailableResult = Extract<AnalyzeDependencyCandidateResult, { available: false }>;
type AvailableResult = Extract<AnalyzeDependencyCandidateResult, { available: true }>;

type DependencyRiskSummaryShape =
  | {
      available: false;
      reason: UnavailableResult["reason"];
      dependency: string;
    }
  | {
      available: true;
      dependency: AvailableResult["dependency"];
      graph: AvailableResult["graph"];
      assumptions: readonly string[];
      external: {
        available: boolean;
        metrics: Record<string, unknown> | null;
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

  const direct = result.external.available ? result.external.dependencies[0] : undefined;

  return {
    available: true,
    dependency: result.dependency,
    graph: result.graph,
    assumptions: result.assumptions,
    external: {
      available: result.external.available,
      metrics: result.external.available ? result.external.metrics : null,
      ownRiskSignals: direct?.ownRiskSignals ?? [],
      inheritedRiskSignals: direct?.inheritedRiskSignals ?? [],
      highRiskDependenciesTop: result.external.available ? result.external.highRiskDependencies.slice(0, 10) : [],
      transitiveExposureDependenciesTop: result.external.available
        ? result.external.transitiveExposureDependencies.slice(0, 10)
        : [],
    },
  };
};

export const formatDependencyRiskOutput = (
  result: AnalyzeDependencyCandidateResult,
  mode: DependencyRiskOutputMode,
): string => (mode === "json" ? JSON.stringify(result, null, 2) : JSON.stringify(createSummaryShape(result), null, 2));
