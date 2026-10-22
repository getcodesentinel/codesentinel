import type { GraphAnalysisSummary } from "@codesentinel/core";
import { comparePaths } from "./compare.js";

export type GraphIndex = {
  fanInInternal(filePath: string): number;
  fanInExternal(filePath: string): number;
  neighbours(filePath: string): readonly string[];
  importsTo(from: string, to: string): boolean;
};

const createEmptyGraphIndex = (): GraphIndex => {
  const empty: readonly string[] = [];
  return {
    fanInInternal: () => 0,
    fanInExternal: () => 0,
    neighbours: () => empty,
    importsTo: () => false,
  };
};

const edgeKey = (from: string, to: string): string => `${from}\u0000${to}`;

export const createGraphIndex = (
  graph: GraphAnalysisSummary | null | undefined,
  universe: readonly string[],
): GraphIndex => {
  if (graph === null || graph === undefined) return createEmptyGraphIndex();

  const pathById = new Map<string, string>();
  for (const node of graph.nodes) {
    const existing = pathById.get(node.id);
    if (existing === undefined || comparePaths(node.relativePath, existing) < 0) {
      pathById.set(node.id, node.relativePath);
    }
  }

  const universeSet = new Set(universe);
  const internalFanIn = new Map<string, number>();
  const externalFanIn = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const edges = new Set<string>();

  const addAdjacency = (from: string, to: string): void => {
    const fromNeighbours = adjacency.get(from);
    if (fromNeighbours === undefined) {
      adjacency.set(from, new Set([to]));
    } else {
      fromNeighbours.add(to);
    }
  };

  for (const edge of graph.edges) {
    const from = pathById.get(edge.from);
    const to = pathById.get(edge.to);
    if (from === undefined || to === undefined) continue;

    edges.add(edgeKey(from, to));
    addAdjacency(from, to);
    addAdjacency(to, from);

    if (universeSet.has(from)) {
      internalFanIn.set(to, (internalFanIn.get(to) ?? 0) + 1);
    } else {
      externalFanIn.set(to, (externalFanIn.get(to) ?? 0) + 1);
    }
  }

  return {
    fanInInternal: (filePath) => internalFanIn.get(filePath) ?? 0,
    fanInExternal: (filePath) => externalFanIn.get(filePath) ?? 0,
    neighbours: (filePath) => {
      const candidates = adjacency.get(filePath);
      if (candidates === undefined) return [];
      return [...candidates].filter((candidate) => universeSet.has(candidate)).sort(comparePaths);
    },
    importsTo: (from, to) => edges.has(edgeKey(from, to)),
  };
};
