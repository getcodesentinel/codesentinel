import type { ExternalAnalysisSummary } from "@codesentinel/core";
import { buildExternalAnalysisSummary } from "../domain/external-analysis.js";
import type {
  DependencyMetadata,
  DependencyMetadataProvider,
  ExternalAnalysisConfig,
  LockfileExtraction,
  WorkspaceDependencyManifest,
} from "../domain/types.js";
import { collectDependencyMetadata } from "./collect-dependency-metadata.js";

export type DependencyExposureMetadataProgressEvent = {
  completed: number;
  total: number;
  packageName: string;
};

export type BuildDependencyExposureSummaryInput = {
  targetPath: string;
  extraction: LockfileExtraction;
  metadataProvider: DependencyMetadataProvider;
  config: ExternalAnalysisConfig;
  workspaceManifests?: readonly WorkspaceDependencyManifest[];
  onMetadataProgress?: (event: DependencyExposureMetadataProgressEvent) => void;
};

export const buildDependencyExposureSummary = async (
  input: BuildDependencyExposureSummaryInput,
): Promise<ExternalAnalysisSummary> => {
  const metadataEntries = await collectDependencyMetadata(
    input.extraction,
    input.metadataProvider,
    input.config.metadataRequestConcurrency,
    input.onMetadataProgress,
  );

  const metadataByKey = new Map<string, DependencyMetadata | null>();
  for (const entry of metadataEntries) {
    metadataByKey.set(entry.key, entry.metadata);
  }

  return buildExternalAnalysisSummary(
    input.targetPath,
    input.extraction,
    metadataByKey,
    input.config,
    input.workspaceManifests ?? [],
  );
};
