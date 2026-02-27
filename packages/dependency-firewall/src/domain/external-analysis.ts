import type {
  CentralDependency,
  DependencyExposureRecord,
  DependencyRiskSignal,
  ExternalAnalysisSummary,
} from "@codesentinel/core";
import type {
  DependencyMetadata,
  ExternalAnalysisConfig,
  LockfileExtraction,
  LockedDependencyNode,
} from "./types.js";

const round4 = (value: number): number => Number(value.toFixed(4));

type NormalizedNode = {
  key: string;
  name: string;
  version: string;
  dependencies: readonly string[];
};

const normalizeNodes = (nodes: readonly LockedDependencyNode[]): readonly NormalizedNode[] => {
  const byName = new Map<string, LockedDependencyNode[]>();

  for (const node of nodes) {
    const bucket = byName.get(node.name) ?? [];
    bucket.push(node);
    byName.set(node.name, bucket);
  }

  const normalized: NormalizedNode[] = [];

  for (const [name, candidates] of byName.entries()) {
    if (candidates.length === 0) {
      continue;
    }

    candidates.sort((a, b) => b.version.localeCompare(a.version));
    const selected = candidates[0];
    if (selected === undefined) {
      continue;
    }

    const deps = selected.dependencies
      .map((dep) => {
        const at = dep.lastIndexOf("@");
        return at <= 0 ? dep : dep.slice(0, at);
      })
      .filter((depName) => depName.length > 0)
      .sort((a, b) => a.localeCompare(b));

    normalized.push({
      key: `${name}@${selected.version}`,
      name,
      version: selected.version,
      dependencies: deps,
    });
  }

  return normalized.sort((a, b) => a.name.localeCompare(b.name));
};

const computeDepths = (
  nodeByName: ReadonlyMap<string, NormalizedNode>,
  directNames: ReadonlySet<string>,
): { depthByName: ReadonlyMap<string, number>; maxDepth: number } => {
  const visiting = new Set<string>();
  const depthByName = new Map<string, number>();

  const compute = (name: string): number => {
    const known = depthByName.get(name);
    if (known !== undefined) {
      return known;
    }

    if (visiting.has(name)) {
      return 0;
    }

    visiting.add(name);

    const node = nodeByName.get(name);
    if (node === undefined) {
      visiting.delete(name);
      depthByName.set(name, 0);
      return 0;
    }

    let maxChildDepth = 0;
    for (const dependencyName of node.dependencies) {
      const childDepth = compute(dependencyName);
      if (childDepth > maxChildDepth) {
        maxChildDepth = childDepth;
      }
    }

    visiting.delete(name);
    const ownDepth = directNames.has(name) ? 0 : maxChildDepth + 1;
    depthByName.set(name, ownDepth);
    return ownDepth;
  };

  for (const name of nodeByName.keys()) {
    compute(name);
  }

  let maxDepth = 0;
  for (const depth of depthByName.values()) {
    if (depth > maxDepth) {
      maxDepth = depth;
    }
  }

  return { depthByName, maxDepth };
};

const rankCentrality = (
  nodes: readonly NormalizedNode[],
  dependentsByName: ReadonlyMap<string, number>,
  directNames: ReadonlySet<string>,
  topN: number,
): readonly CentralDependency[] =>
  [...nodes]
    .map((node) => ({
      name: node.name,
      dependents: dependentsByName.get(node.name) ?? 0,
      fanOut: node.dependencies.length,
      direct: directNames.has(node.name),
    }))
    .sort(
      (a, b) =>
        b.dependents - a.dependents ||
        b.fanOut - a.fanOut ||
        a.name.localeCompare(b.name),
    )
    .slice(0, topN);

const canPropagateSignal = (signal: DependencyRiskSignal): boolean =>
  signal === "abandoned" ||
  signal === "high_centrality" ||
  signal === "deep_chain" ||
  signal === "high_fanout";

const collectTransitiveDependencies = (
  rootName: string,
  nodeByName: ReadonlyMap<string, NormalizedNode>,
): readonly string[] => {
  const seen = new Set<string>();
  const stack = [...(nodeByName.get(rootName)?.dependencies ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current) || current === rootName) {
      continue;
    }

    seen.add(current);
    const currentNode = nodeByName.get(current);
    if (currentNode === undefined) {
      continue;
    }

    for (const next of currentNode.dependencies) {
      if (!seen.has(next)) {
        stack.push(next);
      }
    }
  }

  return [...seen].sort((a, b) => a.localeCompare(b));
};

export const buildExternalAnalysisSummary = (
  targetPath: string,
  extraction: LockfileExtraction,
  metadataByKey: ReadonlyMap<string, DependencyMetadata | null>,
  config: ExternalAnalysisConfig,
): ExternalAnalysisSummary => {
  const nodes = normalizeNodes(extraction.nodes);
  const directNames = new Set(extraction.directDependencies.map((dep) => dep.name));
  const directSpecByName = new Map(extraction.directDependencies.map((dep) => [dep.name, dep.requestedRange]));

  const nodeByName = new Map(nodes.map((node) => [node.name, node]));
  const dependentsByName = new Map<string, number>();

  for (const node of nodes) {
    dependentsByName.set(node.name, dependentsByName.get(node.name) ?? 0);
  }

  for (const node of nodes) {
    for (const dependencyName of node.dependencies) {
      if (!nodeByName.has(dependencyName)) {
        continue;
      }

      dependentsByName.set(dependencyName, (dependentsByName.get(dependencyName) ?? 0) + 1);
    }
  }

  const { depthByName, maxDepth } = computeDepths(nodeByName, directNames);
  const centralityRanking = rankCentrality(nodes, dependentsByName, directNames, config.centralityTopN);

  const topCentralNames = new Set(
    centralityRanking
      .slice(0, Math.max(1, Math.ceil(centralityRanking.length * 0.25)))
      .map((entry) => entry.name),
  );

  const allDependencies: DependencyExposureRecord[] = [];
  let metadataAvailableCount = 0;

  for (const node of nodes) {
    const metadata = metadataByKey.get(node.key) ?? null;
    if (metadata !== null) {
      metadataAvailableCount += 1;
    }

    const dependencyDepth = depthByName.get(node.name) ?? 0;
    const dependents = dependentsByName.get(node.name) ?? 0;

    const riskSignals: DependencyRiskSignal[] = [];

    if ((metadata?.maintainerCount ?? 0) === 1) {
      riskSignals.push("single_maintainer");
    }

    if ((metadata?.daysSinceLastRelease ?? 0) >= config.abandonedDaysThreshold) {
      riskSignals.push("abandoned");
    }

    if (topCentralNames.has(node.name) && dependents > 0) {
      riskSignals.push("high_centrality");
    }

    if (dependencyDepth >= config.deepChainThreshold) {
      riskSignals.push("deep_chain");
    }

    if (node.dependencies.length >= config.fanOutHighThreshold) {
      riskSignals.push("high_fanout");
    }

    if (metadata === null) {
      riskSignals.push("metadata_unavailable");
    }

    allDependencies.push({
      name: node.name,
      direct: directNames.has(node.name),
      requestedRange: directSpecByName.get(node.name) ?? null,
      resolvedVersion: node.version,
      transitiveDependencies: [],
      weeklyDownloads: metadata?.weeklyDownloads ?? null,
      dependencyDepth,
      fanOut: node.dependencies.length,
      dependents,
      maintainerCount: metadata?.maintainerCount ?? null,
      releaseFrequencyDays: metadata?.releaseFrequencyDays ?? null,
      daysSinceLastRelease: metadata?.daysSinceLastRelease ?? null,
      repositoryActivity30d: metadata?.repositoryActivity30d ?? null,
      busFactor: metadata?.busFactor ?? null,
      ownRiskSignals: [...riskSignals].sort((a, b) => a.localeCompare(b)),
      inheritedRiskSignals: [],
      riskSignals,
    });
  }

  allDependencies.sort((a, b) => a.name.localeCompare(b.name));

  const allByName = new Map(allDependencies.map((dep) => [dep.name, dep]));

  const dependencies: DependencyExposureRecord[] = allDependencies
    .filter((dep) => dep.direct)
    .map((dep) => {
      const transitiveDependencies = collectTransitiveDependencies(dep.name, nodeByName);
      const inheritedSignals = new Set<DependencyRiskSignal>();
      const allSignals = new Set(dep.ownRiskSignals);

      for (const transitiveName of transitiveDependencies) {
        const transitive = allByName.get(transitiveName);
        if (transitive === undefined) {
          continue;
        }

        for (const signal of transitive.riskSignals) {
          if (canPropagateSignal(signal)) {
            inheritedSignals.add(signal);
            allSignals.add(signal);
          }
        }
      }

      return {
        ...dep,
        transitiveDependencies,
        inheritedRiskSignals: [...inheritedSignals].sort((a, b) => a.localeCompare(b)),
        riskSignals: [...allSignals].sort((a, b) => a.localeCompare(b)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const highRiskDependencies = dependencies
    .filter(
      (dep) =>
        dep.ownRiskSignals.includes("abandoned") ||
        dep.ownRiskSignals.includes("single_maintainer") ||
        dep.ownRiskSignals.filter((signal) => signal !== "metadata_unavailable").length >= 2,
    )
    .sort(
      (a, b) =>
        b.ownRiskSignals.length - a.ownRiskSignals.length || a.name.localeCompare(b.name),
    )
    .slice(0, config.maxHighRiskDependencies)
    .map((dep) => dep.name);

  const transitiveExposureDependencies = dependencies
    .filter((dep) => dep.inheritedRiskSignals.length > 0)
    .sort(
      (a, b) =>
        b.inheritedRiskSignals.length - a.inheritedRiskSignals.length || a.name.localeCompare(b.name),
    )
    .map((dep) => dep.name);

  const singleMaintainerDependencies = dependencies
    .filter((dep) => dep.ownRiskSignals.includes("single_maintainer"))
    .map((dep) => dep.name)
    .sort((a, b) => a.localeCompare(b));

  const abandonedDependencies = dependencies
    .filter((dep) => dep.ownRiskSignals.includes("abandoned"))
    .map((dep) => dep.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    targetPath,
    available: true,
    metrics: {
      totalDependencies: allDependencies.length,
      directDependencies: dependencies.length,
      transitiveDependencies: allDependencies.length - dependencies.length,
      dependencyDepth: maxDepth,
      lockfileKind: extraction.kind,
      metadataCoverage: allDependencies.length === 0 ? 0 : round4(metadataAvailableCount / allDependencies.length),
    },
    dependencies,
    highRiskDependencies,
    transitiveExposureDependencies,
    singleMaintainerDependencies,
    abandonedDependencies,
    centralityRanking,
  };
};
