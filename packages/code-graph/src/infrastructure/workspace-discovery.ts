import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { WorkspaceKind, WorkspacePackage } from "@codesentinel/core";

type PackageJsonWorkspaceConfig = {
  name?: string;
  workspaces?: readonly string[] | { packages?: readonly string[] };
};

const normalizePath = (pathValue: string): string => pathValue.replaceAll("\\", "/");

const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, "");

const readPackageJson = (path: string): PackageJsonWorkspaceConfig | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJsonWorkspaceConfig;
  } catch {
    return null;
  }
};

const inferWorkspaceKind = (workspacePath: string): WorkspaceKind => {
  const segments = workspacePath.split("/");
  const first = segments[0] ?? "";

  if (first === "apps" || first === "app") {
    return "app";
  }

  if (first === "packages" || first === "package") {
    return "package";
  }

  if (first === "docs" || first === "documentation") {
    return "docs";
  }

  if (first === "examples" || first === "example-apps" || first === "playground") {
    return "example";
  }

  if (first === "tooling" || first === "tools") {
    return "tooling";
  }

  return "unknown";
};

const readWorkspacePatternsFromPackageJson = (projectRoot: string): readonly string[] => {
  const packageJson = readPackageJson(join(projectRoot, "package.json"));
  if (packageJson?.workspaces === undefined) {
    return [];
  }

  const workspaces = packageJson.workspaces;
  if (Array.isArray(workspaces)) {
    const workspaceArray: readonly unknown[] = workspaces;
    return workspaceArray.filter((workspace): workspace is string => typeof workspace === "string");
  }

  const workspaceObject = workspaces as { packages?: readonly string[] };
  return workspaceObject.packages ?? [];
};

const readWorkspacePatternsFromPnpmWorkspace = (projectRoot: string): readonly string[] => {
  const workspacePath = join(projectRoot, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    return [];
  }

  const patterns: string[] = [];
  const lines = readFileSync(workspacePath, "utf8").split("\n");
  let readingPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (!line.startsWith(" ") && !line.startsWith("-")) {
      readingPackages = trimmed === "packages:";
      continue;
    }

    if (!readingPackages) {
      continue;
    }

    const match = trimmed.match(/^-\s+(.+)$/);
    if (match?.[1] !== undefined) {
      patterns.push(stripQuotes(match[1].trim()));
    }
  }

  return patterns;
};

const expandPattern = (projectRoot: string, pattern: string): readonly string[] => {
  const segments = normalizePath(pattern)
    .split("/")
    .filter((segment) => segment.length > 0);
  let current = [projectRoot];

  for (const segment of segments) {
    const next: string[] = [];
    if (segment === "*") {
      for (const directory of current) {
        if (!existsSync(directory)) {
          continue;
        }

        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            next.push(join(directory, entry.name));
          }
        }
      }
    } else {
      for (const directory of current) {
        const candidate = join(directory, segment);
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          next.push(candidate);
        }
      }
    }

    current = next;
  }

  return current;
};

export const discoverWorkspacePackages = (projectRoot: string): readonly WorkspacePackage[] => {
  const absoluteRoot = resolve(projectRoot);
  const packageJsonPatterns = readWorkspacePatternsFromPackageJson(absoluteRoot);
  const pnpmPatterns = readWorkspacePatternsFromPnpmWorkspace(absoluteRoot);
  const patterns = packageJsonPatterns.length > 0 ? packageJsonPatterns : pnpmPatterns;
  const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludePatterns = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));

  const excludedPaths = new Set(
    excludePatterns
      .flatMap((pattern) => expandPattern(absoluteRoot, pattern))
      .map((path) => normalizePath(relative(absoluteRoot, path))),
  );

  const packagesByPath = new Map<string, WorkspacePackage>();
  for (const pattern of includePatterns) {
    for (const absoluteWorkspacePath of expandPattern(absoluteRoot, pattern)) {
      const relativePath = normalizePath(relative(absoluteRoot, absoluteWorkspacePath));
      if (
        relativePath.length === 0 ||
        relativePath.startsWith("..") ||
        excludedPaths.has(relativePath)
      ) {
        continue;
      }

      const packageJsonPath = join(absoluteWorkspacePath, "package.json");
      if (!existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = readPackageJson(packageJsonPath);
      packagesByPath.set(relativePath, {
        name: packageJson?.name ?? basename(absoluteWorkspacePath),
        path: relativePath,
        kind: inferWorkspaceKind(relativePath),
      });
    }
  }

  return [...packagesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
};
