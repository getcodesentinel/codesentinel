import type { GraphAnalysisSummary } from "@codesentinel/core";
import { createGraphData } from "../domain/graph-model.js";
import { createGraphAnalysisSummary } from "../domain/graph-metrics.js";
import { parseTypescriptProject } from "../infrastructure/typescript-project.js";

export type BuildProjectGraphSummaryInput = {
  projectPath: string;
};

export const buildProjectGraphSummary = (
  input: BuildProjectGraphSummaryInput,
): GraphAnalysisSummary => {
  const parsedProject = parseTypescriptProject(input.projectPath);
  const graphData = createGraphData(parsedProject.nodes, parsedProject.edges);
  return createGraphAnalysisSummary(input.projectPath, graphData);
};
