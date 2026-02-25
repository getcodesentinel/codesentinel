import type {
  CouplingMatrix,
  FileAuthorShare,
  FileCoupling,
  FileEvolutionMetrics,
  Hotspot,
  RepositoryEvolutionSummary,
} from "@codesentinel/core";
import type { EvolutionComputationConfig, GitCommitRecord } from "./evolution-types.js";

type FileAccumulator = {
  commitCount: number;
  recentCommitCount: number;
  churnAdded: number;
  churnDeleted: number;
  authors: Map<string, number>;
};

type AuthorProfile = {
  authorId: string;
  commitCount: number;
  primaryName: string;
  emailStem: string | null;
  isBot: boolean;
};

const pairKey = (a: string, b: string): string => `${a}\u0000${b}`;

const round4 = (value: number): number => Number(value.toFixed(4));

const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractEmailStem = (authorId: string): string | null => {
  const normalized = authorId.trim().toLowerCase();
  const githubNoReplyMatch = normalized.match(/^\d+\+([^@]+)@users\.noreply\.github\.com$/);
  if (githubNoReplyMatch?.[1] !== undefined) {
    return githubNoReplyMatch[1].replace(/[._+-]/g, "");
  }

  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0) {
    return null;
  }

  return normalized.slice(0, atIndex).replace(/[._+-]/g, "");
};

const areNamesCompatible = (left: string, right: string): boolean => {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  if (left === right) {
    return true;
  }

  if (left.startsWith(`${right} `) || right.startsWith(`${left} `)) {
    return true;
  }

  return false;
};

const chooseCanonicalAuthorId = (profiles: readonly AuthorProfile[]): string => {
  const ordered = [...profiles].sort((a, b) => {
    const aIsNoReply = a.authorId.includes("@users.noreply.github.com");
    const bIsNoReply = b.authorId.includes("@users.noreply.github.com");
    if (aIsNoReply !== bIsNoReply) {
      return aIsNoReply ? 1 : -1;
    }

    if (a.commitCount !== b.commitCount) {
      return b.commitCount - a.commitCount;
    }

    return a.authorId.localeCompare(b.authorId);
  });

  return ordered[0]?.authorId ?? "";
};

const buildAuthorAliasMap = (commits: readonly GitCommitRecord[]): ReadonlyMap<string, string> => {
  const nameCountsByAuthorId = new Map<string, Map<string, number>>();
  const commitCountByAuthorId = new Map<string, number>();

  for (const commit of commits) {
    commitCountByAuthorId.set(commit.authorId, (commitCountByAuthorId.get(commit.authorId) ?? 0) + 1);

    const normalizedName = normalizeName(commit.authorName);
    const names = nameCountsByAuthorId.get(commit.authorId) ?? new Map<string, number>();
    if (normalizedName.length > 0) {
      names.set(normalizedName, (names.get(normalizedName) ?? 0) + 1);
    }
    nameCountsByAuthorId.set(commit.authorId, names);
  }

  const profiles: AuthorProfile[] = [...commitCountByAuthorId.entries()].map(([authorId, commitCount]) => {
    const names = nameCountsByAuthorId.get(authorId);
    const primaryName =
      names === undefined
        ? ""
        : [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
    const normalizedAuthorId = authorId.toLowerCase();
    const isBot = normalizedAuthorId.includes("[bot]");

    return {
      authorId,
      commitCount,
      primaryName,
      emailStem: isBot ? null : extractEmailStem(authorId),
      isBot,
    };
  });

  const groupsByStem = new Map<string, AuthorProfile[]>();
  for (const profile of profiles) {
    if (profile.emailStem === null || profile.emailStem.length < 4) {
      continue;
    }

    const current = groupsByStem.get(profile.emailStem) ?? [];
    current.push(profile);
    groupsByStem.set(profile.emailStem, current);
  }

  const aliasMap = new Map<string, string>();
  for (const profile of profiles) {
    aliasMap.set(profile.authorId, profile.authorId);
  }

  for (const group of groupsByStem.values()) {
    if (group.length < 2) {
      continue;
    }

    const compatible: AuthorProfile[] = [];
    for (const profile of group) {
      if (profile.isBot || profile.primaryName.length === 0) {
        continue;
      }

      compatible.push(profile);
    }

    if (compatible.length < 2) {
      continue;
    }

    const canonical = chooseCanonicalAuthorId(compatible);
    const canonicalProfile = compatible.find((candidate) => candidate.authorId === canonical);
    if (canonicalProfile === undefined) {
      continue;
    }

    for (const profile of compatible) {
      if (areNamesCompatible(profile.primaryName, canonicalProfile.primaryName)) {
        aliasMap.set(profile.authorId, canonical);
      }
    }
  }

  return aliasMap;
};

const computeBusFactor = (
  authorDistribution: readonly FileAuthorShare[],
  threshold: number,
): number => {
  if (authorDistribution.length === 0) {
    return 0;
  }

  let coveredShare = 0;
  for (let i = 0; i < authorDistribution.length; i += 1) {
    const entry = authorDistribution[i];
    if (entry === undefined) {
      continue;
    }

    coveredShare += entry.share;
    if (coveredShare >= threshold) {
      return i + 1;
    }
  }

  return authorDistribution.length;
};

const finalizeAuthorDistribution = (authorCommits: ReadonlyMap<string, number>): readonly FileAuthorShare[] => {
  const totalCommits = [...authorCommits.values()].reduce((sum, value) => sum + value, 0);
  if (totalCommits === 0) {
    return [];
  }

  return [...authorCommits.entries()]
    .map(([authorId, commits]) => ({
      authorId,
      commits,
      share: round4(commits / totalCommits),
    }))
    .sort((a, b) => b.commits - a.commits || a.authorId.localeCompare(b.authorId));
};

const buildCouplingMatrix = (
  coChangeByPair: ReadonlyMap<string, number>,
  fileCommitCount: ReadonlyMap<string, number>,
  consideredCommits: number,
  skippedLargeCommits: number,
  maxCouplingPairs: number,
): CouplingMatrix => {
  const allPairs: FileCoupling[] = [];

  for (const [key, coChangeCommits] of coChangeByPair.entries()) {
    const [fileA, fileB] = key.split("\u0000");
    if (fileA === undefined || fileB === undefined) {
      continue;
    }

    const fileACommits = fileCommitCount.get(fileA) ?? 0;
    const fileBCommits = fileCommitCount.get(fileB) ?? 0;
    const denominator = fileACommits + fileBCommits - coChangeCommits;
    const couplingScore = denominator === 0 ? 0 : round4(coChangeCommits / denominator);

    allPairs.push({
      fileA,
      fileB,
      coChangeCommits,
      couplingScore,
    });
  }

  allPairs.sort(
    (a, b) =>
      b.coChangeCommits - a.coChangeCommits ||
      b.couplingScore - a.couplingScore ||
      a.fileA.localeCompare(b.fileA) ||
      a.fileB.localeCompare(b.fileB),
  );

  const truncated = allPairs.length > maxCouplingPairs;

  return {
    pairs: truncated ? allPairs.slice(0, maxCouplingPairs) : allPairs,
    totalPairCount: allPairs.length,
    consideredCommits,
    skippedLargeCommits,
    truncated,
  };
};

const selectHotspots = (
  files: readonly FileEvolutionMetrics[],
  config: EvolutionComputationConfig,
): { hotspots: readonly Hotspot[]; threshold: number } => {
  if (files.length === 0) {
    return { hotspots: [], threshold: 0 };
  }

  const sorted = [...files].sort(
    (a, b) =>
      b.commitCount - a.commitCount || b.churnTotal - a.churnTotal || a.filePath.localeCompare(b.filePath),
  );

  const hotspotCount = Math.max(config.hotspotMinFiles, Math.ceil(sorted.length * config.hotspotTopPercent));
  const selected = sorted.slice(0, hotspotCount);

  const hotspots = selected.map((file, index) => ({
    filePath: file.filePath,
    rank: index + 1,
    commitCount: file.commitCount,
    churnTotal: file.churnTotal,
  }));

  const threshold = selected[selected.length - 1]?.commitCount ?? 0;
  return { hotspots, threshold };
};

export const computeRepositoryEvolutionSummary = (
  targetPath: string,
  commits: readonly GitCommitRecord[],
  config: EvolutionComputationConfig,
): RepositoryEvolutionSummary => {
  const authorAliasById =
    config.authorIdentityMode === "likely_merge" ? buildAuthorAliasMap(commits) : new Map<string, string>();
  const fileStats = new Map<string, FileAccumulator>();
  const coChangeByPair = new Map<string, number>();

  const headCommitTimestamp = commits.length === 0 ? null : commits[commits.length - 1]?.authoredAtUnix ?? null;
  const recentWindowStart =
    headCommitTimestamp === null
      ? Number.NEGATIVE_INFINITY
      : headCommitTimestamp - config.recentWindowDays * 24 * 60 * 60;

  let consideredCommits = 0;
  let skippedLargeCommits = 0;

  for (const commit of commits) {
    const uniqueFiles = new Set<string>();

    for (const fileChange of commit.fileChanges) {
      uniqueFiles.add(fileChange.filePath);
      const current = fileStats.get(fileChange.filePath) ?? {
        commitCount: 0,
        recentCommitCount: 0,
        churnAdded: 0,
        churnDeleted: 0,
        authors: new Map<string, number>(),
      };

      current.churnAdded += fileChange.additions;
      current.churnDeleted += fileChange.deletions;
      fileStats.set(fileChange.filePath, current);
    }

    for (const filePath of uniqueFiles) {
      const current = fileStats.get(filePath);
      if (current === undefined) {
        continue;
      }

      current.commitCount += 1;
      if (commit.authoredAtUnix >= recentWindowStart) {
        current.recentCommitCount += 1;
      }

      const effectiveAuthorId = authorAliasById.get(commit.authorId) ?? commit.authorId;
      current.authors.set(effectiveAuthorId, (current.authors.get(effectiveAuthorId) ?? 0) + 1);
    }

    const orderedFiles = [...uniqueFiles].sort((a, b) => a.localeCompare(b));
    if (orderedFiles.length > 1) {
      if (orderedFiles.length <= config.maxFilesPerCommitForCoupling) {
        consideredCommits += 1;
        for (let i = 0; i < orderedFiles.length - 1; i += 1) {
          for (let j = i + 1; j < orderedFiles.length; j += 1) {
            const fileA = orderedFiles[i];
            const fileB = orderedFiles[j];
            if (fileA === undefined || fileB === undefined) {
              continue;
            }

            const key = pairKey(fileA, fileB);
            coChangeByPair.set(key, (coChangeByPair.get(key) ?? 0) + 1);
          }
        }
      } else {
        skippedLargeCommits += 1;
      }
    }
  }

  const files: FileEvolutionMetrics[] = [...fileStats.entries()]
    .map(([filePath, stats]) => {
      const authorDistribution = finalizeAuthorDistribution(stats.authors);
      const topAuthorShare = authorDistribution[0]?.share ?? 0;
      return {
        filePath,
        commitCount: stats.commitCount,
        frequencyPer100Commits: commits.length === 0 ? 0 : round4((stats.commitCount / commits.length) * 100),
        churnAdded: stats.churnAdded,
        churnDeleted: stats.churnDeleted,
        churnTotal: stats.churnAdded + stats.churnDeleted,
        recentCommitCount: stats.recentCommitCount,
        recentVolatility: stats.commitCount === 0 ? 0 : round4(stats.recentCommitCount / stats.commitCount),
        topAuthorShare,
        busFactor: computeBusFactor(authorDistribution, config.busFactorCoverageThreshold),
        authorDistribution,
      };
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  const fileCommitCount = new Map(files.map((file) => [file.filePath, file.commitCount]));
  const coupling = buildCouplingMatrix(
    coChangeByPair,
    fileCommitCount,
    consideredCommits,
    skippedLargeCommits,
    config.maxCouplingPairs,
  );

  const { hotspots, threshold } = selectHotspots(files, config);

  return {
    targetPath,
    available: true,
    files,
    hotspots,
    coupling,
    metrics: {
      totalCommits: commits.length,
      totalFiles: files.length,
      headCommitTimestamp,
      recentWindowDays: config.recentWindowDays,
      hotspotTopPercent: config.hotspotTopPercent,
      hotspotThresholdCommitCount: threshold,
    },
  };
};
