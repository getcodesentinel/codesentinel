export type NodeRecord = {
  id: string;
  absolutePath: string;
  relativePath: string;
};

export type EdgeRecord = {
  from: string;
  to: string;
};

export type GraphData = {
  nodes: readonly NodeRecord[];
  edges: readonly EdgeRecord[];
  adjacencyById: ReadonlyMap<string, readonly string[]>;
};

const edgeKey = (from: string, to: string): string => `${from}\u0000${to}`;

export const createGraphData = (
  nodes: readonly NodeRecord[],
  rawEdges: readonly EdgeRecord[],
): GraphData => {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const knownNodeIds = new Set(sortedNodes.map((node) => node.id));

  const uniqueEdgeMap = new Map<string, EdgeRecord>();
  for (const edge of rawEdges) {
    if (edge.from === edge.to) {
      continue;
    }

    if (!knownNodeIds.has(edge.from) || !knownNodeIds.has(edge.to)) {
      continue;
    }

    uniqueEdgeMap.set(edgeKey(edge.from, edge.to), edge);
  }

  const sortedEdges = [...uniqueEdgeMap.values()].sort((a, b) => {
    const fromCompare = a.from.localeCompare(b.from);
    if (fromCompare !== 0) {
      return fromCompare;
    }

    return a.to.localeCompare(b.to);
  });

  const adjacency = new Map<string, string[]>();
  for (const node of sortedNodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of sortedEdges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const adjacencyById = new Map<string, readonly string[]>();
  for (const [nodeId, targets] of adjacency.entries()) {
    adjacencyById.set(nodeId, [...targets]);
  }

  return {
    nodes: sortedNodes,
    edges: sortedEdges,
    adjacencyById,
  };
};
