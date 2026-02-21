export type RiskScore = {
  overall: number;
  structural: number;
  evolutionary: number;
  external: number;
};

export type RiskProfile = {
  generatedAt: Date;
  score: RiskScore;
  notes: string[];
};

export const createBaselineRiskProfile = (): RiskProfile => ({
  generatedAt: new Date(0),
  score: {
    overall: 0,
    structural: 0,
    evolutionary: 0,
    external: 0,
  },
  notes: [],
});
