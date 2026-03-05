import { describe, expect, it, vi } from "vitest";
import type { CacheEntry, CacheStore } from "./cache-store.js";
import { cachedFetch } from "./cached-fetch.js";

class InMemoryCacheStore implements CacheStore {
  private readonly byKey = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): Promise<CacheEntry<T> | null> {
    return Promise.resolve((this.byKey.get(key) as CacheEntry<T> | undefined) ?? null);
  }

  set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    this.byKey.set(key, entry as CacheEntry<unknown>);
    return Promise.resolve();
  }
}

describe("cachedFetch", () => {
  it("returns a fresh cached value without calling fetch", async () => {
    const store = new InMemoryCacheStore();
    await store.set("key", { value: { count: 1 }, fetchedAtMs: 1000 });
    const fetchFresh = vi.fn(() => Promise.resolve({ count: 2 }));

    const result = await cachedFetch({
      key: "key",
      ttlMs: 60_000,
      cacheStore: store,
      nowMs: 2000,
      fetchFresh,
    });

    expect(result).toEqual({ count: 1 });
    expect(fetchFresh).not.toHaveBeenCalled();
  });

  it("fetches and stores when cache is missing", async () => {
    const store = new InMemoryCacheStore();
    const fetchFresh = vi.fn(() => Promise.resolve({ count: 2 }));

    const result = await cachedFetch({
      key: "key",
      ttlMs: 60_000,
      cacheStore: store,
      nowMs: 3000,
      fetchFresh,
    });

    expect(result).toEqual({ count: 2 });
    expect(await store.get<{ count: number }>("key")).toEqual({
      value: { count: 2 },
      fetchedAtMs: 3000,
    });
  });

  it("returns stale cache on fetch failure after ttl expiry", async () => {
    const store = new InMemoryCacheStore();
    await store.set("key", { value: { count: 1 }, fetchedAtMs: 1000 });
    const fetchFresh = vi.fn(() => Promise.reject(new Error("network error")));

    const result = await cachedFetch({
      key: "key",
      ttlMs: 10,
      cacheStore: store,
      nowMs: 3000,
      fetchFresh,
    });

    expect(result).toEqual({ count: 1 });
  });

  it("returns null when fetch fails and cache is empty", async () => {
    const store = new InMemoryCacheStore();
    const fetchFresh = vi.fn(() => Promise.resolve(null));

    const result = await cachedFetch({
      key: "key",
      ttlMs: 60_000,
      cacheStore: store,
      fetchFresh,
    });

    expect(result).toBeNull();
  });
});
