export type GraphNode = {
  id: string;
  absolutePath: string;
  relativePath: string;
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type GraphCycle = {
  nodes: readonly string[];
};

export type FileDependency = {
  id: string;
  relativePath: string;
  directDependencies: readonly string[];
  fanIn: number;
  fanOut: number;
  depth: number;
};

export type GraphMetrics = {
  nodeCount: number;
  edgeCount: number;
  cycleCount: number;
  graphDepth: number;
  maxFanIn: number;
  maxFanOut: number;
};

export type GraphAnalysisSummary = {
  targetPath: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  cycles: readonly GraphCycle[];
  files: readonly FileDependency[];
  metrics: GraphMetrics;
};

export type FileAuthorShare = {
  authorId: string;
  commits: number;
  share: number;
};

export type FileEvolutionMetrics = {
  filePath: string;
  commitCount: number;
  frequencyPer100Commits: number;
  churnAdded: number;
  churnDeleted: number;
  churnTotal: number;
  recentCommitCount: number;
  recentVolatility: number;
  topAuthorShare: number;
  busFactor: number;
  authorDistribution: readonly FileAuthorShare[];
};

export type Hotspot = {
  filePath: string;
  rank: number;
  commitCount: number;
  churnTotal: number;
};

export type FileCoupling = {
  fileA: string;
  fileB: string;
  coChangeCommits: number;
  couplingScore: number;
};

export type CouplingMatrix = {
  pairs: readonly FileCoupling[];
  totalPairCount: number;
  consideredCommits: number;
  skippedLargeCommits: number;
  truncated: boolean;
};

export type RepositoryEvolutionMetrics = {
  totalCommits: number;
  totalFiles: number;
  headCommitTimestamp: number | null;
  recentWindowDays: number;
  hotspotTopPercent: number;
  hotspotThresholdCommitCount: number;
};

export type RepositoryEvolutionAvailable = {
  targetPath: string;
  available: true;
  files: readonly FileEvolutionMetrics[];
  hotspots: readonly Hotspot[];
  coupling: CouplingMatrix;
  metrics: RepositoryEvolutionMetrics;
};

export type RepositoryEvolutionUnavailable = {
  targetPath: string;
  available: false;
  reason: "not_git_repository";
};

export type RepositoryEvolutionSummary =
  | RepositoryEvolutionAvailable
  | RepositoryEvolutionUnavailable;

export type DependencyRiskSignal =
  | "single_maintainer"
  | "abandoned"
  | "high_centrality"
  | "deep_chain"
  | "high_fanout"
  | "metadata_unavailable";

export type DependencyExposureRecord = {
  name: string;
  direct: boolean;
  dependencyScope: "prod" | "dev";
  requestedRange: string | null;
  resolvedVersion: string | null;
  transitiveDependencies: readonly string[];
  weeklyDownloads: number | null;
  dependencyDepth: number;
  fanOut: number;
  dependents: number;
  maintainerCount: number | null;
  releaseFrequencyDays: number | null;
  daysSinceLastRelease: number | null;
  repositoryActivity30d: number | null;
  busFactor: number | null;
  ownRiskSignals: readonly DependencyRiskSignal[];
  inheritedRiskSignals: readonly DependencyRiskSignal[];
  riskSignals: readonly DependencyRiskSignal[];
};

export type CentralDependency = {
  name: string;
  dependents: number;
  fanOut: number;
  direct: boolean;
};

export type ExternalAnalysisMetrics = {
  totalDependencies: number;
  directDependencies: number;
  directProductionDependencies: number;
  directDevelopmentDependencies: number;
  transitiveDependencies: number;
  dependencyDepth: number;
  lockfileKind: "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun";
  metadataCoverage: number;
};

export type ExternalAnalysisAvailable = {
  targetPath: string;
  available: true;
  metrics: ExternalAnalysisMetrics;
  dependencies: readonly DependencyExposureRecord[];
  highRiskDependencies: readonly string[];
  highRiskDevelopmentDependencies: readonly string[];
  transitiveExposureDependencies: readonly string[];
  singleMaintainerDependencies: readonly string[];
  abandonedDependencies: readonly string[];
  centralityRanking: readonly CentralDependency[];
};

export type ExternalAnalysisUnavailable = {
  targetPath: string;
  available: false;
  reason:
    | "package_json_not_found"
    | "lockfile_not_found"
    | "unsupported_lockfile_format"
    | "invalid_lockfile";
};

export type ExternalAnalysisSummary = ExternalAnalysisAvailable | ExternalAnalysisUnavailable;

export type RiskFactors = {
  structural: number;
  evolution: number;
  external: number;
};

export type FileRiskScore = {
  file: string;
  score: number;
  normalizedScore: number;
  factors: RiskFactors;
};

export type ModuleRiskScore = {
  module: string;
  score: number;
  normalizedScore: number;
  fileCount: number;
};

export type DependencyRiskScore = {
  dependency: string;
  score: number;
  normalizedScore: number;
  ownRiskSignals: readonly DependencyRiskSignal[];
  inheritedRiskSignals: readonly DependencyRiskSignal[];
};

export type RiskHotspot = {
  file: string;
  score: number;
  factors: RiskFactors;
};

export type FragileCluster = {
  id: string;
  kind: "structural_cycle" | "change_coupling";
  files: readonly string[];
  score: number;
};

export type DependencyAmplificationZone = {
  file: string;
  score: number;
  externalPressure: number;
};

export type RepositoryRiskSummary = {
  repositoryScore: number;
  normalizedScore: number;
  percentileRank?: number;
  hotspots: readonly RiskHotspot[];
  fragileClusters: readonly FragileCluster[];
  dependencyAmplificationZones: readonly DependencyAmplificationZone[];
  fileScores: readonly FileRiskScore[];
  moduleScores: readonly ModuleRiskScore[];
  dependencyScores: readonly DependencyRiskScore[];
};

export type AnalyzeSummary = {
  structural: GraphAnalysisSummary;
  evolution: RepositoryEvolutionSummary;
  external: ExternalAnalysisSummary;
  risk: RepositoryRiskSummary;
};
