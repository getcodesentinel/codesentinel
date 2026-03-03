export const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  limit: number,
  handler: (value: T) => Promise<R>,
): Promise<readonly R[]> => {
  const effectiveLimit = Math.max(1, limit);
  const workerCount = Math.min(effectiveLimit, values.length);
  const UNSET = Symbol("map_with_concurrency_unset");
  const results = new Array<R | typeof UNSET>(values.length).fill(UNSET);
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

      const value = values[current] as T;
      results[current] = await handler(value);
    }
  });

  await Promise.all(workers);
  if (results.some((value) => value === UNSET)) {
    throw new Error("map_with_concurrency_incomplete_results");
  }
  return results as R[];
};
