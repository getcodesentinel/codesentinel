import type { ExternalAnalysisSummary } from "@codesentinel/core";
import {
  DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  type DependencyMetadataProvider,
  type ExternalAnalysisConfig,
  type LockfileExtraction,
} from "../domain/types.js";
import { buildDependencyExposureSummary } from "./dependency-exposure-pipeline.js";
import { resolveRegistryGraphFromDirectSpecs } from "./resolve-registry-graph.js";

export type AnalyzeDependencyCandidateInput = {
  dependency: string;
  config?: Partial<ExternalAnalysisConfig>;
  maxNodes?: number;
  maxDepth?: number;
};

export type AnalyzeDependencyCandidateResult =
  | {
      available: false;
      reason: "invalid_dependency_spec" | "package_not_found";
      dependency: string;
    }
  | {
      available: true;
      dependency: {
        name: string;
        requested: string | null;
        resolvedVersion: string;
        resolution: "exact" | "tag" | "range" | "latest";
      };
      graph: {
        nodeCount: number;
        truncated: boolean;
        maxNodes: number;
        maxDepth: number;
      };
      assumptions: readonly string[];
      external: ExternalAnalysisSummary;
    };

const DEFAULT_MAX_NODES = 250;
const DEFAULT_MAX_DEPTH = 6;

const withDefaults = (
  overrides: Partial<ExternalAnalysisConfig> | undefined,
): ExternalAnalysisConfig => ({
  ...DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  ...overrides,
});

const parseDependencySpec = (value: string): { name: string; requested: string | null } | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("@")) {
    const splitIndex = trimmed.lastIndexOf("@");
    if (splitIndex <= 0) {
      return { name: trimmed, requested: null };
    }

    const name = trimmed.slice(0, splitIndex);
    const requested = trimmed.slice(splitIndex + 1);
    if (name.length === 0 || requested.length === 0) {
      return null;
    }

    return { name, requested };
  }

  const splitIndex = trimmed.lastIndexOf("@");
  if (splitIndex <= 0) {
    return { name: trimmed, requested: null };
  }

  const name = trimmed.slice(0, splitIndex);
  const requested = trimmed.slice(splitIndex + 1);
  if (name.length === 0 || requested.length === 0) {
    return null;
  }

  return { name, requested };
};

export const analyzeDependencyCandidate = async (
  input: AnalyzeDependencyCandidateInput,
  metadataProvider: DependencyMetadataProvider,
): Promise<AnalyzeDependencyCandidateResult> => {
  const parsed = parseDependencySpec(input.dependency);
  if (parsed === null) {
    return {
      available: false,
      reason: "invalid_dependency_spec",
      dependency: input.dependency,
    };
  }

  const maxNodes = Math.max(1, input.maxNodes ?? DEFAULT_MAX_NODES);
  const maxDepth = Math.max(0, input.maxDepth ?? DEFAULT_MAX_DEPTH);
  const config = withDefaults(input.config);

  const graph = await resolveRegistryGraphFromDirectSpecs(
    [
      {
        name: parsed.name,
        requestedRange: parsed.requested ?? "latest",
        scope: "prod",
      },
    ],
    { maxNodes, maxDepth },
  );

  const direct = graph.directDependencies.find((dependency) => dependency.name === parsed.name);
  if (direct === undefined || graph.nodes.length === 0) {
    return {
      available: false,
      reason: "package_not_found",
      dependency: input.dependency,
    };
  }

  const extraction: LockfileExtraction = {
    kind: "npm",
    directDependencies: [
      {
        name: parsed.name,
        requestedRange: parsed.requested ?? "latest",
        scope: "prod",
      },
    ],
    nodes: graph.nodes,
  };

  const external = await buildDependencyExposureSummary({
    targetPath: `npm:${parsed.name}`,
    extraction,
    metadataProvider,
    config,
  });

  return {
    available: true,
    dependency: {
      name: parsed.name,
      requested: parsed.requested,
      resolvedVersion: direct.resolvedVersion,
      resolution: direct.resolution,
    },
    graph: {
      nodeCount: graph.nodes.length,
      truncated: graph.truncated,
      maxNodes,
      maxDepth,
    },
    assumptions: graph.assumptions,
    external,
  };
};
