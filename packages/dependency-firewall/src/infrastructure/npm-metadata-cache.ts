import { join } from "node:path";
import type { CacheStore } from "./cache-store.js";
import { resolveCodesentinelCacheDir } from "./codesentinel-cache-dir.js";
import { FileCacheStore } from "./file-cache-store.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const DEFAULT_SWEEP_INTERVAL_WRITES = 25;

let cacheStoreSingleton: CacheStore | null | undefined;

const parsePositiveIntegerFromEnv = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const cacheDisabled = (env: NodeJS.ProcessEnv): boolean => {
  const mode = env["CODESENTINEL_CACHE_MODE"]?.trim().toLowerCase();
  return mode === "none";
};

export const getNpmMetadataCacheStore = (): CacheStore | null => {
  if (cacheStoreSingleton !== undefined) {
    return cacheStoreSingleton;
  }

  if (cacheDisabled(process.env)) {
    cacheStoreSingleton = null;
    return cacheStoreSingleton;
  }

  const path = join(resolveCodesentinelCacheDir(process.env), "npm-metadata-v2");
  const packumentTtlMs = getPackumentCacheTtlMs();
  const downloadsTtlMs = getWeeklyDownloadsCacheTtlMs();
  cacheStoreSingleton = new FileCacheStore(path, {
    maxBytes: parsePositiveIntegerFromEnv(
      process.env["CODESENTINEL_CACHE_MAX_BYTES"],
      DEFAULT_MAX_BYTES,
    ),
    maxEntryBytes: parsePositiveIntegerFromEnv(
      process.env["CODESENTINEL_CACHE_MAX_ENTRY_BYTES"],
      DEFAULT_MAX_ENTRY_BYTES,
    ),
    sweepIntervalWrites: parsePositiveIntegerFromEnv(
      process.env["CODESENTINEL_CACHE_SWEEP_INTERVAL_WRITES"],
      DEFAULT_SWEEP_INTERVAL_WRITES,
    ),
    bucketForKey: (key) => {
      if (key.startsWith("npm:downloads:last-week:")) {
        return "downloads";
      }
      if (key.startsWith("npm:packument:")) {
        return "packument";
      }
      return "default";
    },
    maxAgeMsByBucket: {
      downloads: downloadsTtlMs,
      packument: packumentTtlMs,
    },
  });
  return cacheStoreSingleton;
};

export const getPackumentCacheTtlMs = (): number =>
  parsePositiveIntegerFromEnv(process.env["CODESENTINEL_CACHE_TTL_PACKUMENT_MS"], SIX_HOURS_MS);

export const getWeeklyDownloadsCacheTtlMs = (): number =>
  parsePositiveIntegerFromEnv(process.env["CODESENTINEL_CACHE_TTL_DOWNLOADS_MS"], ONE_DAY_MS);

export const toMetadataPackumentCacheKey = (name: string): string =>
  `npm:packument:metadata:${name}`;
export const toGraphPackumentCacheKey = (name: string): string => `npm:packument:graph:${name}`;
export const toWeeklyDownloadsCacheKey = (name: string): string =>
  `npm:downloads:last-week:${name}`;
