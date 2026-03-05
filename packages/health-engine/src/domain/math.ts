export const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

export const round4 = (value: number): number => Number(value.toFixed(4));

export const average = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
};

export const concentration = (rawValues: readonly number[]): number => {
  const values = rawValues.filter((value) => value > 0);
  const count = values.length;
  if (count <= 1) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }

  const hhi = values.reduce((sum, value) => {
    const share = value / total;
    return sum + share * share;
  }, 0);

  const minHhi = 1 / count;
  const normalized = (hhi - minHhi) / (1 - minHhi);
  return clamp01(normalized);
};
