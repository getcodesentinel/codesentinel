import type { GraphAnalysisSummary, RepositoryEvolutionSummary } from "@codesentinel/core";
import type { DeclaredOwner, OwnershipAudit } from "@codesentinel/ownership";

export type ReadingStepRole = "entry" | "core" | "helper" | "test";

export type ReadingPathPerson = {
  authorId: string;
  /** Selected files where this author is the top author by commits, sorted by path. */
  files: readonly string[];
  /** Commits this author made in the selected files. */
  commits: number;
};

export type ReadingStep = {
  /** 1-based position in the path. */
  order: number;
  filePath: string;
  role: ReadingStepRole;
  /** Short human sentence naming the signal that selected this file. */
  reason: string;
  /** Declared CODEOWNERS owners, or `null` when no ownership data is available. */
  owner: readonly DeclaredOwner[] | null;
  observedTopAuthor: string | null;
  commits: number;
  churn: number;
  fanInInternal: number;
  /** Test files attached to this step, sorted by path. Empty when `includeTests` steps them. */
  testFiles: readonly string[];
};

export type ReadingPath = {
  target: string;
  targetKind: "file" | "directory";
  steps: readonly ReadingStep[];
  people: readonly ReadingPathPerson[];
  /** Always empty from the engine: the CLI layer decides which test commands to suggest. */
  commands: readonly string[];
  warnings: readonly string[];
  truncated: boolean;
};

export type ReadingPathInput = {
  /** Repository-relative POSIX path of a file or directory. */
  target: string;
  /** Structural graph; `null`/absent selects git-only mode. */
  graph?: GraphAnalysisSummary | null;
  /** Evolution summary; when unavailable only the graph signals are used. */
  evolution?: RepositoryEvolutionSummary | null;
  /** Optional declared-ownership audit. */
  ownership?: OwnershipAudit | null;
  /** 1..25, default 8. Values outside the range are clamped. */
  maxSteps?: number;
  /** When true, test files are candidates for their own steps instead of being attached. */
  includeTests?: boolean;
};

export type ReadingPathErrorCode = "invalid_target";

export class ReadingPathError extends Error {
  readonly code: ReadingPathErrorCode;

  constructor(code: ReadingPathErrorCode, message: string) {
    super(message);
    this.name = "ReadingPathError";
    this.code = code;
  }
}

export const DEFAULT_MAX_STEPS = 8;
export const MIN_MAX_STEPS = 1;
export const MAX_MAX_STEPS = 25;
