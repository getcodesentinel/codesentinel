import { execFileSync } from "node:child_process";

/**
 * A Husky hook inside a linked worktree exports GIT_DIR, and `git -C <fixture>` still uses that
 * GIT_DIR for the index and object store. Without stripping it, fixture commits would land in the
 * real checkout instead of the throwaway repository.
 */
export const INHERITED_GIT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
] as const;

export const withoutInheritedGitVariables = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const sanitized = { ...environment };
  for (const variable of INHERITED_GIT_VARIABLES) {
    delete sanitized[variable];
  }
  return sanitized;
};

export const createGitFixtureEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  withoutInheritedGitVariables({ ...process.env, ...overrides });

export const stripInheritedGitVariables = (): void => {
  for (const variable of INHERITED_GIT_VARIABLES) {
    delete process.env[variable];
  }
};

export const runGit = (
  repositoryPath: string,
  args: readonly string[],
  overrides: NodeJS.ProcessEnv = {},
): string =>
  execFileSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: createGitFixtureEnvironment(overrides),
  });
