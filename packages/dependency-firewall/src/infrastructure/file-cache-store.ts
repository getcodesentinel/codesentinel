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
};

const DEFAULT_OPTIONS: FileCacheStoreOptions = {
  maxBytes: 100 * 1024 * 1024,
  maxEntryBytes: 4 * 1024 * 1024,
  sweepIntervalWrites: 25,
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

  private toEntryPath(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex");
    return join(this.directoryPath, `${digest}.json`);
  }

  private async writeEntry(key: string, entry: CacheEntry<unknown>): Promise<void> {
    const filePath = this.toEntryPath(key);
    await mkdir(this.directoryPath, { recursive: true });
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
    let entries: Array<{ path: string; size: number; mtimeMs: number }>;
    try {
      const dirEntries = await readdir(this.directoryPath, { withFileTypes: true });
      entries = (
        await Promise.all(
          dirEntries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map(async (entry) => {
              const path = join(this.directoryPath, entry.name);
              const info = await stat(path);
              return { path, size: info.size, mtimeMs: info.mtimeMs };
            }),
        )
      ).filter((entry) => Number.isFinite(entry.size) && entry.size > 0);
    } catch {
      return;
    }

    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= this.options.maxBytes) {
      return;
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of entries) {
      if (totalBytes <= this.options.maxBytes) {
        break;
      }
      try {
        await unlink(entry.path);
        totalBytes -= entry.size;
      } catch {
        // Ignore eviction failures for individual files.
      }
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
