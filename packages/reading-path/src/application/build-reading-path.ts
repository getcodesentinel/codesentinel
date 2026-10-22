import type { DeclaredOwner, OwnershipAudit } from "@codesentinel/ownership";
import { comparePaths } from "../domain/compare.js";
import { createGraphIndex } from "../domain/graph-index.js";
import {
  createEvolutionIndex,
  orderReadingPath,
  resolveMaxSteps,
  topAuthorId,
  type EvolutionIndex,
} from "../domain/ordering.js";
import {
  isTestPath,
  knownPaths,
  normalizeTarget,
  resolveUniverse,
  stripSourceExtension,
  stripTestSuffix,
} from "../domain/seed-resolution.js";
import type {
  ReadingPath,
  ReadingPathInput,
  ReadingPathPerson,
  ReadingStep,
} from "../domain/types.js";

type MutableStep = Omit<ReadingStep, "testFiles"> & { testFiles: string[] };

const ownerFor = (
  filePath: string,
  ownership: OwnershipAudit | null,
): readonly DeclaredOwner[] | null => {
  if (ownership === null || !ownership.available) return null;
  return ownership.files.find((file) => file.filePath === filePath)?.declared ?? [];
};

const ownershipTopAuthor = (filePath: string, ownership: OwnershipAudit | null): string | null => {
  if (ownership === null || !ownership.available) return null;
  return ownership.files.find((file) => file.filePath === filePath)?.observed.topAuthorId ?? null;
};

const observedTopAuthorFor = (
  filePath: string,
  evolution: EvolutionIndex,
  ownership: OwnershipAudit | null,
): string | null => {
  if (evolution.available) {
    const file = evolution.file(filePath);
    return topAuthorId(file?.authorDistributionByCommits ?? []);
  }
  return ownershipTopAuthor(filePath, ownership);
};

const buildPeople = (
  steppedFiles: readonly string[],
  evolution: EvolutionIndex,
): readonly ReadingPathPerson[] => {
  const commitsByAuthor = new Map<string, number>();
  const dominantAuthorByFile = new Map<string, string>();

  for (const filePath of steppedFiles) {
    const distribution = evolution.file(filePath)?.authorDistributionByCommits ?? [];
    for (const share of distribution) {
      if (share.authorId.length === 0) continue;
      commitsByAuthor.set(
        share.authorId,
        (commitsByAuthor.get(share.authorId) ?? 0) + share.commits,
      );
    }

    const top = topAuthorId(distribution);
    if (top !== null) dominantAuthorByFile.set(filePath, top);
  }

  return [...commitsByAuthor.entries()]
    .map(([authorId, commits]) => {
      const files = steppedFiles
        .filter((filePath) => dominantAuthorByFile.get(filePath) === authorId)
        .sort(comparePaths);
      return { authorId, files, commits };
    })
    .sort((a, b) => b.commits - a.commits || comparePaths(a.authorId, b.authorId))
    .slice(0, 3);
};

const attachTestFiles = (steps: readonly MutableStep[], testFiles: readonly string[]): void => {
  for (const testPath of testFiles) {
    const sourcePath = stripTestSuffix(testPath);
    const sourceStem = stripSourceExtension(sourcePath);
    const target = steps.find(
      (step) => step.filePath === sourcePath || stripSourceExtension(step.filePath) === sourceStem,
    );
    if (target !== undefined) target.testFiles.push(testPath);
  }

  for (const step of steps) step.testFiles.sort(comparePaths);
};

export const buildReadingPath = (input: ReadingPathInput): ReadingPath => {
  const target = normalizeTarget(input.target);
  const maxSteps = resolveMaxSteps(input.maxSteps);
  const graph = input.graph ?? null;
  const evolution = input.evolution ?? null;
  const ownership = input.ownership ?? null;
  const includeTests = input.includeTests === true;

  const universe = resolveUniverse(target, graph, evolution);
  const graphIndex = createGraphIndex(graph, universe.files);
  const evolutionIndex = createEvolutionIndex(evolution);

  const steppableFiles = includeTests
    ? universe.files
    : universe.files.filter((filePath) => !isTestPath(filePath));

  const ordered = orderReadingPath({
    steppableFiles,
    graphIndex,
    evolution: evolutionIndex,
    hasGraph: graph !== null,
    includeTests,
    maxSteps,
    seedFile: universe.targetKind === "file" ? target : null,
    targetRoot: universe.targetKind === "directory" ? target : null,
  });

  const steps: MutableStep[] = ordered.map((entry) => ({
    order: 0,
    filePath: entry.filePath,
    role: entry.role,
    reason: entry.reason,
    owner: ownerFor(entry.filePath, ownership),
    observedTopAuthor: observedTopAuthorFor(entry.filePath, evolutionIndex, ownership),
    commits: evolutionIndex.commits(entry.filePath),
    churn: evolutionIndex.churn(entry.filePath),
    fanInInternal: graphIndex.fanInInternal(entry.filePath),
    testFiles: [],
  }));

  if (!includeTests) {
    const testFiles = universe.files.filter((filePath) => isTestPath(filePath)).sort(comparePaths);
    attachTestFiles(steps, testFiles);
  }

  steps.forEach((step, index) => {
    step.order = index + 1;
  });

  const truncated = steps.length === maxSteps && steppableFiles.length > steps.length;
  const warnings: string[] = [];

  if (graph === null) {
    warnings.push("no structural graph available: ordered by churn and change coupling");
  }
  if (!evolutionIndex.available) {
    warnings.push("repository evolution is unavailable: churn signals are zero");
  }
  if (
    universe.targetKind === "file" &&
    graph !== null &&
    !knownPaths(graph, evolution).includes(target)
  ) {
    warnings.push(`target file ${target} has no graph data`);
  }
  if (universe.excludedCount > 0) {
    warnings.push(
      `excluded ${universe.excludedCount} generated, vendored or lock file(s) from the target`,
    );
  }
  if (universe.files.length === 0) {
    warnings.push(`no files found under ${target}`);
  }
  if (truncated) {
    warnings.push(`showing ${maxSteps} of ${steppableFiles.length} files (truncated)`);
  }

  const people = buildPeople(
    steps.map((step) => step.filePath),
    evolutionIndex,
  );

  return {
    target,
    targetKind: universe.targetKind,
    steps,
    people,
    commands: [],
    warnings,
    truncated,
  };
};
