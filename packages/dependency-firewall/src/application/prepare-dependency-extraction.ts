import type { LockfileExtraction } from "../domain/types.js";
import { loadPackageJson, selectLockfile } from "../infrastructure/fs-loader.js";
import { parsePackageJson } from "../parsing/package-json-loader.js";
import { parseLockfileExtraction } from "./parse-lockfile-extraction.js";
import { resolveRegistryGraphFromDirectSpecs } from "./resolve-registry-graph.js";

type LockfileKind = "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun";

export type PreparedDependencyExtraction =
  | {
      available: false;
      reason: "package_json_not_found" | "lockfile_not_found";
    }
  | {
      available: true;
      lockfileKind: LockfileKind;
      extraction: LockfileExtraction;
    };

export const prepareDependencyExtraction = async (
  repositoryPath: string,
): Promise<PreparedDependencyExtraction> => {
  const packageJson = loadPackageJson(repositoryPath);
  if (packageJson === null) {
    return {
      available: false,
      reason: "package_json_not_found",
    };
  }

  const directSpecs = parsePackageJson(packageJson.raw);
  const lockfile = selectLockfile(repositoryPath);

  if (lockfile === null) {
    const resolvedGraph = await resolveRegistryGraphFromDirectSpecs(directSpecs, {
      maxNodes: 500,
      maxDepth: 8,
    });
    if (resolvedGraph.nodes.length === 0) {
      return {
        available: false,
        reason: "lockfile_not_found",
      };
    }

    return {
      available: true,
      lockfileKind: "npm",
      extraction: {
        kind: "npm",
        directDependencies: resolvedGraph.directDependencies.map((dependency) => ({
          name: dependency.name,
          requestedRange: dependency.requestedRange,
          scope: dependency.scope,
        })),
        nodes: resolvedGraph.nodes,
      },
    };
  }

  return {
    available: true,
    lockfileKind: lockfile.kind,
    extraction: parseLockfileExtraction(lockfile.kind, lockfile.raw, directSpecs),
  };
};
