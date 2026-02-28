import type { ExternalAnalysisSummary } from "@codesentinel/core";
import { buildExternalAnalysisSummary } from "../domain/external-analysis.js";
import {
  DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  type DependencyMetadataProvider,
  type ExternalAnalysisConfig,
  type LockfileExtraction,
  type LockedDependencyNode,
} from "../domain/types.js";
import { fetchJsonWithRetry } from "../infrastructure/fetch-json-with-retry.js";

type NpmPackageManifest = {
  dependencies?: Record<string, string>;
};

type NpmPackument = {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, NpmPackageManifest>;
};

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (string | number)[];
};

type ParsedDependencySpec = {
  name: string;
  requested: string | null;
};

type ResolvedVersion = {
  version: string;
  resolution: "exact" | "tag" | "range" | "latest";
  fallbackUsed: boolean;
};

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

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_NODES = 250;
const DEFAULT_MAX_DEPTH = 6;

const withDefaults = (overrides: Partial<ExternalAnalysisConfig> | undefined): ExternalAnalysisConfig => ({
  ...DEFAULT_EXTERNAL_ANALYSIS_CONFIG,
  ...overrides,
});

const parseDependencySpec = (value: string): ParsedDependencySpec | null => {
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

const fetchPackument = async (name: string): Promise<NpmPackument | null> => {
  const encodedName = encodeURIComponent(name);
  try {
    return await fetchJsonWithRetry<NpmPackument>(`https://registry.npmjs.org/${encodedName}`, {
      retries: MAX_RETRIES,
      baseDelayMs: RETRY_BASE_DELAY_MS,
    });
  } catch {
    return null;
  }
};

const parsePrerelease = (value: string | undefined): readonly (string | number)[] => {
  if (value === undefined || value.length === 0) {
    return [];
  }

  return value.split(".").map((part) => {
    const asNumber = Number.parseInt(part, 10);
    if (!Number.isNaN(asNumber) && `${asNumber}` === part) {
      return asNumber;
    }

    return part;
  });
};

const parseSemver = (value: string): ParsedSemver | null => {
  const trimmed = value.trim();
  const semverMatch = trimmed.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (semverMatch === null) {
    return null;
  }

  const major = Number.parseInt(semverMatch[1] ?? "", 10);
  const minor = Number.parseInt(semverMatch[2] ?? "", 10);
  const patch = Number.parseInt(semverMatch[3] ?? "", 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease: parsePrerelease(semverMatch[4]),
  };
};

const compareIdentifier = (left: string | number, right: string | number): number => {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "number") {
    return -1;
  }

  if (typeof right === "number") {
    return 1;
  }

  return left.localeCompare(right);
};

const compareSemver = (left: ParsedSemver, right: ParsedSemver): number => {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < maxLength; i += 1) {
    const leftPart = left.prerelease[i];
    const rightPart = right.prerelease[i];

    if (leftPart === undefined && rightPart === undefined) {
      return 0;
    }
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const diff = compareIdentifier(leftPart, rightPart);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
};

const isWildcardPart = (value: string | undefined): boolean =>
  value === undefined || value === "*" || value.toLowerCase() === "x";

const matchesPartialVersion = (version: ParsedSemver, token: string): boolean => {
  const normalized = token.trim().replace(/^v/, "");
  if (normalized === "*" || normalized.length === 0) {
    return true;
  }

  const [majorPart, minorPart, patchPart] = normalized.split(".");
  if (majorPart !== undefined && !isWildcardPart(majorPart)) {
    const major = Number.parseInt(majorPart, 10);
    if (!Number.isFinite(major) || major !== version.major) {
      return false;
    }
  }

  if (minorPart !== undefined && !isWildcardPart(minorPart)) {
    const minor = Number.parseInt(minorPart, 10);
    if (!Number.isFinite(minor) || minor !== version.minor) {
      return false;
    }
  }

  if (patchPart !== undefined && !isWildcardPart(patchPart)) {
    const patch = Number.parseInt(patchPart, 10);
    if (!Number.isFinite(patch) || patch !== version.patch) {
      return false;
    }
  }

  return true;
};

const parseComparatorToken = (token: string): { operator: string; versionToken: string } => {
  const operators = [">=", "<=", ">", "<", "="];
  for (const operator of operators) {
    if (token.startsWith(operator)) {
      return {
        operator,
        versionToken: token.slice(operator.length).trim(),
      };
    }
  }

  return {
    operator: "=",
    versionToken: token.trim(),
  };
};

const satisfiesComparator = (version: ParsedSemver, token: string): boolean | null => {
  if (token.length === 0 || token === "*") {
    return true;
  }

  if (token.startsWith("^")) {
    const base = parseSemver(token.slice(1));
    if (base === null) {
      return null;
    }

    let upper: ParsedSemver;
    if (base.major > 0) {
      upper = { major: base.major + 1, minor: 0, patch: 0, prerelease: [] };
    } else if (base.minor > 0) {
      upper = { major: 0, minor: base.minor + 1, patch: 0, prerelease: [] };
    } else {
      upper = { major: 0, minor: 0, patch: base.patch + 1, prerelease: [] };
    }

    return compareSemver(version, base) >= 0 && compareSemver(version, upper) < 0;
  }

  if (token.startsWith("~")) {
    const base = parseSemver(token.slice(1));
    if (base === null) {
      return null;
    }

    const upper: ParsedSemver = {
      major: base.major,
      minor: base.minor + 1,
      patch: 0,
      prerelease: [],
    };

    return compareSemver(version, base) >= 0 && compareSemver(version, upper) < 0;
  }

  const parsedComparator = parseComparatorToken(token);
  const hasWildcard = /(^|[.])(?:x|X|\*)($|[.])/.test(parsedComparator.versionToken);
  if (hasWildcard) {
    if (parsedComparator.operator !== "=") {
      return null;
    }
    return matchesPartialVersion(version, parsedComparator.versionToken);
  }

  const parsedVersion = parseSemver(parsedComparator.versionToken);
  if (parsedVersion === null) {
    if (parsedComparator.operator !== "=") {
      return null;
    }

    return matchesPartialVersion(version, parsedComparator.versionToken);
  }

  const comparison = compareSemver(version, parsedVersion);
  switch (parsedComparator.operator) {
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case "=":
      return comparison === 0;
    default:
      return null;
  }
};

const satisfiesRangeClause = (version: ParsedSemver, clause: string): boolean | null => {
  const hyphenMatch = clause.match(/^\s*(.+?)\s+-\s+(.+?)\s*$/);
  if (hyphenMatch !== null) {
    const lower = hyphenMatch[1];
    const upper = hyphenMatch[2];
    if (lower === undefined || upper === undefined) {
      return null;
    }

    const lowerResult = satisfiesComparator(version, `>=${lower}`);
    const upperResult = satisfiesComparator(version, `<=${upper}`);
    if (lowerResult === null || upperResult === null) {
      return null;
    }

    return lowerResult && upperResult;
  }

  const tokens = clause
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return true;
  }

  for (const token of tokens) {
    const matched = satisfiesComparator(version, token);
    if (matched === null) {
      return null;
    }

    if (!matched) {
      return false;
    }
  }

  return true;
};

const resolveRangeVersion = (
  versions: readonly string[],
  requested: string,
): string | null => {
  const clauses = requested
    .split("||")
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  if (clauses.length === 0) {
    return null;
  }

  const parsedVersions = versions
    .map((version) => ({ version, parsed: parseSemver(version) }))
    .filter((candidate): candidate is { version: string; parsed: ParsedSemver } => candidate.parsed !== null)
    .sort((a, b) => compareSemver(b.parsed, a.parsed));

  for (const candidate of parsedVersions) {
    let clauseMatched = false;
    let clauseUnsupported = false;

    for (const clause of clauses) {
      const matched = satisfiesRangeClause(candidate.parsed, clause);
      if (matched === null) {
        clauseUnsupported = true;
        continue;
      }

      if (matched) {
        clauseMatched = true;
        break;
      }
    }

    if (clauseMatched) {
      return candidate.version;
    }

    if (clauseUnsupported && clauses.length === 1) {
      return null;
    }
  }

  return null;
};

const resolveRequestedVersion = (
  packument: NpmPackument,
  requested: string | null,
): ResolvedVersion | null => {
  const versions = packument.versions ?? {};
  const versionKeys = Object.keys(versions);
  const tags = packument["dist-tags"] ?? {};
  const latest = tags["latest"];

  if (requested !== null && versions[requested] !== undefined) {
    return {
      version: requested,
      resolution: "exact",
      fallbackUsed: false,
    };
  }

  if (requested !== null) {
    const tagged = tags[requested];
    if (tagged !== undefined && versions[tagged] !== undefined) {
      return {
        version: tagged,
        resolution: "tag",
        fallbackUsed: false,
      };
    }
  }

  if (requested !== null) {
    const matched = resolveRangeVersion(versionKeys, requested);
    if (matched !== null && versions[matched] !== undefined) {
      return {
        version: matched,
        resolution: "range",
        fallbackUsed: false,
      };
    }
  }

  if (latest !== undefined && versions[latest] !== undefined) {
    return {
      version: latest,
      resolution: "latest",
      fallbackUsed: requested !== null,
    };
  }

  const semverSorted = versionKeys
    .map((version) => ({ version, parsed: parseSemver(version) }))
    .filter((candidate): candidate is { version: string; parsed: ParsedSemver } => candidate.parsed !== null)
    .sort((a, b) => compareSemver(b.parsed, a.parsed))
    .map((candidate) => candidate.version);
  const fallbackVersion = semverSorted[0] ?? versionKeys.sort((a, b) => b.localeCompare(a))[0];
  if (fallbackVersion === undefined) {
    return null;
  }

  return {
    version: fallbackVersion,
    resolution: "latest",
    fallbackUsed: requested !== null,
  };
};

type QueueItem = {
  name: string;
  requested: string | null;
  depth: number;
};

const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  limit: number,
  handler: (value: T) => Promise<R>,
): Promise<readonly R[]> => {
  const effectiveLimit = Math.max(1, limit);
  const workerCount = Math.min(effectiveLimit, values.length);
  const results: R[] = new Array(values.length);
  let index = 0;

  const workers: Promise<void>[] = Array.from({ length: workerCount }, async () => {
    // This loop always terminates: each iteration advances `index`,
    // and workers return once `index >= values.length`.
    while (true) {
      const current = index;
      index += 1;
      if (current >= values.length) {
        return;
      }

      const value = values[current];
      if (value !== undefined) {
        results[current] = await handler(value);
      }
    }
  });

  await Promise.all(workers);
  return results;
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

  const packumentByName = new Map<string, NpmPackument | null>();
  const assumptions = new Set<string>();
  const nodesByKey = new Map<string, LockedDependencyNode>();
  const queue: QueueItem[] = [{ name: parsed.name, requested: parsed.requested, depth: 0 }];
  let truncated = false;
  let rootResolution: ResolvedVersion | null = null;

  while (queue.length > 0) {
    if (nodesByKey.size >= maxNodes) {
      truncated = true;
      assumptions.add(`Dependency graph truncated at ${maxNodes} nodes.`);
      break;
    }

    const item = queue.shift();
    if (item === undefined) {
      break;
    }

    let packument = packumentByName.get(item.name) ?? null;
    if (!packumentByName.has(item.name)) {
      packument = await fetchPackument(item.name);
      packumentByName.set(item.name, packument);
    }

    if (packument === null) {
      if (item.name === parsed.name) {
        return {
          available: false,
          reason: "package_not_found",
          dependency: input.dependency,
        };
      }

      assumptions.add(`Skipped unresolved transitive dependency: ${item.name}.`);
      continue;
    }

    const resolved = resolveRequestedVersion(packument, item.requested);
    if (resolved === null) {
      if (item.name === parsed.name) {
        return {
          available: false,
          reason: "package_not_found",
          dependency: input.dependency,
        };
      }

      assumptions.add(`Skipped dependency with no resolvable versions: ${item.name}.`);
      continue;
    }

    if (item.name === parsed.name) {
      rootResolution = resolved;
    }

    if (resolved.fallbackUsed && item.requested !== null) {
      assumptions.add(
        `Resolved ${item.name}@${item.requested} to latest (${resolved.version}) because exact/tag match was unavailable.`,
      );
    }

    const nodeKey = `${item.name}@${resolved.version}`;
    if (nodesByKey.has(nodeKey)) {
      continue;
    }

    const manifest = (packument.versions ?? {})[resolved.version] ?? {};
    const dependencies = Object.entries(manifest.dependencies ?? {})
      .filter(([dependencyName, dependencyRange]) => dependencyName.length > 0 && dependencyRange.length > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));

    nodesByKey.set(nodeKey, {
      name: item.name,
      version: resolved.version,
      dependencies: dependencies.map(([dependencyName, dependencyRange]) => `${dependencyName}@${dependencyRange}`),
    });

    if (item.depth >= maxDepth && dependencies.length > 0) {
      truncated = true;
      assumptions.add(`Dependency graph truncated at depth ${maxDepth}.`);
      continue;
    }

    for (const [dependencyName, dependencyRange] of dependencies) {
      if (nodesByKey.size + queue.length >= maxNodes) {
        truncated = true;
        assumptions.add(`Dependency graph truncated at ${maxNodes} nodes.`);
        break;
      }

      queue.push({
        name: dependencyName,
        requested: dependencyRange,
        depth: item.depth + 1,
      });
    }
  }

  if (rootResolution === null) {
    return {
      available: false,
      reason: "package_not_found",
      dependency: input.dependency,
    };
  }

  const directNames = new Set([parsed.name]);
  const nodes = [...nodesByKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );

  const metadataEntries = await mapWithConcurrency(
    nodes,
    config.metadataRequestConcurrency,
    async (node) => ({
      key: `${node.name}@${node.version}`,
      metadata: await metadataProvider.getMetadata(node.name, node.version, {
        directDependency: directNames.has(node.name),
      }),
    }),
  );

  const metadataByKey = new Map<string, Awaited<(typeof metadataEntries)[number]>["metadata"]>();
  for (const entry of metadataEntries) {
    metadataByKey.set(entry.key, entry.metadata);
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
    nodes,
  };

  const external = buildExternalAnalysisSummary(
    `npm:${parsed.name}`,
    extraction,
    metadataByKey,
    config,
  );

  return {
    available: true,
    dependency: {
      name: parsed.name,
      requested: parsed.requested,
      resolvedVersion: rootResolution.version,
      resolution: rootResolution.resolution,
    },
    graph: {
      nodeCount: nodes.length,
      truncated,
      maxNodes,
      maxDepth,
    },
    assumptions: [...assumptions].sort((a, b) => a.localeCompare(b)),
    external,
  };
};
