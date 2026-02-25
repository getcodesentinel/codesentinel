import type { DirectDependencySpec, LockfileExtraction, LockedDependencyNode } from "../domain/types.js";

type ParserState = "root" | "importers" | "packages" | "packageDeps";

const sanitizeValue = (value: string): string => value.replace(/^['"]|['"]$/g, "").trim();

const parsePackageKey = (rawKey: string): { name: string; version: string } | null => {
  const key = sanitizeValue(rawKey.replace(/:$/, ""));
  const withoutSlash = key.startsWith("/") ? key.slice(1) : key;

  const lastAt = withoutSlash.lastIndexOf("@");
  if (lastAt <= 0) {
    return null;
  }

  const name = withoutSlash.slice(0, lastAt);
  const versionWithPeers = withoutSlash.slice(lastAt + 1);
  const version = versionWithPeers.split("(")[0] ?? versionWithPeers;

  if (name.length === 0 || version.length === 0) {
    return null;
  }

  return { name, version };
};

export const parsePnpmLockfile = (raw: string, directSpecs: readonly DirectDependencySpec[]): LockfileExtraction => {
  const lines = raw.split("\n");
  let state: ParserState = "root";
  let currentPackage: string | null = null;
  let currentDependencyName: string | null = null;
  const dependenciesByNode = new Map<string, Set<string>>();

  for (const line of lines) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }

    if (line.startsWith("importers:")) {
      state = "importers";
      continue;
    }

    if (line.startsWith("packages:")) {
      state = "packages";
      continue;
    }

    if (state === "packages" || state === "packageDeps") {
      const packageMatch = line.match(/^\s{2}([^\s].+):\s*$/);
      if (packageMatch !== null) {
        const parsedKey = parsePackageKey(packageMatch[1] ?? "");
        if (parsedKey !== null) {
          currentPackage = `${parsedKey.name}@${parsedKey.version}`;
          dependenciesByNode.set(currentPackage, new Set());
          state = "packageDeps";
          currentDependencyName = null;
        }
        continue;
      }
    }

    if (state === "packageDeps" && currentPackage !== null) {
      const depLine = line.match(/^\s{6}([^:\s]+):\s*(.+)$/);
      if (depLine !== null) {
        const depName = sanitizeValue(depLine[1] ?? "");
        const depRef = sanitizeValue(depLine[2] ?? "");
        const depVersion = depRef.split("(")[0] ?? depRef;

        if (depName.length > 0 && depVersion.length > 0) {
          dependenciesByNode.get(currentPackage)?.add(`${depName}@${depVersion}`);
        }
        currentDependencyName = null;
        continue;
      }

      const depBlockLine = line.match(/^\s{6}([^:\s]+):\s*$/);
      if (depBlockLine !== null) {
        currentDependencyName = sanitizeValue(depBlockLine[1] ?? "");
        continue;
      }

      const depVersionLine = line.match(/^\s{8}version:\s*(.+)$/);
      if (depVersionLine !== null && currentDependencyName !== null) {
        const depRef = sanitizeValue(depVersionLine[1] ?? "");
        const depVersion = depRef.split("(")[0] ?? depRef;
        if (depVersion.length > 0) {
          dependenciesByNode.get(currentPackage)?.add(`${currentDependencyName}@${depVersion}`);
        }
        currentDependencyName = null;
        continue;
      }

      if (line.match(/^\s{4}(dependencies|optionalDependencies):\s*$/) !== null) {
        continue;
      }
    }
  }

  const nodes: LockedDependencyNode[] = [...dependenciesByNode.entries()]
    .map(([nodeId, deps]) => {
      const at = nodeId.lastIndexOf("@");
      return {
        name: nodeId.slice(0, at),
        version: nodeId.slice(at + 1),
        dependencies: [...deps].sort((a, b) => a.localeCompare(b)),
      };
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );

  return {
    kind: "pnpm",
    directDependencies: directSpecs,
    nodes,
  };
};
