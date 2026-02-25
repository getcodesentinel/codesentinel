export type GitFileChange = {
  filePath: string;
  additions: number;
  deletions: number;
};

export type GitCommitRecord = {
  hash: string;
  authorId: string;
  authorName: string;
  authoredAtUnix: number;
  fileChanges: readonly GitFileChange[];
};

export type EvolutionComputationConfig = {
  authorIdentityMode: "likely_merge" | "strict_email";
  recentWindowDays: number;
  hotspotTopPercent: number;
  hotspotMinFiles: number;
  maxFilesPerCommitForCoupling: number;
  maxCouplingPairs: number;
  busFactorCoverageThreshold: number;
};

export const DEFAULT_EVOLUTION_CONFIG: EvolutionComputationConfig = {
  authorIdentityMode: "likely_merge",
  recentWindowDays: 30,
  hotspotTopPercent: 0.1,
  hotspotMinFiles: 1,
  maxFilesPerCommitForCoupling: 200,
  maxCouplingPairs: 500,
  busFactorCoverageThreshold: 0.6,
};
