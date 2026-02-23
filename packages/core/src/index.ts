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

export type AnalyzeSummary = {
  structural: GraphAnalysisSummary;
  evolution: RepositoryEvolutionSummary;
};
