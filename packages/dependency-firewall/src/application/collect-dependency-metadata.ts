import type { LockfileExtraction, DependencyMetadataProvider } from "../domain/types.js";
import { mapWithConcurrency } from "./map-with-concurrency.js";

type MetadataEntry = {
  key: string;
  metadata: Awaited<ReturnType<DependencyMetadataProvider["getMetadata"]>>;
};

type MetadataProgressEvent = {
  completed: number;
  total: number;
  packageName: string;
};

export const collectDependencyMetadata = async (
  extraction: LockfileExtraction,
  metadataProvider: DependencyMetadataProvider,
  concurrency: number,
  onProgress?: (event: MetadataProgressEvent) => void,
): Promise<readonly MetadataEntry[]> => {
  const directNames = new Set(extraction.directDependencies.map((dependency) => dependency.name));
  let completed = 0;

  return mapWithConcurrency(extraction.nodes, concurrency, async (node) => {
    const result = {
      key: `${node.name}@${node.version}`,
      metadata: await metadataProvider.getMetadata(node.name, node.version, {
        directDependency: directNames.has(node.name),
      }),
    };
    completed += 1;
    onProgress?.({
      completed,
      total: extraction.nodes.length,
      packageName: node.name,
    });
    return result;
  });
};
