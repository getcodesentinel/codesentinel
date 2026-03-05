import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheEntry, CacheStore } from "./cache-store.js";

type CacheEntryPayload = {
  key: string;
  fetchedAtMs: number;
  value: unknown;
};

const parseCacheEntryPayload = (value: unknown): CacheEntryPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as { key?: unknown; fetchedAtMs?: unknown; value?: unknown };
  if (typeof payload.key !== "string" || payload.key.length === 0) {
    return null;
  }
  if (typeof payload.fetchedAtMs !== "number" || !Number.isFinite(payload.fetchedAtMs)) {
    return null;
  }

  return {
    key: payload.key,
    fetchedAtMs: payload.fetchedAtMs,
    value: payload.value,
  };
};

type FileCacheStoreOptions = {
  maxBytes: number;
  maxEntryBytes: number;
  sweepIntervalWrites: number;
  bucketForKey?: (key: string) => string;
  maxAgeMsByBucket?: Readonly<Record<string, number>>;
};

const DEFAULT_OPTIONS: FileCacheStoreOptions = {
  maxBytes: 100 * 1024 * 1024,
  maxEntryBytes: 4 * 1024 * 1024,
  sweepIntervalWrites: 25,
};

const DEFAULT_BUCKET = "default";

const normalizeBucket = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return DEFAULT_BUCKET;
  }
  return trimmed.replace(/[^a-z0-9_-]/g, "_");
};

export class FileCacheStore implements CacheStore {
  private readonly byKey = new Map<string, CacheEntry<unknown> | null>();
  private readonly inFlightWrites = new Map<string, Promise<void>>();
  private writesSinceSweep = 0;
  private sweepPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly directoryPath: string,
    private readonly options: FileCacheStoreOptions = DEFAULT_OPTIONS,
  ) {}

  private bucketForKey(key: string): string {
    const configured = this.options.bucketForKey?.(key);
    if (configured === undefined) {
      return DEFAULT_BUCKET;
    }
    return normalizeBucket(configured);
  }

  private toEntryPath(key: string): string {
    const bucket = this.bucketForKey(key);
    const digest = createHash("sha256").update(key).digest("hex");
    return join(this.directoryPath, bucket, `${digest}.json`);
  }

  private async writeEntry(key: string, entry: CacheEntry<unknown>): Promise<void> {
    const filePath = this.toEntryPath(key);
    const bucketPath = join(this.directoryPath, this.bucketForKey(key));
    await mkdir(bucketPath, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    const payload: CacheEntryPayload = {
      key,
      fetchedAtMs: entry.fetchedAtMs,
      value: entry.value,
    };
    const raw = JSON.stringify(payload);
    if (Buffer.byteLength(raw, "utf8") > this.options.maxEntryBytes) {
      return;
    }

    await writeFile(tempPath, raw, "utf8");
    await rename(tempPath, filePath);
  }

  private async sweepIfNeeded(): Promise<void> {
    this.writesSinceSweep += 1;
    if (this.writesSinceSweep < this.options.sweepIntervalWrites) {
      return;
    }
    this.writesSinceSweep = 0;

    this.sweepPromise = this.sweepPromise
      .catch(() => {
        // Keep sweep queue alive across failures.
      })
      .then(async () => {
        await this.evictToSizeLimit();
      });
    await this.sweepPromise;
  }

  private async evictToSizeLimit(): Promise<void> {
    const nowMs = Date.now();
    let entries: Array<{ path: string; size: number; mtimeMs: number; bucket: string }>;
    try {
      const bucketEntries = await readdir(this.directoryPath, { withFileTypes: true });
      const bucketNames = bucketEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      entries = (
        await Promise.all(
          bucketNames.map(async (bucket) => {
            const bucketPath = join(this.directoryPath, bucket);
            const files = await readdir(bucketPath, { withFileTypes: true });
            return await Promise.all(
              files
                .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
                .map(async (entry) => {
                  const path = join(bucketPath, entry.name);
                  const info = await stat(path);
                  return {
                    path,
                    size: info.size,
                    mtimeMs: info.mtimeMs,
                    bucket,
                  };
                }),
            );
          }),
        )
      )
        .flat()
        .filter((entry) => Number.isFinite(entry.size) && entry.size > 0);
    } catch {
      return;
    }

    if (this.options.maxAgeMsByBucket !== undefined) {
      const retained: typeof entries = [];
      let deletedAny = false;
      for (const entry of entries) {
        const maxAgeMs = this.options.maxAgeMsByBucket[entry.bucket];
        const expired =
          typeof maxAgeMs === "number" &&
          Number.isFinite(maxAgeMs) &&
          nowMs - entry.mtimeMs > maxAgeMs;
        if (!expired) {
          retained.push(entry);
          continue;
        }

        try {
          await unlink(entry.path);
          deletedAny = true;
        } catch {
          retained.push(entry);
        }
      }
      entries = retained;
      if (deletedAny) {
        this.byKey.clear();
      }
    }

    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= this.options.maxBytes) {
      return;
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let deletedAny = false;
    for (const entry of entries) {
      if (totalBytes <= this.options.maxBytes) {
        break;
      }
      try {
        await unlink(entry.path);
        deletedAny = true;
        totalBytes -= entry.size;
      } catch {
        // Ignore eviction failures for individual files.
      }
    }
    if (deletedAny) {
      this.byKey.clear();
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (this.byKey.has(key)) {
      return (this.byKey.get(key) as CacheEntry<T> | null) ?? null;
    }

    try {
      const raw = await readFile(this.toEntryPath(key), "utf8");
      const parsed = parseCacheEntryPayload(JSON.parse(raw));
      if (parsed === null || parsed.key !== key) {
        this.byKey.set(key, null);
        return null;
      }

      const value = { fetchedAtMs: parsed.fetchedAtMs, value: parsed.value as T };
      this.byKey.set(key, value as CacheEntry<unknown>);
      return value;
    } catch {
      this.byKey.set(key, null);
      return null;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const normalized = entry as CacheEntry<unknown>;
    this.byKey.set(key, normalized);

    const previous = this.inFlightWrites.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // Keep write chain active even after previous failures.
      })
      .then(async () => {
        await this.writeEntry(key, normalized);
        await this.sweepIfNeeded();
      });
    this.inFlightWrites.set(key, next);
    await next;
  }
}
