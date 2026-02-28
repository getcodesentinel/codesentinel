import type { ExternalAnalysisSummary } from "@codesentinel/core";
import {
  analyzeDependencyExposure,
  type DependencyExposureProgressEvent,
  type AnalyzeDependencyExposureInput,
} from "./application/analyze-dependency-exposure.js";
import {
  analyzeDependencyCandidate,
  type AnalyzeDependencyCandidateInput,
  type AnalyzeDependencyCandidateResult,
} from "./application/analyze-dependency-candidate.js";
import { NpmRegistryMetadataProvider } from "./infrastructure/npm-registry-metadata-provider.js";
import { NoopMetadataProvider } from "./infrastructure/noop-metadata-provider.js";

export type { AnalyzeDependencyExposureInput } from "./application/analyze-dependency-exposure.js";
export type { DependencyExposureProgressEvent } from "./application/analyze-dependency-exposure.js";
export type {
  AnalyzeDependencyCandidateInput,
  AnalyzeDependencyCandidateResult,
} from "./application/analyze-dependency-candidate.js";

export const analyzeDependencyExposureFromProject = async (
  input: AnalyzeDependencyExposureInput,
  onProgress?: (event: DependencyExposureProgressEvent) => void,
): Promise<ExternalAnalysisSummary> => {
  const metadataProvider =
    process.env["CODESENTINEL_EXTERNAL_METADATA"] === "none"
      ? new NoopMetadataProvider()
      : new NpmRegistryMetadataProvider();

  return analyzeDependencyExposure(input, metadataProvider, onProgress);
};

export const analyzeDependencyCandidateFromRegistry = async (
  input: AnalyzeDependencyCandidateInput,
): Promise<AnalyzeDependencyCandidateResult> => {
  const metadataProvider =
    process.env["CODESENTINEL_EXTERNAL_METADATA"] === "none"
      ? new NoopMetadataProvider()
      : new NpmRegistryMetadataProvider();

  return analyzeDependencyCandidate(input, metadataProvider);
};
