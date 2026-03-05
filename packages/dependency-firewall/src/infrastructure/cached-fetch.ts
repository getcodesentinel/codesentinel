import type { CacheStore } from "./cache-store.js";

type CachedFetchOptions<T> = {
  key: string;
  ttlMs: number;
  cacheStore: CacheStore | null;
  fetchFresh: () => Promise<T | null>;
  nowMs?: number;
};

export const cachedFetch = async <T>(options: CachedFetchOptions<T>): Promise<T | null> => {
  const nowMs = options.nowMs ?? Date.now();
  const cachedEntry =
    options.cacheStore === null ? null : await options.cacheStore.get<T>(options.key);

  if (cachedEntry !== null && nowMs - cachedEntry.fetchedAtMs <= options.ttlMs) {
    return cachedEntry.value;
  }

  try {
    const fresh = await options.fetchFresh();
    if (fresh !== null) {
      void options.cacheStore?.set(options.key, { value: fresh, fetchedAtMs: nowMs }).catch(() => {
        // Cache persistence failures should not impact the primary fetch path.
      });
      return fresh;
    }
  } catch {
    // Network failures should not block stale fallback.
  }

  return cachedEntry?.value ?? null;
};
