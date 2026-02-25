import { GIT_LOG_FORMAT } from "../domain/git-log-format.js";
import type { GitCommitRecord } from "../domain/evolution-types.js";
import {
  mapParseProgressToHistoryProgress,
  type GitHistoryProvider,
  type GitHistoryProgressEvent,
} from "../application/git-history-provider.js";
import { GitCommandError, type GitCommandClient } from "./git-command-client.js";
import { parseGitLog } from "../parsing/git-log-parser.js";

const NON_GIT_CODES = ["not a git repository", "not in a git directory"];

const isNotGitError = (error: GitCommandError): boolean => {
  const lower = error.message.toLowerCase();
  return NON_GIT_CODES.some((code) => lower.includes(code));
};

export class GitCliHistoryProvider implements GitHistoryProvider {
  constructor(private readonly gitClient: GitCommandClient) {}

  isGitRepository(repositoryPath: string): boolean {
    try {
      const output = this.gitClient.run(repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
      return output.trim() === "true";
    } catch (error) {
      if (error instanceof GitCommandError && isNotGitError(error)) {
        return false;
      }

      throw error;
    }
  }

  getCommitHistory(
    repositoryPath: string,
    onProgress?: (event: GitHistoryProgressEvent) => void,
  ): readonly GitCommitRecord[] {
    const output = this.gitClient.run(repositoryPath, [
      "-c",
      "core.quotepath=false",
      "log",
      "--use-mailmap",
      "--no-merges",
      "--date=unix",
      `--pretty=format:${GIT_LOG_FORMAT}`,
      "--numstat",
      "--find-renames",
    ]);
    onProgress?.({ stage: "git_log_received", bytes: Buffer.byteLength(output, "utf8") });
    const commits = parseGitLog(output, (event) => onProgress?.(mapParseProgressToHistoryProgress(event)));
    onProgress?.({ stage: "git_log_parsed", commits: commits.length });
    return commits;
  }
}
