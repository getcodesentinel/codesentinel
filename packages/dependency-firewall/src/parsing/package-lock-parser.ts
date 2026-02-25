import type { DirectDependencySpec, LockfileExtraction, LockedDependencyNode } from "../domain/types.js";

type PackageLockNode = {
  version?: string;
  dependencies?: Record<string, string>;
};

type PackageLockShape = {
  lockfileVersion?: number;
  packages?: Record<string, PackageLockNode>;
  dependencies?: Record<string, { version?: string; dependencies?: Record<string, unknown> }>;
};

export const parsePackageLock = (raw: string, directSpecs: readonly DirectDependencySpec[]): LockfileExtraction => {
  const parsed = JSON.parse(raw) as PackageLockShape;
  const nodes: LockedDependencyNode[] = [];

  if (parsed.packages !== undefined) {
    for (const [packagePath, packageData] of Object.entries(parsed.packages)) {
      if (packagePath.length === 0 || packageData.version === undefined) {
        continue;
      }

      const segments = packagePath.split("node_modules/");
      const name = segments[segments.length - 1] ?? "";
      if (name.length === 0) {
        continue;
      }

      const dependencies = Object.entries(packageData.dependencies ?? {})
        .map(([depName, depRange]) => `${depName}@${String(depRange)}`)
        .sort((a, b) => a.localeCompare(b));

      nodes.push({
        name,
        version: packageData.version,
        dependencies,
      });
    }
  } else if (parsed.dependencies !== undefined) {
    for (const [name, dep] of Object.entries(parsed.dependencies)) {
      if (dep.version === undefined) {
        continue;
      }

      const dependencies = Object.entries(dep.dependencies ?? {})
        .map(([depName, depVersion]) => `${depName}@${String(depVersion)}`)
        .sort((a, b) => a.localeCompare(b));

      nodes.push({
        name,
        version: dep.version,
        dependencies,
      });
    }
  }

  nodes.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  return {
    kind: "npm",
    directDependencies: directSpecs,
    nodes,
  };
};
