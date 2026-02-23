import type { GitCommitRecord } from "../domain/evolution-types.js";

export interface GitHistoryProvider {
  isGitRepository(repositoryPath: string): boolean;
  getCommitHistory(repositoryPath: string): readonly GitCommitRecord[];
}
