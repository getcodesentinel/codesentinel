export type DependencyRecord = {
  name: string;
  version: string;
  direct: boolean;
};

export type DependencyRisk = {
  dependency: DependencyRecord;
  score: number;
  signals: string[];
};

export type DependencyReport = {
  generatedAt: Date;
  risks: DependencyRisk[];
};

export const createEmptyDependencyReport = (): DependencyReport => ({
  generatedAt: new Date(0),
  risks: [],
});
