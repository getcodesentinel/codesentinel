import type { GraphAnalysisSummary } from "@codesentinel/core";
import { createGraphData } from "../domain/graph-model.js";
import { createGraphAnalysisSummary } from "../domain/graph-metrics.js";
import {
  parseTypescriptProject,
  type ParseTypescriptProjectProgressEvent,
} from "../infrastructure/typescript-project.js";
import { discoverWorkspacePackages } from "../infrastructure/workspace-discovery.js";

export type BuildProjectGraphSummaryInput = {
  projectPath: string;
  onProgress?: (event: ParseTypescriptProjectProgressEvent) => void;
};

export const buildProjectGraphSummary = (
  input: BuildProjectGraphSummaryInput,
): GraphAnalysisSummary => {
  const workspaces = discoverWorkspacePackages(input.projectPath);
  const parsedProject = parseTypescriptProject(input.projectPath, input.onProgress, workspaces);
  const graphData = createGraphData(parsedProject.nodes, parsedProject.edges);
  return createGraphAnalysisSummary(input.projectPath, graphData, workspaces);
};
