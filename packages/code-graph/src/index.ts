export type GraphNode = {
  id: string;
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type CodeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export const createEmptyGraph = (): CodeGraph => ({
  nodes: [],
  edges: [],
});
