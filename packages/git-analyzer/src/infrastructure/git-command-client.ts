import { execFileSync } from "node:child_process";

export class GitCommandError extends Error {
  readonly args: readonly string[];

  constructor(message: string, args: readonly string[]) {
    super(message);
    this.name = "GitCommandError";
    this.args = args;
  }
}

export interface GitCommandClient {
  run(repositoryPath: string, args: readonly string[]): string;
}

export class ExecGitCommandClient implements GitCommandClient {
  run(repositoryPath: string, args: readonly string[]): string {
    try {
      return execFileSync("git", ["-C", repositoryPath, ...args], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 64,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git execution error";
      throw new GitCommandError(message, args);
    }
  }
}
