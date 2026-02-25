import type { DirectDependencySpec, LockfileExtraction, LockedDependencyNode } from "../domain/types.js";

const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, "");

const parseVersionSelector = (selector: string): string | null => {
  const npmIndex = selector.lastIndexOf("@npm:");
  if (npmIndex >= 0) {
    return selector.slice(npmIndex + 5);
  }

  const lastAt = selector.lastIndexOf("@");
  if (lastAt <= 0) {
    return null;
  }

  return selector.slice(lastAt + 1);
};

export const parseYarnLock = (raw: string, directSpecs: readonly DirectDependencySpec[]): LockfileExtraction => {
  const lines = raw.split("\n");
  const nodes: LockedDependencyNode[] = [];

  let selectors: string[] = [];
  let version: string | null = null;
  let readingDependencies = false;
  let dependencies: string[] = [];

  const flushEntry = (): void => {
    if (selectors.length === 0 || version === null) {
      selectors = [];
      version = null;
      dependencies = [];
      readingDependencies = false;
      return;
    }

    for (const selector of selectors) {
      const parsedVersion = parseVersionSelector(selector);
      const at = selector.lastIndexOf("@");
      const name = at <= 0 ? selector : selector.slice(0, at);
      if (name.length === 0) {
        continue;
      }

      nodes.push({
        name,
        version,
        dependencies: [...dependencies].sort((a, b) => a.localeCompare(b)),
      });

      if (parsedVersion !== null) {
        nodes.push({
          name,
          version: parsedVersion,
          dependencies: [...dependencies].sort((a, b) => a.localeCompare(b)),
        });
      }
    }

    selectors = [];
    version = null;
    dependencies = [];
    readingDependencies = false;
  };

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    if (!line.startsWith(" ") && line.endsWith(":")) {
      flushEntry();
      const keyText = line.slice(0, -1);
      selectors = keyText
        .split(",")
        .map((part) => stripQuotes(part.trim()))
        .filter((part) => part.length > 0);
      continue;
    }

    if (line.match(/^\s{2}version\s+/) !== null) {
      const value = line.replace(/^\s{2}version\s+/, "").trim();
      version = stripQuotes(value);
      readingDependencies = false;
      continue;
    }

    if (line.match(/^\s{2}dependencies:\s*$/) !== null) {
      readingDependencies = true;
      continue;
    }

    if (readingDependencies && line.match(/^\s{4}[^\s].+$/) !== null) {
      const depLine = line.trim();
      const firstSpace = depLine.indexOf(" ");
      if (firstSpace <= 0) {
        continue;
      }

      const depName = stripQuotes(depLine.slice(0, firstSpace));
      const depRef = stripQuotes(depLine.slice(firstSpace + 1).trim());
      const depVersion = parseVersionSelector(depRef) ?? depRef;
      dependencies.push(`${depName}@${depVersion}`);
      continue;
    }

    readingDependencies = false;
  }

  flushEntry();

  const deduped = new Map<string, LockedDependencyNode>();
  for (const node of nodes) {
    const key = `${node.name}@${node.version}`;
    if (!deduped.has(key)) {
      deduped.set(key, node);
    }
  }

  return {
    kind: "yarn",
    directDependencies: directSpecs,
    nodes: [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
  };
};
