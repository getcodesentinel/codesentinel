import { resolve } from "node:path";

export type AnalyzeTarget = {
  absolutePath: string;
};

export type GraphNode = {
  id: string;
  absolutePath: string;
  relativePath: string;
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type GraphCycle = {
  nodes: readonly string[];
};

export type FileDependency = {
  id: string;
  relativePath: string;
  directDependencies: readonly string[];
  fanIn: number;
  fanOut: number;
  depth: number;
};

export type GraphMetrics = {
  nodeCount: number;
  edgeCount: number;
  cycleCount: number;
  graphDepth: number;
  maxFanIn: number;
  maxFanOut: number;
};

export type GraphAnalysisSummary = {
  targetPath: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  cycles: readonly GraphCycle[];
  files: readonly FileDependency[];
  metrics: GraphMetrics;
};

export const resolveTargetPath = (
  inputPath: string | undefined,
  cwd: string = process.cwd(),
): AnalyzeTarget => {
  const absolutePath = resolve(cwd, inputPath ?? ".");
  return { absolutePath };
};
