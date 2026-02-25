import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDependencyExposure } from "./analyze-dependency-exposure.js";
import { NoopMetadataProvider } from "../infrastructure/noop-metadata-provider.js";

const cleanupPaths: string[] = [];

const createRepo = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "codesentinel-depfirewall-"));
  cleanupPaths.push(root);

  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  return root;
};

afterEach(async () => {
  for (const path of cleanupPaths.splice(0, cleanupPaths.length)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("analyzeDependencyExposure", () => {
  it("returns unavailable when package.json is missing", async () => {
    const repo = await createRepo({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    const summary = await analyzeDependencyExposure(
      { repositoryPath: repo },
      new NoopMetadataProvider(),
    );

    expect(summary).toEqual({
      targetPath: repo,
      available: false,
      reason: "package_json_not_found",
    });
  });

  it("analyzes a pnpm lockfile with direct and transitive dependencies", async () => {
    const repo = await createRepo({
      "package.json": JSON.stringify({ dependencies: { a: "^1.0.0" } }),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "packages:",
        "  a@1.0.0:",
        "    dependencies:",
        "      b: 2.0.0",
        "  b@2.0.0:",
        "",
      ].join("\n"),
    });

    const summary = await analyzeDependencyExposure(
      { repositoryPath: repo },
      new NoopMetadataProvider(),
    );

    expect(summary.available).toBe(true);
    if (!summary.available) {
      return;
    }

    expect(summary.metrics.totalDependencies).toBe(2);
    expect(summary.metrics.directDependencies).toBe(1);
    expect(summary.metrics.transitiveDependencies).toBe(1);
  });
});
