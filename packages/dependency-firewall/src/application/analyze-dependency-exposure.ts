import type { ExternalAnalysisSummary } from "@codesentinel/core";
import { buildExternalAnalysisSummary } from "../domain/external-analysis.js";
import {
  DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  type DependencyMetadataProvider,
  type ExternalAnalysisConfig,
  type LockfileExtraction,
} from "../domain/types.js";
import { loadPackageJson, selectLockfile } from "../infrastructure/fs-loader.js";
import { parsePackageJson } from "../parsing/package-json-loader.js";
import { parsePackageLock } from "../parsing/package-lock-parser.js";
import { parsePnpmLockfile } from "../parsing/pnpm-lock-parser.js";
import { parseYarnLock } from "../parsing/yarn-lock-parser.js";
import { parseBunLock } from "../parsing/bun-lock-parser.js";

export type AnalyzeDependencyExposureInput = {
  repositoryPath: string;
  config?: Partial<ExternalAnalysisConfig>;
};

export type DependencyExposureProgressEvent =
  | { stage: "package_json_loaded" }
  | { stage: "lockfile_selected"; kind: "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun" }
  | { stage: "lockfile_parsed"; dependencyNodes: number; directDependencies: number }
  | { stage: "metadata_fetch_started"; total: number }
  | { stage: "metadata_fetch_progress"; completed: number; total: number; packageName: string }
  | { stage: "metadata_fetch_completed"; total: number }
  | { stage: "summary_built"; totalDependencies: number; directDependencies: number };

const withDefaults = (overrides: Partial<ExternalAnalysisConfig> | undefined): ExternalAnalysisConfig => ({
  ...DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  ...overrides,
});

const parseExtraction = (
  lockfileKind: "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun",
  lockfileRaw: string,
  directSpecs: ReturnType<typeof parsePackageJson>,
): LockfileExtraction => {
  switch (lockfileKind) {
    case "pnpm":
      return parsePnpmLockfile(lockfileRaw, directSpecs);
    case "npm":
    case "npm-shrinkwrap":
      return {
        ...parsePackageLock(lockfileRaw, directSpecs),
        kind: lockfileKind,
      };
    case "yarn":
      return parseYarnLock(lockfileRaw, directSpecs);
    case "bun":
      return parseBunLock(lockfileRaw, directSpecs);
    default:
      throw new Error("unsupported_lockfile_format");
  }
};

const mapWithConcurrency = async <T, R>(
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

export const analyzeDependencyExposure = async (
  input: AnalyzeDependencyExposureInput,
  metadataProvider: DependencyMetadataProvider,
  onProgress?: (event: DependencyExposureProgressEvent) => void,
): Promise<ExternalAnalysisSummary> => {
  const packageJson = loadPackageJson(input.repositoryPath);
  if (packageJson === null) {
    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "package_json_not_found",
    };
  }
  onProgress?.({ stage: "package_json_loaded" });

  const lockfile = selectLockfile(input.repositoryPath);
  if (lockfile === null) {
    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "lockfile_not_found",
    };
  }
  onProgress?.({ stage: "lockfile_selected", kind: lockfile.kind });

  try {
    const directSpecs = parsePackageJson(packageJson.raw);
    const extraction = parseExtraction(lockfile.kind, lockfile.raw, directSpecs);
    const config = withDefaults(input.config);
    const directNames = new Set(extraction.directDependencies.map((dependency) => dependency.name));
    onProgress?.({
      stage: "lockfile_parsed",
      dependencyNodes: extraction.nodes.length,
      directDependencies: extraction.directDependencies.length,
    });
    onProgress?.({ stage: "metadata_fetch_started", total: extraction.nodes.length });

    let completed = 0;

    const metadataEntries = await mapWithConcurrency(
      extraction.nodes,
      config.metadataRequestConcurrency,
      async (node) => {
        const result = {
          key: `${node.name}@${node.version}`,
          metadata: await metadataProvider.getMetadata(node.name, node.version, {
            directDependency: directNames.has(node.name),
          }),
        };
        completed += 1;
        onProgress?.({
          stage: "metadata_fetch_progress",
          completed,
          total: extraction.nodes.length,
          packageName: node.name,
        });
        return result;
      },
    );
    onProgress?.({ stage: "metadata_fetch_completed", total: extraction.nodes.length });

    const metadataByKey = new Map<string, Awaited<(typeof metadataEntries)[number]>["metadata"]>();
    for (const entry of metadataEntries) {
      metadataByKey.set(entry.key, entry.metadata);
    }

    const summary = buildExternalAnalysisSummary(input.repositoryPath, extraction, metadataByKey, config);
    if (summary.available) {
      onProgress?.({
        stage: "summary_built",
        totalDependencies: summary.metrics.totalDependencies,
        directDependencies: summary.metrics.directDependencies,
      });
    }

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.includes("unsupported_lockfile_format")) {
      return {
        targetPath: input.repositoryPath,
        available: false,
        reason: "unsupported_lockfile_format",
      };
    }

    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "invalid_lockfile",
    };
  }
};
