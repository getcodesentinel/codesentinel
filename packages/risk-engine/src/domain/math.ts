export const toUnitInterval = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export const round4 = (value: number): number => Number(value.toFixed(4));

export const average = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, current) => sum + current, 0);
  return total / values.length;
};

export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }

  if (values.length === 1) {
    return values[0] ?? 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = toUnitInterval(p) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const ratio = position - lowerIndex;
  return lower + (upper - lower) * ratio;
};

export const saturatingComposite = (
  baseline: number,
  amplifications: readonly number[],
): number => {
  let value = toUnitInterval(baseline);

  for (const amplification of amplifications) {
    const boundedAmplification = toUnitInterval(amplification);
    value += (1 - value) * boundedAmplification;
  }

  return toUnitInterval(value);
};

export const halfLifeRisk = (value: number, halfLife: number): number => {
  if (value <= 0 || halfLife <= 0) {
    return 0;
  }

  return toUnitInterval(value / (value + halfLife));
};

export const normalizeWeights = <T extends string>(
  weights: Readonly<Record<T, number>>,
  enabled: Readonly<Record<T, boolean>>,
): Readonly<Record<T, number>> => {
  let total = 0;
  const result: Record<T, number> = { ...weights };

  for (const key of Object.keys(result) as T[]) {
    const enabledValue = enabled[key];
    if (!enabledValue) {
      result[key] = 0;
      continue;
    }

    const value = Math.max(0, result[key]);
    result[key] = value;
    total += value;
  }

  if (total === 0) {
    const activeKeys = (Object.keys(result) as T[]).filter((key) => enabled[key]);
    if (activeKeys.length === 0) {
      return result;
    }

    const uniform = 1 / activeKeys.length;
    for (const key of activeKeys) {
      result[key] = uniform;
    }

    return result;
  }

  for (const key of Object.keys(result) as T[]) {
    if (enabled[key]) {
      result[key] = result[key] / total;
    }
  }

  return result;
};
