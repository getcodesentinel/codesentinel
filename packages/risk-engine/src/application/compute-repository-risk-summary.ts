import type {
  ExternalAnalysisSummary,
  GraphAnalysisSummary,
  RepositoryRiskEvaluation,
  RepositoryEvolutionSummary,
  RepositoryRiskSummary,
} from "@codesentinel/core";
import { DEFAULT_RISK_ENGINE_CONFIG, type RiskEngineConfig } from "../config.js";
import { computeRiskSummary } from "../domain/risk-model.js";
import { createTraceCollector } from "../domain/trace-collector.js";

export type ComputeRepositoryRiskSummaryInput = {
  structural: GraphAnalysisSummary;
  evolution: RepositoryEvolutionSummary;
  external: ExternalAnalysisSummary;
  config?: Partial<RiskEngineConfig>;
};

export type EvaluateRepositoryRiskOptions = {
  explain?: boolean;
};

const mergeConfig = (overrides: Partial<RiskEngineConfig> | undefined): RiskEngineConfig => {
  if (overrides === undefined) {
    return DEFAULT_RISK_ENGINE_CONFIG;
  }

  return {
    ...DEFAULT_RISK_ENGINE_CONFIG,
    ...overrides,
    dimensionWeights: {
      ...DEFAULT_RISK_ENGINE_CONFIG.dimensionWeights,
      ...overrides.dimensionWeights,
    },
    interactionWeights: {
      ...DEFAULT_RISK_ENGINE_CONFIG.interactionWeights,
      ...overrides.interactionWeights,
    },
    structuralFactorWeights: {
      ...DEFAULT_RISK_ENGINE_CONFIG.structuralFactorWeights,
      ...overrides.structuralFactorWeights,
    },
    evolutionFactorWeights: {
      ...DEFAULT_RISK_ENGINE_CONFIG.evolutionFactorWeights,
      ...overrides.evolutionFactorWeights,
    },
    dependencyFactorWeights: {
      ...DEFAULT_RISK_ENGINE_CONFIG.dependencyFactorWeights,
      ...overrides.dependencyFactorWeights,
    },
    quantileClamp: {
      ...DEFAULT_RISK_ENGINE_CONFIG.quantileClamp,
      ...overrides.quantileClamp,
    },
    couplingCluster: {
      ...DEFAULT_RISK_ENGINE_CONFIG.couplingCluster,
      ...overrides.couplingCluster,
    },
    amplificationZone: {
      ...DEFAULT_RISK_ENGINE_CONFIG.amplificationZone,
      ...overrides.amplificationZone,
    },
    module: {
      ...DEFAULT_RISK_ENGINE_CONFIG.module,
      ...overrides.module,
    },
    dependencySignals: {
      ...DEFAULT_RISK_ENGINE_CONFIG.dependencySignals,
      ...overrides.dependencySignals,
    },
    externalDimension: {
      ...DEFAULT_RISK_ENGINE_CONFIG.externalDimension,
      ...overrides.externalDimension,
    },
  };
};

export const computeRepositoryRiskSummary = (
  input: ComputeRepositoryRiskSummaryInput,
): RepositoryRiskSummary => {
  return evaluateRepositoryRisk(input, { explain: false }).summary;
};

export const evaluateRepositoryRisk = (
  input: ComputeRepositoryRiskSummaryInput,
  options: EvaluateRepositoryRiskOptions = {},
): RepositoryRiskEvaluation => {
  const config = mergeConfig(input.config);
  const collector = createTraceCollector(options.explain === true);
  const summary = computeRiskSummary(
    input.structural,
    input.evolution,
    input.external,
    config,
    collector,
  );

  const trace = collector.build();
  if (options.explain !== true) {
    return { summary };
  }

  if (trace === undefined) {
    return { summary };
  }

  return {
    summary,
    trace,
  };
};
