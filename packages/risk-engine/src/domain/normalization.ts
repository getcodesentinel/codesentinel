import { clamp01, percentile } from "./math.js";

export type QuantileScale = {
  lower: number;
  upper: number;
};

export const logScale = (value: number): number => Math.log1p(Math.max(0, value));

export const buildQuantileScale = (
  values: readonly number[],
  lowerPercentile: number,
  upperPercentile: number,
): QuantileScale => {
  if (values.length === 0) {
    return { lower: 0, upper: 0 };
  }

  return {
    lower: percentile(values, lowerPercentile),
    upper: percentile(values, upperPercentile),
  };
};

export const normalizeWithScale = (value: number, scale: QuantileScale): number => {
  if (scale.upper <= scale.lower) {
    return value > 0 ? 1 : 0;
  }

  return clamp01((value - scale.lower) / (scale.upper - scale.lower));
};
