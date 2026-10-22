import type { GraphAnalysisSummary, RepositoryEvolutionSummary } from "@codesentinel/core";
import { comparePaths } from "./compare.js";
import { ReadingPathError } from "./types.js";

const EXCLUDED_SEGMENTS = new Set([
  "dist",
  "__generated__",
  "node_modules",
  "vendor",
  "vendors",
  "third_party",
  "third-party",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_SUFFIX_PATTERN = /\.(test|spec)(\.[cm]?[jt]sx?)$/;
const TEST_SEGMENTS = new Set(["__tests__", "__mocks__"]);

const basenameOf = (filePath: string): string => {
  const separatorIndex = filePath.lastIndexOf("/");
  return separatorIndex === -1 ? filePath : filePath.slice(separatorIndex + 1);
};

export const normalizeTarget = (target: string): string => {
  let normalized = target.trim().replaceAll("\\", "/");

  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.length === 0) {
    throw new ReadingPathError("invalid_target", "target must not be empty");
  }

  return normalized;
};

export const isExcludedPath = (relativePath: string): boolean => {
  if (relativePath.endsWith(".d.ts")) return true;

  const segments = relativePath.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return true;

  const basename = basenameOf(relativePath);
  if (/\.gen\.[^./]+$/.test(basename)) return true;
  if (LOCKFILE_NAMES.has(basename)) return true;

  return false;
};

export const isTestPath = (filePath: string): boolean => {
  const segments = filePath.split("/");
  if (segments.some((segment) => TEST_SEGMENTS.has(segment))) return true;
  return TEST_FILE_PATTERN.test(basenameOf(filePath));
};

export const stripTestSuffix = (testPath: string): string => {
  const segments = testPath.split("/").filter((segment) => !TEST_SEGMENTS.has(segment));
  return segments.join("/").replace(TEST_SUFFIX_PATTERN, "$2");
};

export const stripSourceExtension = (filePath: string): string => {
  const basename = basenameOf(filePath);
  const extensionIndex = basename.lastIndexOf(".");
  if (extensionIndex <= 0) return filePath;
  return filePath.slice(0, filePath.length - (basename.length - extensionIndex));
};

export const knownPaths = (
  graph: GraphAnalysisSummary | null | undefined,
  evolution: RepositoryEvolutionSummary | null | undefined,
): readonly string[] => {
  let paths: readonly string[];

  if (graph !== null && graph !== undefined) {
    paths = graph.files.map((file) => file.relativePath);
  } else if (evolution !== null && evolution !== undefined && evolution.available) {
    paths = evolution.files.map((file) => file.filePath);
  } else {
    paths = [];
  }

  return [...new Set(paths)].sort(comparePaths);
};

export const inferTargetKind = (
  target: string,
  graph: GraphAnalysisSummary | null | undefined,
  evolution: RepositoryEvolutionSummary | null | undefined,
): "file" | "directory" => {
  const paths = knownPaths(graph, evolution);
  if (paths.includes(target)) return "file";
  if (paths.some((filePath) => filePath.startsWith(`${target}/`))) return "directory";

  const basename = basenameOf(target);
  const extensionIndex = basename.lastIndexOf(".");
  return extensionIndex >= 0 && extensionIndex < basename.length - 1 ? "file" : "directory";
};

export type ReadingPathUniverse = {
  targetKind: "file" | "directory";
  files: readonly string[];
  excludedCount: number;
};

const graphNeighbours = (graph: GraphAnalysisSummary, target: string): readonly string[] => {
  const pathById = new Map<string, string>();
  for (const node of graph.nodes) {
    const existing = pathById.get(node.id);
    if (existing === undefined || comparePaths(node.relativePath, existing) < 0) {
      pathById.set(node.id, node.relativePath);
    }
  }

  const neighbours = new Set<string>();
  for (const edge of graph.edges) {
    const from = pathById.get(edge.from);
    const to = pathById.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === target) neighbours.add(to);
    if (to === target) neighbours.add(from);
  }

  return [...neighbours].sort(comparePaths);
};

export const resolveUniverse = (
  target: string,
  graph: GraphAnalysisSummary | null | undefined,
  evolution: RepositoryEvolutionSummary | null | undefined,
): ReadingPathUniverse => {
  const targetKind = inferTargetKind(target, graph, evolution);

  if (targetKind === "file") {
    const files = new Set<string>([target]);
    let excludedCount = 0;

    if (graph !== null && graph !== undefined) {
      const graphFiles = new Set(graph.files.map((file) => file.relativePath));
      for (const neighbour of graphNeighbours(graph, target)) {
        if (neighbour === target || !graphFiles.has(neighbour)) continue;
        if (isExcludedPath(neighbour)) {
          excludedCount += 1;
          continue;
        }
        files.add(neighbour);
      }
    }

    return { targetKind, files: [...files].sort(comparePaths), excludedCount };
  }

  const included: string[] = [];
  let excludedCount = 0;

  for (const filePath of knownPaths(graph, evolution)) {
    if (filePath !== target && !filePath.startsWith(`${target}/`)) continue;
    if (isExcludedPath(filePath)) {
      excludedCount += 1;
      continue;
    }
    included.push(filePath);
  }

  return { targetKind, files: [...new Set(included)].sort(comparePaths), excludedCount };
};
