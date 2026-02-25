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
  const results: R[] = new Array(values.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(effectiveLimit, values.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= values.length) {
        return;
      }

      const value = values[current];
      if (value === undefined) {
        return;
      }

      results[current] = await handler(value);
    }
  });

  await Promise.all(workers);
  return results;
};

export const analyzeDependencyExposure = async (
  input: AnalyzeDependencyExposureInput,
  metadataProvider: DependencyMetadataProvider,
): Promise<ExternalAnalysisSummary> => {
  const packageJson = loadPackageJson(input.repositoryPath);
  if (packageJson === null) {
    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "package_json_not_found",
    };
  }

  const lockfile = selectLockfile(input.repositoryPath);
  if (lockfile === null) {
    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "lockfile_not_found",
    };
  }

  try {
    const directSpecs = parsePackageJson(packageJson.raw);
    const extraction = parseExtraction(lockfile.kind, lockfile.raw, directSpecs);
    const config = withDefaults(input.config);

    const metadataEntries = await mapWithConcurrency(
      extraction.nodes,
      config.metadataRequestConcurrency,
      async (node) => ({
        key: `${node.name}@${node.version}`,
        metadata: await metadataProvider.getMetadata(node.name, node.version),
      }),
    );

    const metadataByKey = new Map<string, Awaited<(typeof metadataEntries)[number]>["metadata"]>();
    for (const entry of metadataEntries) {
      metadataByKey.set(entry.key, entry.metadata);
    }

    return buildExternalAnalysisSummary(input.repositoryPath, extraction, metadataByKey, config);
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
