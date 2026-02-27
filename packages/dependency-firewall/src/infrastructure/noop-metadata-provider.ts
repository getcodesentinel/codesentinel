import type { DependencyMetadata, DependencyMetadataProvider } from "../domain/types.js";

export class NoopMetadataProvider implements DependencyMetadataProvider {
  async getMetadata(
    _name: string,
    _version: string,
    _context: { directDependency: boolean },
  ): Promise<DependencyMetadata | null> {
    return null;
  }
}
