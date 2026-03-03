export class BaselineAutoResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineAutoResolutionError";
  }
}

export type BaselineAutoResolutionStrategy =
  | "explicit_sha"
  | "ci_base_branch"
  | "main_branch_previous_commit"
  | "feature_branch_merge_base";

export type BaselineAutoResolutionAttempt = {
  step: string;
  candidate: string;
  outcome: "resolved" | "failed" | "skipped";
  detail?: string;
};

export type BaselineAutoResolution = {
  strategy: BaselineAutoResolutionStrategy;
  resolvedRef: string;
  resolvedSha: string;
  attempts: readonly BaselineAutoResolutionAttempt[];
  baseBranch?: string;
};

export type GitCommandResult = { ok: true; stdout: string } | { ok: false; message: string };

export type BaselineAutoGitAdapter = {
  resolveCommit: (ref: string) => Promise<GitCommandResult>;
  mergeBase: (leftRef: string, rightRef: string) => Promise<GitCommandResult>;
  currentBranch: () => Promise<GitCommandResult>;
  isShallowRepository: () => Promise<GitCommandResult>;
};

export type ResolveAutoBaselineInput = {
  baselineSha?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  mainBranchCandidates?: readonly string[];
  git: BaselineAutoGitAdapter;
};

const DEFAULT_MAIN_BRANCH_CANDIDATES = ["main", "master"] as const;

const providerBaseBranchKeys = [
  "GITHUB_BASE_REF",
  "CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
  "BITBUCKET_PR_DESTINATION_BRANCH",
] as const;

const normalizeMainBranches = (input: readonly string[] | undefined): readonly string[] => {
  const source = input === undefined || input.length === 0 ? DEFAULT_MAIN_BRANCH_CANDIDATES : input;
  const seen = new Set<string>();
  const values: string[] = [];

  for (const candidate of source) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    values.push(trimmed);
  }

  return values.length > 0 ? values : DEFAULT_MAIN_BRANCH_CANDIDATES;
};

const firstNonEmptyEnv = (
  environment: Readonly<Record<string, string | undefined>>,
): { key: string; value: string } | undefined => {
  for (const key of providerBaseBranchKeys) {
    const value = environment[key]?.trim();
    if (value !== undefined && value.length > 0) {
      return { key, value };
    }
  }
  return undefined;
};

const asBoolean = (value: string): boolean => {
  return value.trim().toLowerCase() === "true";
};

const buildNoBaselineMessage = (): string => {
  return "unable to resolve auto baseline; set --baseline-ref <ref> explicitly or provide --baseline <snapshot.json>";
};

export const resolveAutoBaseline = async (
  input: ResolveAutoBaselineInput,
): Promise<BaselineAutoResolution> => {
  const attempts: BaselineAutoResolutionAttempt[] = [];
  const mainBranches = normalizeMainBranches(input.mainBranchCandidates);
  const environment = input.environment ?? {};

  const baselineSha = input.baselineSha?.trim();
  if (baselineSha !== undefined && baselineSha.length > 0) {
    const result = await input.git.resolveCommit(`${baselineSha}^{commit}`);
    if (result.ok) {
      attempts.push({ step: "explicit-sha", candidate: baselineSha, outcome: "resolved" });
      return {
        strategy: "explicit_sha",
        resolvedRef: baselineSha,
        resolvedSha: result.stdout,
        attempts,
      };
    }

    attempts.push({
      step: "explicit-sha",
      candidate: baselineSha,
      outcome: "failed",
      detail: result.message,
    });
    throw new BaselineAutoResolutionError(
      `invalid --baseline-sha '${baselineSha}': ${result.message}`,
    );
  }

  const providerBaseBranch = firstNonEmptyEnv(environment);
  if (providerBaseBranch !== undefined) {
    const originRef = `origin/${providerBaseBranch.value}`;
    const originResult = await input.git.resolveCommit(`${originRef}^{commit}`);
    if (originResult.ok) {
      attempts.push({
        step: `ci-base-branch:${providerBaseBranch.key}`,
        candidate: originRef,
        outcome: "resolved",
      });
      return {
        strategy: "ci_base_branch",
        resolvedRef: originRef,
        resolvedSha: originResult.stdout,
        attempts,
        baseBranch: providerBaseBranch.value,
      };
    }
    attempts.push({
      step: `ci-base-branch:${providerBaseBranch.key}`,
      candidate: originRef,
      outcome: "failed",
      detail: originResult.message,
    });

    const localRef = providerBaseBranch.value;
    const localResult = await input.git.resolveCommit(`${localRef}^{commit}`);
    if (localResult.ok) {
      attempts.push({
        step: `ci-base-branch-local:${providerBaseBranch.key}`,
        candidate: localRef,
        outcome: "resolved",
      });
      return {
        strategy: "ci_base_branch",
        resolvedRef: localRef,
        resolvedSha: localResult.stdout,
        attempts,
        baseBranch: providerBaseBranch.value,
      };
    }
    attempts.push({
      step: `ci-base-branch-local:${providerBaseBranch.key}`,
      candidate: localRef,
      outcome: "failed",
      detail: localResult.message,
    });
  } else {
    attempts.push({
      step: "ci-base-branch",
      candidate: providerBaseBranchKeys.join(","),
      outcome: "skipped",
      detail: "no CI base branch environment variable found",
    });
  }

  const branchResult = await input.git.currentBranch();
  const branchName = branchResult.ok ? branchResult.stdout.trim() : undefined;
  if (branchName !== undefined && mainBranches.includes(branchName)) {
    const headPrevious = await input.git.resolveCommit("HEAD~1^{commit}");
    if (headPrevious.ok) {
      attempts.push({
        step: "main-branch-head-previous",
        candidate: "HEAD~1",
        outcome: "resolved",
      });
      return {
        strategy: "main_branch_previous_commit",
        resolvedRef: "HEAD~1",
        resolvedSha: headPrevious.stdout,
        attempts,
      };
    }
    attempts.push({
      step: "main-branch-head-previous",
      candidate: "HEAD~1",
      outcome: "failed",
      detail: headPrevious.message,
    });
    throw new BaselineAutoResolutionError(
      `unable to resolve baseline from HEAD~1 on branch '${branchName}': ${headPrevious.message}`,
    );
  }

  if (branchName === undefined) {
    attempts.push({
      step: "current-branch",
      candidate: "HEAD",
      outcome: "skipped",
      detail: "detached HEAD or symbolic-ref unavailable",
    });
  } else {
    attempts.push({
      step: "current-branch",
      candidate: branchName,
      outcome: "resolved",
      detail: "feature branch detected",
    });
  }

  const mergeBaseCandidates = [
    ...mainBranches.map((candidate) => `origin/${candidate}`),
    ...mainBranches,
  ];

  for (const candidate of mergeBaseCandidates) {
    const mergeBase = await input.git.mergeBase("HEAD", candidate);
    if (mergeBase.ok) {
      attempts.push({
        step: "merge-base",
        candidate: `HEAD..${candidate}`,
        outcome: "resolved",
      });
      return {
        strategy: "feature_branch_merge_base",
        resolvedRef: mergeBase.stdout,
        resolvedSha: mergeBase.stdout,
        attempts,
      };
    }
    attempts.push({
      step: "merge-base",
      candidate: `HEAD..${candidate}`,
      outcome: "failed",
      detail: mergeBase.message,
    });
  }

  const shallowResult = await input.git.isShallowRepository();
  const shallowRepository = shallowResult.ok && asBoolean(shallowResult.stdout);
  if (shallowRepository) {
    throw new BaselineAutoResolutionError(
      `${buildNoBaselineMessage()}; repository appears shallow. Fetch full history (for example: git fetch --unshallow or fetch-depth: 0).`,
    );
  }

  throw new BaselineAutoResolutionError(buildNoBaselineMessage());
};
