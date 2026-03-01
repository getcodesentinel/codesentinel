import type { CodeSentinelSnapshot, SnapshotDiff } from "./domain.js";
import { round4 } from "./domain.js";

type ScoreEntry = { target: string; before: number; after: number; delta: number };

const diffSets = (
  current: readonly string[],
  baseline: readonly string[],
): { added: readonly string[]; removed: readonly string[] } => {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);

  const added = [...currentSet].filter((item) => !baselineSet.has(item)).sort((a, b) => a.localeCompare(b));
  const removed = [...baselineSet].filter((item) => !currentSet.has(item)).sort((a, b) => a.localeCompare(b));

  return { added, removed };
};

const diffScoreMap = (
  current: ReadonlyMap<string, number>,
  baseline: ReadonlyMap<string, number>,
): readonly ScoreEntry[] => {
  const keys = [...new Set([...current.keys(), ...baseline.keys()])].sort((a, b) => a.localeCompare(b));

  return keys
    .map((key) => {
      const before = baseline.get(key) ?? 0;
      const after = current.get(key) ?? 0;
      const delta = round4(after - before);
      return {
        target: key,
        before: round4(before),
        after: round4(after),
        delta,
      };
    })
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.target.localeCompare(b.target));
};

const cycleKey = (nodes: readonly string[]): string => [...nodes].sort((a, b) => a.localeCompare(b)).join(" -> ");

export const compareSnapshots = (
  current: CodeSentinelSnapshot,
  baseline: CodeSentinelSnapshot,
): SnapshotDiff => {
  const currentFileScores = new Map(
    current.analysis.risk.fileScores.map((item) => [item.file, item.score]),
  );
  const baselineFileScores = new Map(
    baseline.analysis.risk.fileScores.map((item) => [item.file, item.score]),
  );

  const currentModuleScores = new Map(
    current.analysis.risk.moduleScores.map((item) => [item.module, item.score]),
  );
  const baselineModuleScores = new Map(
    baseline.analysis.risk.moduleScores.map((item) => [item.module, item.score]),
  );

  const currentHotspots = current.analysis.risk.hotspots.slice(0, 10).map((item) => item.file);
  const baselineHotspots = baseline.analysis.risk.hotspots.slice(0, 10).map((item) => item.file);

  const currentCycles = current.analysis.structural.cycles.map((cycle) => cycleKey(cycle.nodes));
  const baselineCycles = baseline.analysis.structural.cycles.map((cycle) => cycleKey(cycle.nodes));

  const currentExternal = current.analysis.external.available
    ? current.analysis.external
    : {
        highRiskDependencies: [] as string[],
        singleMaintainerDependencies: [] as string[],
        abandonedDependencies: [] as string[],
      };
  const baselineExternal = baseline.analysis.external.available
    ? baseline.analysis.external
    : {
        highRiskDependencies: [] as string[],
        singleMaintainerDependencies: [] as string[],
        abandonedDependencies: [] as string[],
      };

  const highRisk = diffSets(currentExternal.highRiskDependencies, baselineExternal.highRiskDependencies);
  const singleMaintainer = diffSets(
    currentExternal.singleMaintainerDependencies,
    baselineExternal.singleMaintainerDependencies,
  );
  const abandoned = diffSets(currentExternal.abandonedDependencies, baselineExternal.abandonedDependencies);

  const hotspots = diffSets(currentHotspots, baselineHotspots);
  const cycles = diffSets(currentCycles, baselineCycles);

  return {
    repositoryScoreDelta: round4(current.analysis.risk.repositoryScore - baseline.analysis.risk.repositoryScore),
    normalizedScoreDelta: round4(current.analysis.risk.normalizedScore - baseline.analysis.risk.normalizedScore),
    fileRiskChanges: diffScoreMap(currentFileScores, baselineFileScores),
    moduleRiskChanges: diffScoreMap(currentModuleScores, baselineModuleScores),
    newHotspots: hotspots.added,
    resolvedHotspots: hotspots.removed,
    newCycles: cycles.added,
    resolvedCycles: cycles.removed,
    externalChanges: {
      highRiskAdded: highRisk.added,
      highRiskRemoved: highRisk.removed,
      singleMaintainerAdded: singleMaintainer.added,
      singleMaintainerRemoved: singleMaintainer.removed,
      abandonedAdded: abandoned.added,
      abandonedRemoved: abandoned.removed,
    },
  };
};
