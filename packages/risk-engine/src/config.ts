export type DimensionWeights = {
  structural: number;
  evolution: number;
  external: number;
};

export type InteractionWeights = {
  structuralEvolution: number;
  centralInstability: number;
  dependencyAmplification: number;
};

export type StructuralFactorWeights = {
  fanIn: number;
  fanOut: number;
  depth: number;
  cycleParticipation: number;
};

export type EvolutionFactorWeights = {
  frequency: number;
  churn: number;
  recentVolatility: number;
  ownershipConcentration: number;
  busFactorRisk: number;
};

export type DependencyFactorWeights = {
  signals: number;
  staleness: number;
  maintainerConcentration: number;
  transitiveBurden: number;
  centrality: number;
  chainDepth: number;
  busFactorRisk: number;
};

export type RiskEngineConfig = {
  dimensionWeights: DimensionWeights;
  interactionWeights: InteractionWeights;
  structuralFactorWeights: StructuralFactorWeights;
  evolutionFactorWeights: EvolutionFactorWeights;
  dependencyFactorWeights: DependencyFactorWeights;
  quantileClamp: {
    lower: number;
    upper: number;
  };
  hotspotTopPercent: number;
  hotspotMinFiles: number;
  hotspotMaxFiles: number;
  couplingCluster: {
    minCoChangeCommits: number;
    percentileThreshold: number;
    floorScore: number;
  };
  amplificationZone: {
    pressureFloor: number;
    percentileThreshold: number;
    maxZones: number;
  };
  module: {
    maxPrefixSegments: number;
    rootLabel: string;
    commonSourceRoots: readonly string[];
  };
  dependencySignals: {
    inheritedSignalMultiplier: number;
    abandonedHalfLifeDays: number;
    missingMetadataPenalty: number;
    popularityHalfLifeDownloads: number;
    popularityMaxDampening: number;
  };
  externalDimension: {
    topDependencyPercentile: number;
    dependencyDepthHalfLife: number;
  };
};

export const DEFAULT_RISK_ENGINE_CONFIG: RiskEngineConfig = {
  // Base dimensional influence. Risk is never dominated by a single dimension by default.
  dimensionWeights: {
    structural: 0.44,
    evolution: 0.36,
    external: 0.2,
  },
  // Interaction terms activate only when both related dimensions are high.
  interactionWeights: {
    structuralEvolution: 0.35,
    centralInstability: 0.25,
    dependencyAmplification: 0.2,
  },
  structuralFactorWeights: {
    fanIn: 0.3,
    fanOut: 0.25,
    depth: 0.2,
    cycleParticipation: 0.25,
  },
  evolutionFactorWeights: {
    frequency: 0.26,
    churn: 0.24,
    recentVolatility: 0.2,
    ownershipConcentration: 0.18,
    busFactorRisk: 0.12,
  },
  dependencyFactorWeights: {
    signals: 0.38,
    staleness: 0.16,
    maintainerConcentration: 0.16,
    transitiveBurden: 0.1,
    centrality: 0.08,
    chainDepth: 0.06,
    busFactorRisk: 0.06,
  },
  quantileClamp: {
    lower: 0.05,
    upper: 0.95,
  },
  hotspotTopPercent: 0.12,
  hotspotMinFiles: 3,
  hotspotMaxFiles: 30,
  couplingCluster: {
    minCoChangeCommits: 2,
    percentileThreshold: 0.9,
    floorScore: 0.35,
  },
  amplificationZone: {
    pressureFloor: 0.2,
    percentileThreshold: 0.85,
    maxZones: 20,
  },
  module: {
    maxPrefixSegments: 2,
    rootLabel: "(root)",
    commonSourceRoots: ["src", "lib", "app", "packages"],
  },
  dependencySignals: {
    inheritedSignalMultiplier: 0.45,
    // At this age, staleness reaches 50% risk.
    abandonedHalfLifeDays: 540,
    missingMetadataPenalty: 0.5,
    // At this download volume, popularity reaches 50% of its dampening effect.
    popularityHalfLifeDownloads: 100000,
    // Popularity can only reduce dependency risk by this fraction.
    popularityMaxDampening: 0.12,
  },
  externalDimension: {
    topDependencyPercentile: 0.85,
    dependencyDepthHalfLife: 6,
  },
};
