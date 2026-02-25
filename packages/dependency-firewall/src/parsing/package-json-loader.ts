import type { DirectDependencySpec } from "../domain/types.js";

type ParsedPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export const parsePackageJson = (raw: string): readonly DirectDependencySpec[] => {
  const parsed = JSON.parse(raw) as ParsedPackageJson;
  const merged = new Map<string, string>();

  for (const block of [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.optionalDependencies,
    parsed.peerDependencies,
  ]) {
    if (block === undefined) {
      continue;
    }

    for (const [name, versionRange] of Object.entries(block)) {
      merged.set(name, versionRange);
    }
  }

  return [...merged.entries()]
    .map(([name, requestedRange]) => ({ name, requestedRange }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
