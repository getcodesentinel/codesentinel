export const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  limit: number,
  handler: (value: T) => Promise<R>,
): Promise<readonly R[]> => {
  const effectiveLimit = Math.max(1, limit);
  const workerCount = Math.min(effectiveLimit, values.length);
  const results: R[] = new Array(values.length);
  let index = 0;

  const workers: Promise<void>[] = Array.from({ length: workerCount }, async () => {
    // This loop always terminates: each iteration advances `index`,
    // and workers return once `index >= values.length`.
    while (true) {
      const current = index;
      index += 1;
      if (current >= values.length) {
        return;
      }

      const value = values[current];
      if (value !== undefined) {
        results[current] = await handler(value);
      }
    }
  });

  await Promise.all(workers);
  return results;
};
