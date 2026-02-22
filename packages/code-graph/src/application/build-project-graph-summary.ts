import type { GraphAnalysisSummary } from "@codesentinel/core";
import { createGraphData } from "../domain/graph-model.ts";
import { createGraphAnalysisSummary } from "../domain/graph-metrics.ts";
import { parseTypescriptProject } from "../infrastructure/typescript-project.ts";

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
