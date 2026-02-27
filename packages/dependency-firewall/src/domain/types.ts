export type LockfileKind = "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun";

export type DirectDependencySpec = {
  name: string;
  requestedRange: string;
};

export type LockedDependencyNode = {
  name: string;
  version: string;
  dependencies: readonly string[];
};

export type LockfileExtraction = {
  kind: LockfileKind;
  directDependencies: readonly DirectDependencySpec[];
  nodes: readonly LockedDependencyNode[];
};

export type DependencyMetadata = {
  name: string;
  version: string;
  weeklyDownloads: number | null;
  maintainerCount: number | null;
  releaseFrequencyDays: number | null;
  daysSinceLastRelease: number | null;
  repositoryActivity30d: number | null;
  busFactor: number | null;
};

export interface DependencyMetadataProvider {
  getMetadata(name: string, version: string): Promise<DependencyMetadata | null>;
}

export type ExternalAnalysisConfig = {
  abandonedDaysThreshold: number;
  deepChainThreshold: number;
  fanOutHighThreshold: number;
  centralityTopN: number;
  maxHighRiskDependencies: number;
  metadataRequestConcurrency: number;
};

export const DEFAULT_EXTERNAL_ANALYSIS_CONFIG: ExternalAnalysisConfig = {
  abandonedDaysThreshold: 540,
  deepChainThreshold: 6,
  fanOutHighThreshold: 25,
  centralityTopN: 20,
  maxHighRiskDependencies: 100,
  metadataRequestConcurrency: 8,
};
