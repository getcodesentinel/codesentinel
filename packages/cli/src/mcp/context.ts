import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { normalizeRepositoryPath } from "../application/owners-git.js";
import { McpToolError } from "./errors.js";

export const resolveMcpRoot = (environment: NodeJS.ProcessEnv): string =>
  resolve(environment["CODESENTINEL_ROOT"] ?? process.cwd());

const isOutsideRoot = (relativePath: string): boolean =>
  relativePath.startsWith("..") || isAbsolute(relativePath);

export const resolveRepositoryPath = (root: string, input: string): string => {
  const absolutePath = resolve(root, input);
  const relativePath = relative(root, absolutePath);
  if (relativePath === "" || isOutsideRoot(relativePath)) {
    throw new McpToolError(
      "path_outside_root",
      `path "${input}" is outside the repository root or is the root itself`,
    );
  }

  if (!existsSync(absolutePath)) {
    throw new McpToolError("path_not_found", `path "${input}" does not exist in the repository`);
  }

  return normalizeRepositoryPath(relativePath);
};

export const assertPathInsideRoot = (root: string, absolutePath: string): string => {
  const relativePath = relative(root, absolutePath);
  if (isOutsideRoot(relativePath)) {
    throw new McpToolError(
      "path_outside_root",
      `path "${absolutePath}" is outside the repository root`,
    );
  }

  return normalizeRepositoryPath(relative(root, absolutePath));
};
