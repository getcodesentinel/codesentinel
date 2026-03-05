import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { FileCacheStore } from "./file-cache-store.js";

const cleanupPaths: string[] = [];

const createTempDir = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "codesentinel-cache-store-"));
  cleanupPaths.push(root);
  return root;
};

afterEach(async () => {
  for (const path of cleanupPaths.splice(0, cleanupPaths.length)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("FileCacheStore", () => {
  it("stores and reads entries by key", async () => {
    const root = await createTempDir();
    const store = new FileCacheStore(join(root, "cache"));

    await store.set("npm:packument:a", { fetchedAtMs: 123, value: { versions: { "1.0.0": {} } } });
    const result = await store.get<{ versions: Record<string, unknown> }>("npm:packument:a");

    expect(result).toEqual({
      fetchedAtMs: 123,
      value: { versions: { "1.0.0": {} } },
    });
  });

  it("returns null when key does not exist", async () => {
    const root = await createTempDir();
    const store = new FileCacheStore(join(root, "cache"));
    expect(await store.get("missing:key")).toBeNull();
  });

  it("skips oversized entries", async () => {
    const root = await createTempDir();
    const store = new FileCacheStore(join(root, "cache"), {
      maxBytes: 1_000_000,
      maxEntryBytes: 100,
      sweepIntervalWrites: 1,
    });

    await store.set("key:small", { fetchedAtMs: 1, value: { ok: true } });
    await store.set("key:large", { fetchedAtMs: 2, value: { data: "x".repeat(10_000) } });

    expect(await store.get("key:small")).not.toBeNull();
    expect(await store.get("key:large")).toEqual({
      fetchedAtMs: 2,
      value: { data: "x".repeat(10_000) },
    });

    const reloaded = new FileCacheStore(join(root, "cache"), {
      maxBytes: 1_000_000,
      maxEntryBytes: 100,
      sweepIntervalWrites: 1,
    });
    expect(await reloaded.get("key:small")).not.toBeNull();
    expect(await reloaded.get("key:large")).toBeNull();
  });

  it("evicts old files when total cache size exceeds maxBytes", async () => {
    const root = await createTempDir();
    const store = new FileCacheStore(join(root, "cache"), {
      maxBytes: 350,
      maxEntryBytes: 10_000,
      sweepIntervalWrites: 1,
    });

    await store.set("key:one", { fetchedAtMs: 1, value: { payload: "a".repeat(180) } });
    await store.set("key:two", { fetchedAtMs: 2, value: { payload: "b".repeat(180) } });
    await store.set("key:three", { fetchedAtMs: 3, value: { payload: "c".repeat(180) } });

    const reloaded = new FileCacheStore(join(root, "cache"), {
      maxBytes: 350,
      maxEntryBytes: 10_000,
      sweepIntervalWrites: 1,
    });

    const first = await reloaded.get("key:one");
    const second = await reloaded.get("key:two");
    const third = await reloaded.get("key:three");

    expect(first).toBeNull();
    expect(second === null && third === null).toBe(false);
  });

  it("evicts expired entries during sweep", async () => {
    const root = await createTempDir();
    const store = new FileCacheStore(join(root, "cache"), {
      maxBytes: 1_000_000,
      maxEntryBytes: 10_000,
      sweepIntervalWrites: 1,
      bucketForKey: (key) => (key === "key:expired" ? "short" : "long"),
      maxAgeMsByBucket: {
        short: 1,
        long: 1_000_000,
      },
    });

    await store.set("key:expired", { fetchedAtMs: 1, value: { payload: "old" } });
    await sleep(10);
    await store.set("key:fresh", { fetchedAtMs: 2, value: { payload: "new" } });

    const reloaded = new FileCacheStore(join(root, "cache"), {
      maxBytes: 1_000_000,
      maxEntryBytes: 10_000,
      sweepIntervalWrites: 1,
      bucketForKey: (key) => (key === "key:expired" ? "short" : "long"),
      maxAgeMsByBucket: {
        short: 1,
        long: 1_000_000,
      },
    });

    expect(await reloaded.get("key:expired")).toBeNull();
    expect(await reloaded.get("key:fresh")).not.toBeNull();
  });
});
