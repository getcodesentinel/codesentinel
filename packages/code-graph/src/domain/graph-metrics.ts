import type {
  FileDependency,
  GraphAnalysisSummary,
  GraphCycle,
  GraphMetrics,
  WorkspacePackage,
  WorkspaceStructuralSummary,
} from "@codesentinel/core";
import type { GraphData } from "./graph-model.js";
import { runTarjanScc } from "./tarjan.js";

type DepthComputation = {
  depthByNodeId: ReadonlyMap<string, number>;
  graphDepth: number;
  cycles: readonly GraphCycle[];
};

const hasSelfLoop = (
  nodeId: string,
  adjacencyById: ReadonlyMap<string, readonly string[]>,
): boolean => {
  const targets = adjacencyById.get(nodeId) ?? [];
  return targets.includes(nodeId);
};

const computeCyclesAndDepth = (graph: GraphData): DepthComputation => {
  const { components } = runTarjanScc(graph.adjacencyById);

  const cycles: GraphCycle[] = [];
  const componentByNodeId = new Map<string, number>();
  components.forEach((component, index) => {
    for (const nodeId of component) {
      componentByNodeId.set(nodeId, index);
    }

    if (component.length > 1) {
      cycles.push({ nodes: [...component] });
      return;
    }

    const onlyNode = component[0];
    if (onlyNode !== undefined && hasSelfLoop(onlyNode, graph.adjacencyById)) {
      cycles.push({ nodes: [...component] });
    }
  });

  const dagOutgoing = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();

  for (let i = 0; i < components.length; i += 1) {
    dagOutgoing.set(i, new Set());
    inDegree.set(i, 0);
  }

  for (const edge of graph.edges) {
    const fromComponent = componentByNodeId.get(edge.from);
    const toComponent = componentByNodeId.get(edge.to);

    if (fromComponent === undefined || toComponent === undefined || fromComponent === toComponent) {
      continue;
    }

    const outgoing = dagOutgoing.get(fromComponent);
    if (outgoing?.has(toComponent) === true) {
      continue;
    }

    outgoing?.add(toComponent);
    inDegree.set(toComponent, (inDegree.get(toComponent) ?? 0) + 1);
  }

  const queue: number[] = [];
  const depthByComponent = new Map<number, number>();

  for (let i = 0; i < components.length; i += 1) {
    if ((inDegree.get(i) ?? 0) === 0) {
      queue.push(i);
      depthByComponent.set(i, 0);
    }
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const componentId = queue[cursor];
    cursor += 1;

    if (componentId === undefined) {
      continue;
    }

    const currentDepth = depthByComponent.get(componentId) ?? 0;
    const outgoing = dagOutgoing.get(componentId) ?? new Set<number>();

    for (const nextComponent of outgoing) {
      const nextDepth = depthByComponent.get(nextComponent) ?? 0;
      if (currentDepth + 1 > nextDepth) {
        depthByComponent.set(nextComponent, currentDepth + 1);
      }

      const remainingIncoming = (inDegree.get(nextComponent) ?? 0) - 1;
      inDegree.set(nextComponent, remainingIncoming);
      if (remainingIncoming === 0) {
        queue.push(nextComponent);
      }
    }
  }

  const depthByNodeId = new Map<string, number>();
  let graphDepth = 0;

  components.forEach((component, componentId) => {
    const componentDepth = depthByComponent.get(componentId) ?? 0;
    if (componentDepth > graphDepth) {
      graphDepth = componentDepth;
    }

    for (const nodeId of component) {
      depthByNodeId.set(nodeId, componentDepth);
    }
  });

  cycles.sort((a, b) => {
    const firstA = a.nodes[0] ?? "";
    const firstB = b.nodes[0] ?? "";
    return firstA.localeCompare(firstB);
  });

  return {
    depthByNodeId,
    graphDepth,
    cycles,
  };
};

const findWorkspaceForFile = (
  filePath: string,
  workspaces: readonly WorkspacePackage[],
): WorkspacePackage | null => {
  let match: WorkspacePackage | null = null;
  for (const workspace of workspaces) {
    if (filePath === workspace.path || filePath.startsWith(`${workspace.path}/`)) {
      if (match === null || workspace.path.length > match.path.length) {
        match = workspace;
      }
    }
  }

  return match;
};

const createWorkspaceSummaries = (
  graph: GraphData,
  workspaces: readonly WorkspacePackage[],
): readonly WorkspaceStructuralSummary[] => {
  if (workspaces.length === 0) {
    return [];
  }

  const workspaceByFile = new Map<string, WorkspacePackage>();
  const fileCountByWorkspacePath = new Map<string, number>();
  const internalEdgesByWorkspacePath = new Map<string, number>();
  const incomingEdgesByWorkspacePath = new Map<string, number>();
  const outgoingEdgesByWorkspacePath = new Map<string, number>();

  for (const workspace of workspaces) {
    fileCountByWorkspacePath.set(workspace.path, 0);
    internalEdgesByWorkspacePath.set(workspace.path, 0);
    incomingEdgesByWorkspacePath.set(workspace.path, 0);
    outgoingEdgesByWorkspacePath.set(workspace.path, 0);
  }

  for (const node of graph.nodes) {
    const workspace = findWorkspaceForFile(node.id, workspaces);
    if (workspace === null) {
      continue;
    }

    workspaceByFile.set(node.id, workspace);
    fileCountByWorkspacePath.set(
      workspace.path,
      (fileCountByWorkspacePath.get(workspace.path) ?? 0) + 1,
    );
  }

  for (const edge of graph.edges) {
    const fromWorkspace = workspaceByFile.get(edge.from) ?? null;
    const toWorkspace = workspaceByFile.get(edge.to) ?? null;

    if (fromWorkspace === null && toWorkspace === null) {
      continue;
    }

    if (fromWorkspace?.path === toWorkspace?.path && fromWorkspace !== null) {
      internalEdgesByWorkspacePath.set(
        fromWorkspace.path,
        (internalEdgesByWorkspacePath.get(fromWorkspace.path) ?? 0) + 1,
      );
      continue;
    }

    if (fromWorkspace !== null) {
      outgoingEdgesByWorkspacePath.set(
        fromWorkspace.path,
        (outgoingEdgesByWorkspacePath.get(fromWorkspace.path) ?? 0) + 1,
      );
    }

    if (toWorkspace !== null) {
      incomingEdgesByWorkspacePath.set(
        toWorkspace.path,
        (incomingEdgesByWorkspacePath.get(toWorkspace.path) ?? 0) + 1,
      );
    }
  }

  return workspaces.map((workspace) => ({
    ...workspace,
    fileCount: fileCountByWorkspacePath.get(workspace.path) ?? 0,
    internalEdgeCount: internalEdgesByWorkspacePath.get(workspace.path) ?? 0,
    incomingEdgeCount: incomingEdgesByWorkspacePath.get(workspace.path) ?? 0,
    outgoingEdgeCount: outgoingEdgesByWorkspacePath.get(workspace.path) ?? 0,
  }));
};

export const createGraphAnalysisSummary = (
  targetPath: string,
  graph: GraphData,
  workspaces: readonly WorkspacePackage[] = [],
): GraphAnalysisSummary => {
  const fanInById = new Map<string, number>();
  const fanOutById = new Map<string, number>();

  for (const node of graph.nodes) {
    fanInById.set(node.id, 0);
    fanOutById.set(node.id, graph.adjacencyById.get(node.id)?.length ?? 0);
  }

  for (const edge of graph.edges) {
    fanInById.set(edge.to, (fanInById.get(edge.to) ?? 0) + 1);
  }

  const { cycles, depthByNodeId, graphDepth } = computeCyclesAndDepth(graph);

  let maxFanIn = 0;
  let maxFanOut = 0;

  const files: FileDependency[] = graph.nodes.map((node) => {
    const fanIn = fanInById.get(node.id) ?? 0;
    const fanOut = fanOutById.get(node.id) ?? 0;

    if (fanIn > maxFanIn) {
      maxFanIn = fanIn;
    }

    if (fanOut > maxFanOut) {
      maxFanOut = fanOut;
    }

    return {
      id: node.id,
      relativePath: node.relativePath,
      directDependencies: graph.adjacencyById.get(node.id) ?? [],
      fanIn,
      fanOut,
      depth: depthByNodeId.get(node.id) ?? 0,
    };
  });

  const metrics: GraphMetrics = {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    cycleCount: cycles.length,
    graphDepth,
    maxFanIn,
    maxFanOut,
  };

  return {
    targetPath,
    nodes: graph.nodes,
    edges: graph.edges,
    cycles,
    files,
    metrics,
    ...(workspaces.length === 0 ? {} : { workspaces: createWorkspaceSummaries(graph, workspaces) }),
  };
};
