export type ChangeMetric = {
  filePath: string;
  commits: number;
  lastModifiedAt: Date;
};

export type EvolutionSnapshot = {
  generatedAt: Date;
  hotspots: ChangeMetric[];
};

export const createEmptySnapshot = (): EvolutionSnapshot => ({
  generatedAt: new Date(0),
  hotspots: [],
});
