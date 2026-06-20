import type { ExternalAnalysisSummary } from "@codesentinel/core";
import {
  DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  type DependencyMetadataProvider,
  type ExternalAnalysisConfig,
  type WorkspaceDependencyManifest,
} from "../domain/types.js";
import { buildDependencyExposureSummary } from "./dependency-exposure-pipeline.js";
import { prepareDependencyExtraction } from "./prepare-dependency-extraction.js";
import { loadWorkspaceDependencyManifests } from "../infrastructure/workspace-package-manifests.js";

export type AnalyzeDependencyExposureInput = {
  repositoryPath: string;
  config?: Partial<ExternalAnalysisConfig>;
};

export type DependencyExposureProgressEvent =
  | { stage: "package_json_loaded" }
  | { stage: "lockfile_selected"; kind: "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun" }
  | { stage: "lockfile_parsed"; dependencyNodes: number; directDependencies: number }
  | { stage: "metadata_fetch_started"; total: number }
  | { stage: "metadata_fetch_progress"; completed: number; total: number; packageName: string }
  | { stage: "metadata_fetch_completed"; total: number }
  | { stage: "summary_built"; totalDependencies: number; directDependencies: number };

export type WorkspaceDependencyManifestLoader = (
  repositoryPath: string,
) => readonly WorkspaceDependencyManifest[];

const withDefaults = (
  overrides: Partial<ExternalAnalysisConfig> | undefined,
): ExternalAnalysisConfig => ({
  ...DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  ...overrides,
});

export const analyzeDependencyExposure = async (
  input: AnalyzeDependencyExposureInput,
  metadataProvider: DependencyMetadataProvider,
  onProgress?: (event: DependencyExposureProgressEvent) => void,
  loadWorkspaceManifests: WorkspaceDependencyManifestLoader = loadWorkspaceDependencyManifests,
): Promise<ExternalAnalysisSummary> => {
  const config = withDefaults(input.config);

  try {
    const prepared = await prepareDependencyExtraction(input.repositoryPath);
    if (!prepared.available) {
      return {
        targetPath: input.repositoryPath,
        available: false,
        reason: prepared.reason,
      };
    }

    onProgress?.({ stage: "package_json_loaded" });
    onProgress?.({ stage: "lockfile_selected", kind: prepared.lockfileKind });

    const { extraction } = prepared;

    onProgress?.({
      stage: "lockfile_parsed",
      dependencyNodes: extraction.nodes.length,
      directDependencies: extraction.directDependencies.length,
    });
    onProgress?.({ stage: "metadata_fetch_started", total: extraction.nodes.length });
    const summary = await buildDependencyExposureSummary({
      targetPath: input.repositoryPath,
      extraction,
      metadataProvider,
      config,
      workspaceManifests: loadWorkspaceManifests(input.repositoryPath),
      onMetadataProgress: (event) =>
        onProgress?.({
          stage: "metadata_fetch_progress",
          completed: event.completed,
          total: event.total,
          packageName: event.packageName,
        }),
    });
    onProgress?.({ stage: "metadata_fetch_completed", total: extraction.nodes.length });
    if (summary.available) {
      onProgress?.({
        stage: "summary_built",
        totalDependencies: summary.metrics.totalDependencies,
        directDependencies: summary.metrics.directDependencies,
      });
    }

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.includes("unsupported_lockfile_format")) {
      return {
        targetPath: input.repositoryPath,
        available: false,
        reason: "unsupported_lockfile_format",
      };
    }

    return {
      targetPath: input.repositoryPath,
      available: false,
      reason: "invalid_lockfile",
    };
  }
};
