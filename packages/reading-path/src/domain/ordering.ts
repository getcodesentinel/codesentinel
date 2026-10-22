import type {
  FileAuthorShare,
  FileEvolutionMetrics,
  RepositoryEvolutionSummary,
} from "@codesentinel/core";
import { comparePaths } from "./compare.js";
import type { GraphIndex } from "./graph-index.js";
import { isTestPath } from "./seed-resolution.js";
import { DEFAULT_MAX_STEPS, MAX_MAX_STEPS, MIN_MAX_STEPS, type ReadingStepRole } from "./types.js";

export type CouplingInfo = {
  score: number;
  coChangeCommits: number;
};

export type EvolutionFile = FileEvolutionMetrics;

export type EvolutionIndex = {
  available: boolean;
  churn(filePath: string): number;
  commits(filePath: string): number;
  file(filePath: string): FileEvolutionMetrics | null;
  coupling(fileA: string, fileB: string): CouplingInfo | null;
};

const pairKey = (fileA: string, fileB: string): string =>
  comparePaths(fileA, fileB) <= 0 ? `${fileA}\u0000${fileB}` : `${fileB}\u0000${fileA}`;

export const createEvolutionIndex = (
  evolution: RepositoryEvolutionSummary | null | undefined,
): EvolutionIndex => {
  if (evolution === null || evolution === undefined || !evolution.available) {
    return {
      available: false,
      churn: () => 0,
      commits: () => 0,
      file: () => null,
      coupling: () => null,
    };
  }

  const files = new Map<string, FileEvolutionMetrics>();
  for (const file of evolution.files) {
    if (!files.has(file.filePath)) files.set(file.filePath, file);
  }

  const pairs = new Map<string, CouplingInfo>();
  for (const pair of evolution.coupling.pairs) {
    const key = pairKey(pair.fileA, pair.fileB);
    const existing = pairs.get(key);
    if (
      existing === undefined ||
      pair.couplingScore > existing.score ||
      (pair.couplingScore === existing.score && pair.coChangeCommits > existing.coChangeCommits)
    ) {
      pairs.set(key, {
        score: pair.couplingScore,
        coChangeCommits: pair.coChangeCommits,
      });
    }
  }

  return {
    available: true,
    churn: (filePath) => files.get(filePath)?.churnTotal ?? 0,
    commits: (filePath) => files.get(filePath)?.commitCount ?? 0,
    file: (filePath) => files.get(filePath) ?? null,
    coupling: (fileA, fileB) => pairs.get(pairKey(fileA, fileB)) ?? null,
  };
};

export const resolveMaxSteps = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_STEPS;
  return Math.min(MAX_MAX_STEPS, Math.max(MIN_MAX_STEPS, Math.trunc(value)));
};

export const medianOf = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const topAuthorId = (shares: readonly FileAuthorShare[]): string | null => {
  let top: { authorId: string; commits: number } | null = null;

  for (const share of shares) {
    if (share.authorId.length === 0) continue;
    if (
      top === null ||
      share.commits > top.commits ||
      (share.commits === top.commits && comparePaths(share.authorId, top.authorId) < 0)
    ) {
      top = { authorId: share.authorId, commits: share.commits };
    }
  }

  return top?.authorId ?? null;
};

const pluralized = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const importCount = (count: number): string => pluralized(count, "import", "imports");
const importerCount = (count: number): string => pluralized(count, "importer", "importers");
const commitCount = (count: number): string => pluralized(count, "commit", "commits");
const lineCount = (count: number): string => pluralized(count, "line", "lines");

export type OrderedReadingFile = {
  filePath: string;
  role: ReadingStepRole;
  reason: string;
};

type OrderingStats = {
  steppable: readonly string[];
  steppableSet: ReadonlySet<string>;
  internalFanIn(filePath: string): number;
  fanInNorm(filePath: string): number;
  churnNorm(filePath: string): number;
  medianFanIn: number;
};

const createStats = (
  steppableFiles: readonly string[],
  graphIndex: GraphIndex,
  evolution: EvolutionIndex,
): OrderingStats => {
  const steppable = [...new Set(steppableFiles)].sort(comparePaths);
  const steppableSet = new Set(steppable);

  let maxFanIn = 0;
  let maxChurn = 0;
  for (const filePath of steppable) {
    maxFanIn = Math.max(maxFanIn, graphIndex.fanInInternal(filePath));
    maxChurn = Math.max(maxChurn, evolution.churn(filePath));
  }

  const internalFanIn = (filePath: string): number => graphIndex.fanInInternal(filePath);
  const fanInNorm = (filePath: string): number =>
    maxFanIn === 0 ? 0 : internalFanIn(filePath) / maxFanIn;
  const churnNorm = (filePath: string): number =>
    maxChurn === 0 ? 0 : evolution.churn(filePath) / maxChurn;

  return {
    steppable,
    steppableSet,
    internalFanIn,
    fanInNorm,
    churnNorm,
    medianFanIn: medianOf(steppable.map(internalFanIn)),
  };
};

const roleFor = (
  order: number,
  filePath: string,
  includeTests: boolean,
  internalFanIn: number,
  medianFanIn: number,
): ReadingStepRole => {
  if (order === 1) return "entry";
  if (includeTests && isTestPath(filePath)) return "test";
  if (internalFanIn > medianFanIn) return "core";
  return "helper";
};

const entryReason = (filePath: string, steppableCount: number, graphIndex: GraphIndex): string => {
  if (steppableCount === 1) return "the module has a single file";

  const external = graphIndex.fanInExternal(filePath);
  if (external > 0) {
    return `external interface: ${importCount(external)} from outside the module`;
  }

  return `no external importers; ${importerCount(graphIndex.fanInInternal(filePath))}`;
};

type GreedyCandidate = {
  filePath: string;
  score: number;
  coupling: CouplingInfo | null;
  fanInNorm: number;
  churnNorm: number;
};

const chooseGreedyCandidate = (
  current: string,
  candidates: readonly string[],
  stats: OrderingStats,
  evolution: EvolutionIndex,
): GreedyCandidate | null => {
  let best: GreedyCandidate | null = null;

  for (const filePath of candidates) {
    const coupling = evolution.coupling(current, filePath);
    const fanInNorm = stats.fanInNorm(filePath);
    const churnNorm = stats.churnNorm(filePath);
    const score = 0.5 * (coupling?.score ?? 0) + 0.3 * fanInNorm + 0.2 * churnNorm;
    const candidate: GreedyCandidate = { filePath, score, coupling, fanInNorm, churnNorm };

    if (
      best === null ||
      score > best.score ||
      (score === best.score && comparePaths(filePath, best.filePath) < 0)
    ) {
      best = candidate;
    }
  }

  return best;
};

const greedyReason = (
  current: string,
  candidate: GreedyCandidate,
  stats: OrderingStats,
  graphIndex: GraphIndex,
  evolution: EvolutionIndex,
): string => {
  const couplingContribution = 0.5 * (candidate.coupling?.score ?? 0);
  const fanInContribution = 0.3 * candidate.fanInNorm;
  const churnContribution = 0.2 * candidate.churnNorm;

  if (couplingContribution === 0 && fanInContribution === 0 && churnContribution === 0) {
    return graphIndex.importsTo(current, candidate.filePath)
      ? `import of ${current}`
      : `imported by ${current}`;
  }

  if (
    couplingContribution >= fanInContribution &&
    couplingContribution >= churnContribution &&
    candidate.coupling !== null
  ) {
    return `most changed together with ${current} (${commitCount(candidate.coupling.coChangeCommits)})`;
  }

  if (fanInContribution >= churnContribution) {
    return `central inside the module: ${importerCount(stats.internalFanIn(candidate.filePath))}`;
  }

  return `most churned neighbour (${lineCount(evolution.churn(candidate.filePath))} changed)`;
};

const chooseExhaustedCandidate = (
  remaining: readonly string[],
  stats: OrderingStats,
  evolution: EvolutionIndex,
): string | null => {
  let best: string | null = null;

  for (const filePath of remaining) {
    if (best === null) {
      best = filePath;
      continue;
    }

    const internal = stats.internalFanIn(filePath);
    const bestInternal = stats.internalFanIn(best);
    if (internal > bestInternal) {
      best = filePath;
      continue;
    }
    if (internal < bestInternal) continue;

    const churn = evolution.churn(filePath);
    const bestChurn = evolution.churn(best);
    if (churn > bestChurn) {
      best = filePath;
      continue;
    }
    if (churn < bestChurn) continue;

    if (comparePaths(filePath, best) < 0) best = filePath;
  }

  return best;
};

const exhaustedReason = (
  filePath: string,
  stats: OrderingStats,
  evolution: EvolutionIndex,
): string => {
  const internal = stats.internalFanIn(filePath);
  if (internal > 0) {
    return `central inside the module: ${importerCount(internal)}`;
  }
  return `highest churn in the module (${lineCount(evolution.churn(filePath))})`;
};

export type OrderReadingPathParams = {
  steppableFiles: readonly string[];
  graphIndex: GraphIndex;
  evolution: EvolutionIndex;
  hasGraph: boolean;
  includeTests: boolean;
  maxSteps: number;
};

const orderGraphReadingPath = (
  stats: OrderingStats,
  graphIndex: GraphIndex,
  evolution: EvolutionIndex,
  includeTests: boolean,
  maxSteps: number,
): readonly OrderedReadingFile[] => {
  const firstFile = stats.steppable[0];
  if (firstFile === undefined) return [];

  const result: OrderedReadingFile[] = [];
  const visited = new Set<string>();

  const add = (filePath: string, reason: string): void => {
    result.push({
      filePath,
      role: roleFor(
        result.length + 1,
        filePath,
        includeTests,
        stats.internalFanIn(filePath),
        stats.medianFanIn,
      ),
      reason,
    });
    visited.add(filePath);
  };

  let entry = firstFile;
  let entryExternal = graphIndex.fanInExternal(entry);
  for (const filePath of stats.steppable) {
    const external = graphIndex.fanInExternal(filePath);
    if (
      external > entryExternal ||
      (external === entryExternal &&
        (filePath.length < entry.length ||
          (filePath.length === entry.length && comparePaths(filePath, entry) < 0)))
    ) {
      entry = filePath;
      entryExternal = external;
    }
  }

  add(entry, entryReason(entry, stats.steppable.length, graphIndex));

  while (result.length < maxSteps) {
    const current = result[result.length - 1]?.filePath;
    if (current === undefined) break;

    const neighbourCandidates = graphIndex
      .neighbours(current)
      .filter((filePath) => stats.steppableSet.has(filePath) && !visited.has(filePath));

    if (neighbourCandidates.length > 0) {
      const candidate = chooseGreedyCandidate(current, neighbourCandidates, stats, evolution);
      if (candidate === null) break;
      add(candidate.filePath, greedyReason(current, candidate, stats, graphIndex, evolution));
      continue;
    }

    const remaining = stats.steppable.filter((filePath) => !visited.has(filePath));
    const candidate = chooseExhaustedCandidate(remaining, stats, evolution);
    if (candidate === null) break;
    add(candidate, exhaustedReason(candidate, stats, evolution));
  }

  return result;
};

type GitOnlyCandidate = {
  filePath: string;
  score: number;
  churn: number;
  couplingScore: number;
  coChangeCommits: number;
  otherPath: string | null;
};

const chooseGitOnlyCandidate = (
  remaining: readonly string[],
  selected: readonly OrderedReadingFile[],
  stats: OrderingStats,
  evolution: EvolutionIndex,
): GitOnlyCandidate | null => {
  let best: GitOnlyCandidate | null = null;

  for (const filePath of remaining) {
    let couplingScore = 0;
    let coChangeCommits = 0;
    let otherPath: string | null = null;

    for (const selectedFile of selected) {
      const coupling = evolution.coupling(filePath, selectedFile.filePath);
      if (coupling === null || coupling.score <= couplingScore) continue;
      couplingScore = coupling.score;
      coChangeCommits = coupling.coChangeCommits;
      otherPath = selectedFile.filePath;
    }

    const churn = evolution.churn(filePath);
    const score = 0.5 * couplingScore + 0.5 * stats.churnNorm(filePath);
    const candidate: GitOnlyCandidate = {
      filePath,
      score,
      churn,
      couplingScore,
      coChangeCommits,
      otherPath,
    };

    if (
      best === null ||
      score > best.score ||
      (score === best.score &&
        (churn > best.churn || (churn === best.churn && comparePaths(filePath, best.filePath) < 0)))
    ) {
      best = candidate;
    }
  }

  return best;
};

const orderGitOnlyReadingPath = (
  stats: OrderingStats,
  evolution: EvolutionIndex,
  includeTests: boolean,
  maxSteps: number,
): readonly OrderedReadingFile[] => {
  const result: OrderedReadingFile[] = [];
  const visited = new Set<string>();

  const add = (filePath: string, reason: string): void => {
    result.push({
      filePath,
      role: roleFor(
        result.length + 1,
        filePath,
        includeTests,
        stats.internalFanIn(filePath),
        stats.medianFanIn,
      ),
      reason,
    });
    visited.add(filePath);
  };

  while (result.length < maxSteps) {
    const remaining = stats.steppable.filter((filePath) => !visited.has(filePath));
    const candidate = chooseGitOnlyCandidate(remaining, result, stats, evolution);
    if (candidate === null) break;

    const couplingContribution = 0.5 * candidate.couplingScore;
    const churnContribution = 0.5 * stats.churnNorm(candidate.filePath);

    if (
      candidate.couplingScore > 0 &&
      couplingContribution >= churnContribution &&
      candidate.otherPath !== null
    ) {
      add(
        candidate.filePath,
        `co-changes with ${candidate.otherPath} (${commitCount(candidate.coChangeCommits)}) and changed ${lineCount(candidate.churn)}`,
      );
      continue;
    }

    add(
      candidate.filePath,
      `changed ${lineCount(candidate.churn)} in ${commitCount(evolution.commits(candidate.filePath))} (no structural graph)`,
    );
  }

  return result;
};

export const orderReadingPath = (params: OrderReadingPathParams): readonly OrderedReadingFile[] => {
  const stats = createStats(params.steppableFiles, params.graphIndex, params.evolution);

  if (!params.hasGraph) {
    return orderGitOnlyReadingPath(stats, params.evolution, params.includeTests, params.maxSteps);
  }

  return orderGraphReadingPath(
    stats,
    params.graphIndex,
    params.evolution,
    params.includeTests,
    params.maxSteps,
  );
};
