import type { GitCommitRecord } from "../domain/evolution-types.js";
import type { ParseGitLogProgressEvent } from "../parsing/git-log-parser.js";

export type GitHistoryProgressEvent =
  | { stage: "git_log_received"; bytes: number }
  | { stage: "git_log_parsed"; commits: number }
  | { stage: "git_log_parse_progress"; parsedRecords: number; totalRecords: number };

export interface GitHistoryProvider {
  isGitRepository(repositoryPath: string): boolean;
  getCommitHistory(
    repositoryPath: string,
    onProgress?: (event: GitHistoryProgressEvent) => void,
  ): readonly GitCommitRecord[];
}

export const mapParseProgressToHistoryProgress = (
  event: ParseGitLogProgressEvent,
): GitHistoryProgressEvent => ({
  stage: "git_log_parse_progress",
  parsedRecords: event.parsedRecords,
  totalRecords: event.totalRecords,
});
