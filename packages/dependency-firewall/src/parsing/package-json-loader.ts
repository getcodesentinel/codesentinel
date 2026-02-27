import type { DirectDependencySpec } from "../domain/types.js";

type ParsedPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export const parsePackageJson = (raw: string): readonly DirectDependencySpec[] => {
  const parsed = JSON.parse(raw) as ParsedPackageJson;
  const merged = new Map<string, DirectDependencySpec>();

  const addBlock = (
    block: Record<string, string> | undefined,
    scope: "prod" | "dev",
  ): void => {
    if (block === undefined) {
      return;
    }

    for (const [name, versionRange] of Object.entries(block)) {
      const existing = merged.get(name);
      // Production scope wins when the same package appears in both scopes.
      if (existing?.scope === "prod" && scope === "dev") {
        continue;
      }

      merged.set(name, { name, requestedRange: versionRange, scope });
    }
  };

  addBlock(parsed.dependencies, "prod");
  addBlock(parsed.optionalDependencies, "prod");
  addBlock(parsed.peerDependencies, "prod");
  addBlock(parsed.devDependencies, "dev");

  return [...merged.values()]
    .sort((a, b) => a.name.localeCompare(b.name));
};
