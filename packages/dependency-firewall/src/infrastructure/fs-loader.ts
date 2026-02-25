import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RepositoryFiles = {
  packageJsonPath: string;
  packageJsonRaw: string;
  lockfilePath: string;
  lockfileRaw: string;
};

const LOCKFILE_CANDIDATES: readonly { fileName: string; kind: "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun" }[] = [
  { fileName: "pnpm-lock.yaml", kind: "pnpm" },
  { fileName: "package-lock.json", kind: "npm" },
  { fileName: "npm-shrinkwrap.json", kind: "npm-shrinkwrap" },
  { fileName: "yarn.lock", kind: "yarn" },
  { fileName: "bun.lock", kind: "bun" },
  { fileName: "bun.lockb", kind: "bun" },
];

export type LockfileSelection = {
  path: string;
  kind: "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun";
  raw: string;
};

export const loadPackageJson = (repositoryPath: string): { path: string; raw: string } | null => {
  const packageJsonPath = join(repositoryPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  return {
    path: packageJsonPath,
    raw: readFileSync(packageJsonPath, "utf8"),
  };
};

export const selectLockfile = (repositoryPath: string): LockfileSelection | null => {
  for (const candidate of LOCKFILE_CANDIDATES) {
    const absolutePath = join(repositoryPath, candidate.fileName);
    if (!existsSync(absolutePath)) {
      continue;
    }

    return {
      path: absolutePath,
      kind: candidate.kind,
      raw: readFileSync(absolutePath, "utf8"),
    };
  }

  return null;
};
