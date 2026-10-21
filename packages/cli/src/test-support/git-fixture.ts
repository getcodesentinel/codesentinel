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

/**
 * Git author/committer environment variables take precedence over user.name/user.email config.
 * semantic-release exports a bot identity that would otherwise author fixture commits, so pin the
 * identity and dates in the environment instead of relying on `git -c` overrides.
 */
export const commitIdentityEnvironment = (
  author: { name: string; email: string },
  authoredAt: string,
): NodeJS.ProcessEnv => ({
  GIT_AUTHOR_NAME: author.name,
  GIT_AUTHOR_EMAIL: author.email,
  GIT_COMMITTER_NAME: author.name,
  GIT_COMMITTER_EMAIL: author.email,
  GIT_AUTHOR_DATE: authoredAt,
  GIT_COMMITTER_DATE: authoredAt,
});

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
