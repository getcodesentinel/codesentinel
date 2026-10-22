import type {
  FileAuthorShare,
  FileCoupling,
  FileDependency,
  FileEvolutionMetrics,
  GraphAnalysisSummary,
  GraphNode,
  RepositoryEvolutionAvailable,
} from "@codesentinel/core";
import type {
  DeclaredOwner,
  FileOwnershipAudit,
  OwnershipAuditAvailable,
  OwnershipAuditUnavailable,
} from "@codesentinel/ownership";
import { describe, expect, it } from "vitest";
import { buildReadingPath } from "./build-reading-path.js";
import { ReadingPathError, type ReadingPathInput } from "../domain/types.js";

const node = (relativePath: string): GraphNode => ({
  id: relativePath,
  absolutePath: `/repo/${relativePath}`,
  relativePath,
});

const dependency = (relativePath: string): FileDependency => ({
  id: relativePath,
  relativePath,
  directDependencies: [],
  fanIn: 0,
  fanOut: 0,
  depth: 0,
});

const graphOf = (
  paths: readonly string[],
  edges: readonly (readonly [string, string])[],
): GraphAnalysisSummary => {
  const allPaths = new Set(paths);
  for (const [from, to] of edges) {
    allPaths.add(from);
    allPaths.add(to);
  }
  const nodes = [...allPaths].sort().map(node);

  return {
    targetPath: "/repo",
    nodes,
    edges: edges.map(([from, to]) => ({ from, to })),
    cycles: [],
    files: paths.map(dependency),
    metrics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      cycleCount: 0,
      graphDepth: 0,
      maxFanIn: 0,
      maxFanOut: 0,
    },
  };
};

const authorShares = (
  entries: readonly (readonly [string, number])[],
): readonly FileAuthorShare[] =>
  entries.map(([authorId, commits]) => ({
    authorId,
    commits,
    share: commits === 0 ? 0 : commits,
  }));

const evolutionFile = (
  filePath: string,
  options: {
    commits?: number;
    churn?: number;
    authors?: readonly (readonly [string, number])[];
  } = {},
): FileEvolutionMetrics => {
  const commits = options.commits ?? 0;
  const churn = options.churn ?? 0;

  return {
    filePath,
    commitCount: commits,
    frequencyPer100Commits: 0,
    churnAdded: churn,
    churnDeleted: 0,
    churnTotal: churn,
    lastCommitTimestamp: null,
    recentCommitCount: 0,
    recentVolatility: 0,
    topAuthorShareByCommits: 0,
    busFactorByCommits: 0,
    authorDistributionByCommits: authorShares(options.authors ?? []),
    topAuthorShareByChurn: 0,
    busFactorByChurn: 0,
    authorDistributionByChurn: [],
  };
};

const couplingPair = (
  fileA: string,
  fileB: string,
  coChangeCommits: number,
  couplingScore: number,
): FileCoupling => ({ fileA, fileB, coChangeCommits, couplingScore });

const evolutionOf = (
  files: readonly FileEvolutionMetrics[],
  pairs: readonly FileCoupling[] = [],
): RepositoryEvolutionAvailable => ({
  targetPath: "/repo",
  available: true,
  files,
  hotspots: [],
  coupling: {
    pairs,
    totalPairCount: pairs.length,
    consideredCommits: 0,
    skippedLargeCommits: 0,
    truncated: false,
  },
  metrics: {
    totalCommits: 0,
    totalFiles: files.length,
    headCommitTimestamp: null,
    recentWindowDays: 0,
    hotspotTopPercent: 0,
    hotspotThresholdCommitCount: 0,
  },
});

const user = (handle: string): DeclaredOwner => ({ kind: "user", handle });

const ownershipFile = (
  filePath: string,
  declared: readonly DeclaredOwner[] = [],
  topAuthorId: string | null = null,
): FileOwnershipAudit => ({
  filePath,
  declared,
  matchLine: null,
  status: declared.length === 0 ? "unowned" : "aligned",
  observed: {
    commits: 0,
    recentCommits: 0,
    dormant: false,
    authors: 0,
    topAuthorId,
    topAuthorShare: null,
    busFactor: null,
    lastCommitUnix: null,
  },
  criticality: {
    fanIn: null,
    isHotspot: false,
    riskScore: null,
    isCritical: false,
  },
});

const auditOf = (files: readonly FileOwnershipAudit[]): OwnershipAuditAvailable => ({
  available: true,
  codeowners: {
    source: "CODEOWNERS",
    entries: [],
    errors: [],
    ignoredSources: [],
  },
  metrics: {
    declaredCoveragePercent: 0,
    declaredCoverageCriticalPercent: 0,
    driftPercent: 0,
    ghostOwnerCount: 0,
    unownedCriticalCount: 0,
    singleOwnerModuleCount: 0,
  },
  ghostOwners: [],
  files,
  ignoredAuthors: [],
  warnings: [],
});

const unavailableOwnership: OwnershipAuditUnavailable = {
  available: false,
  reason: "codeowners_not_found",
  warnings: [],
};

const reverse = <T>(values: readonly T[]): T[] => [...values].reverse();

const reverseGraph = (graph: GraphAnalysisSummary): GraphAnalysisSummary => ({
  ...graph,
  nodes: reverse(graph.nodes),
  edges: reverse(graph.edges),
  cycles: reverse(graph.cycles),
  files: reverse(graph.files),
});

const reverseEvolution = (
  evolution: RepositoryEvolutionAvailable,
): RepositoryEvolutionAvailable => ({
  ...evolution,
  files: reverse(evolution.files).map((file) => ({
    ...file,
    authorDistributionByCommits: reverse(file.authorDistributionByCommits),
    authorDistributionByChurn: reverse(file.authorDistributionByChurn),
  })),
  hotspots: reverse(evolution.hotspots),
  coupling: {
    ...evolution.coupling,
    pairs: reverse(evolution.coupling.pairs),
  },
});

describe("buildReadingPath", () => {
  it("selects the entry by external fan-in, then by shortest and alphabetical path", () => {
    const byFanIn = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        [
          ["lib/x.ts", "src/b.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["lib/z.ts", "src/a.ts"],
        ],
      ),
    });

    expect(byFanIn.steps[0]?.filePath).toBe("src/b.ts");
    expect(byFanIn.steps[0]?.reason).toBe(
      "entry: highest external fan-in (2 imports from outside the module)",
    );

    const byTieBreak = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/longer.ts"],
        [
          ["lib/x.ts", "src/a.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["lib/z.ts", "src/longer.ts"],
        ],
      ),
    });

    expect(byTieBreak.steps[0]?.filePath).toBe("src/a.ts");
    expect(byTieBreak.steps[0]?.reason).toBe(
      "entry: highest external fan-in (1 import from outside the module)",
    );
  });

  it("prefers the highest internal fan-out among files tied on external fan-in", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        [
          ["lib/x.ts", "src/a.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["src/a.ts", "src/c.ts"],
          ["src/a.ts", "src/d.ts"],
          ["src/b.ts", "src/c.ts"],
        ],
      ),
    });

    expect(path.steps[0]?.filePath).toBe("src/a.ts");
    expect(path.steps[0]?.reason).toBe(
      "entry: highest internal fan-out (2 imports inside the module)",
    );
  });

  it("breaks a fan-out tie by shortest path, then alphabetical order", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/long.ts", "src/t1.ts", "src/t2.ts", "src/t3.ts"],
        [
          ["lib/x.ts", "src/a.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["lib/z.ts", "src/long.ts"],
          ["src/a.ts", "src/t1.ts"],
          ["src/b.ts", "src/t2.ts"],
          ["src/long.ts", "src/t3.ts"],
        ],
      ),
    });

    expect(path.steps[0]?.filePath).toBe("src/a.ts");
    expect(path.steps[0]?.reason).toBe(
      "entry: highest internal fan-out (1 import inside the module)",
    );
  });

  it("keeps the external fan-in rule when tied files have no internal fan-out", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        [
          ["lib/x.ts", "src/a.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["lib/z.ts", "src/c.ts"],
        ],
      ),
    });

    expect(path.steps[0]?.filePath).toBe("src/a.ts");
    expect(path.steps[0]?.reason).toBe(
      "entry: highest external fan-in (1 import from outside the module)",
    );
  });

  it("prefers a root index-like file over a higher external fan-in", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/index.ts", "src/b.ts", "src/c.ts"],
        [
          ["lib/x.ts", "src/b.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["src/index.ts", "src/c.ts"],
        ],
      ),
    });

    expect(path.steps[0]?.filePath).toBe("src/index.ts");
    expect(path.steps[0]?.reason).toBe("entry: package index");
  });

  it("reports the external fan-in on a package index entry", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/index.ts", "src/b.ts"],
        [
          ["lib/x.ts", "src/index.ts"],
          ["lib/y.ts", "src/index.ts"],
          ["lib/z.ts", "src/b.ts"],
          ["lib/w.ts", "src/b.ts"],
        ],
      ),
    });

    expect(path.steps[0]?.filePath).toBe("src/index.ts");
    expect(path.steps[0]?.reason).toBe("entry: package index (2 imports from outside the module)");
  });

  it.each(["index.ts", "index.tsx", "main.ts", "mod.ts", "public-api.ts"])(
    "uses a root %s as the package index entry",
    (name) => {
      const indexFile = `src/${name}`;
      const path = buildReadingPath({
        target: "src",
        graph: graphOf(
          [indexFile, "src/b.ts"],
          [
            ["lib/x.ts", "src/b.ts"],
            ["lib/y.ts", "src/b.ts"],
          ],
        ),
      });

      expect(path.steps[0]?.filePath).toBe(indexFile);
      expect(path.steps[0]?.reason).toBe("entry: package index");
    },
  );

  it("does not apply the index rule to a nested index-like file", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/domain/index.ts", "src/b.ts"],
        [
          ["lib/x.ts", "src/domain/index.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["lib/z.ts", "src/b.ts"],
        ],
      ),
    });

    expect(path.steps[0]?.filePath).toBe("src/b.ts");
    expect(path.steps[0]?.reason).toBe(
      "entry: highest external fan-in (2 imports from outside the module)",
    );
  });

  it("falls back to the highest internal fan-in when external fan-in is zero", () => {
    const plural = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        [
          ["src/a.ts", "src/c.ts"],
          ["src/b.ts", "src/c.ts"],
        ],
      ),
    });

    expect(plural.steps[0]?.filePath).toBe("src/c.ts");
    expect(plural.steps[0]?.reason).toBe("entry: highest internal fan-in (2 importers)");

    const singular = buildReadingPath({
      target: "src",
      graph: graphOf(["src/a.ts", "src/c.ts"], [["src/a.ts", "src/c.ts"]]),
    });

    expect(singular.steps[0]?.filePath).toBe("src/c.ts");
    expect(singular.steps[0]?.reason).toBe("entry: highest internal fan-in (1 importer)");
  });

  it("prefers a co-changing neighbour and explains the coupling", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/entry.ts"],
        [
          ["lib/x.ts", "src/entry.ts"],
          ["src/entry.ts", "src/a.ts"],
          ["src/entry.ts", "src/b.ts"],
          ["src/c.ts", "src/a.ts"],
          ["src/d.ts", "src/a.ts"],
        ],
      ),
      evolution: evolutionOf(
        [
          evolutionFile("src/a.ts"),
          evolutionFile("src/b.ts"),
          evolutionFile("src/c.ts"),
          evolutionFile("src/d.ts"),
          evolutionFile("src/entry.ts"),
        ],
        [couplingPair("src/entry.ts", "src/b.ts", 7, 1)],
      ),
    });

    expect(path.steps.map((step) => step.filePath).slice(0, 2)).toEqual([
      "src/entry.ts",
      "src/b.ts",
    ]);
    expect(path.steps[1]?.reason).toBe("most changed together with src/entry.ts (7 commits)");
  });

  it("falls back to the highest internal fan-in after the connected component is consumed", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        [
          "src/entry.ts",
          "src/a.ts",
          "src/x.ts",
          "src/u.ts",
          "src/v.ts",
          "src/w.ts",
          "src/y.ts",
          "src/z.ts",
        ],
        [
          ["lib/x.ts", "src/entry.ts"],
          ["src/entry.ts", "src/a.ts"],
          ["src/u.ts", "src/x.ts"],
          ["src/v.ts", "src/x.ts"],
          ["src/w.ts", "src/y.ts"],
        ],
      ),
      evolution: evolutionOf([
        evolutionFile("src/entry.ts"),
        evolutionFile("src/a.ts"),
        evolutionFile("src/x.ts"),
        evolutionFile("src/u.ts"),
        evolutionFile("src/v.ts"),
        evolutionFile("src/w.ts"),
        evolutionFile("src/y.ts"),
        evolutionFile("src/z.ts"),
      ]),
    });

    expect(path.steps.map((step) => step.filePath).slice(0, 3)).toEqual([
      "src/entry.ts",
      "src/a.ts",
      "src/x.ts",
    ]);
    expect(path.steps[2]?.reason).toBe("central inside the module: 2 importers");
  });

  it("breaks exhausted ties by churn and then by path", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/entry.ts", "src/a.ts", "src/x.ts", "src/y.ts", "src/z1.ts", "src/z2.ts"],
        [
          ["lib/x.ts", "src/entry.ts"],
          ["src/entry.ts", "src/a.ts"],
        ],
      ),
      evolution: evolutionOf([
        evolutionFile("src/entry.ts", { commits: 1, churn: 1 }),
        evolutionFile("src/a.ts", { commits: 1, churn: 1 }),
        evolutionFile("src/x.ts", { commits: 2, churn: 10 }),
        evolutionFile("src/y.ts", { commits: 3, churn: 20 }),
        evolutionFile("src/z1.ts"),
        evolutionFile("src/z2.ts"),
      ]),
    });

    expect(path.steps.map((step) => step.filePath)).toEqual([
      "src/entry.ts",
      "src/a.ts",
      "src/y.ts",
      "src/x.ts",
      "src/z1.ts",
      "src/z2.ts",
    ]);
    expect(path.steps[2]?.reason).toBe("highest churn in the module (20 lines)");
    expect(path.steps[4]?.reason).toBe("highest churn in the module (0 lines)");
  });

  it("assigns entry, core and helper roles around the median fan-in", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        ["src/entry.ts", "src/core.ts", "src/helper.ts"],
        [
          ["lib/x.ts", "src/entry.ts"],
          ["src/entry.ts", "src/core.ts"],
          ["src/helper.ts", "src/core.ts"],
        ],
      ),
      evolution: evolutionOf([
        evolutionFile("src/entry.ts"),
        evolutionFile("src/core.ts"),
        evolutionFile("src/helper.ts"),
      ]),
    });

    expect(path.steps.map((step) => step.filePath)).toEqual([
      "src/entry.ts",
      "src/core.ts",
      "src/helper.ts",
    ]);
    expect(path.steps.map((step) => step.role)).toEqual(["entry", "core", "helper"]);
  });

  it("is deterministic and independent of input array order", () => {
    const input = {
      target: "src",
      graph: graphOf(
        ["src/index.ts", "src/a.ts", "src/b.ts", "src/c.ts", "src/a.test.ts"],
        [
          ["lib/x.ts", "src/a.ts"],
          ["src/a.ts", "src/b.ts"],
          ["src/b.ts", "src/c.ts"],
          ["src/c.ts", "src/a.ts"],
        ],
      ),
      evolution: evolutionOf(
        [
          evolutionFile("src/index.ts"),
          evolutionFile("src/a.ts", {
            commits: 5,
            churn: 12,
            authors: [
              ["marta@company.com", 3],
              ["bob@company.com", 2],
            ],
          }),
          evolutionFile("src/b.ts", {
            commits: 4,
            churn: 8,
            authors: [
              ["bob@company.com", 4],
              ["marta@company.com", 1],
            ],
          }),
          evolutionFile("src/c.ts", {
            commits: 2,
            churn: 3,
            authors: [["marta@company.com", 2]],
          }),
          evolutionFile("src/a.test.ts", {
            commits: 1,
            churn: 2,
            authors: [["bob@company.com", 1]],
          }),
        ],
        [
          couplingPair("src/a.ts", "src/b.ts", 3, 0.8),
          couplingPair("src/b.ts", "src/c.ts", 2, 0.5),
          couplingPair("src/a.ts", "src/c.ts", 1, 0.2),
        ],
      ),
      ownership: auditOf([
        ownershipFile("src/a.ts", [user("marta")], "marta@company.com"),
        ownershipFile("src/b.ts", [user("bob")], "bob@company.com"),
      ]),
      maxSteps: 8,
    };

    const first = buildReadingPath(input);
    expect(first.steps[0]?.filePath).toBe("src/index.ts");
    const second = buildReadingPath(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const shuffled = buildReadingPath({
      target: input.target,
      graph: reverseGraph(input.graph),
      evolution: reverseEvolution(input.evolution),
      ownership: {
        ...input.ownership,
        files: reverse(input.ownership.files),
      },
      maxSteps: input.maxSteps,
    });

    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(first));
  });

  it("excludes generated, vendored and lock files from the universe", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(
        [
          "src/a.ts",
          "src/types.d.ts",
          "src/dist/gen.ts",
          "src/__generated__/x.ts",
          "src/foo.gen.ts",
          "src/vendor/lib.ts",
          "src/pnpm-lock.yaml",
        ],
        [["lib/x.ts", "src/a.ts"]],
      ),
    });

    expect(path.steps.map((step) => step.filePath)).toEqual(["src/a.ts"]);
    for (const excluded of [
      "src/types.d.ts",
      "src/dist/gen.ts",
      "src/__generated__/x.ts",
      "src/foo.gen.ts",
      "src/vendor/lib.ts",
      "src/pnpm-lock.yaml",
    ]) {
      expect(path.steps.some((step) => step.filePath === excluded)).toBe(false);
    }

    const exclusionWarnings = path.warnings.filter((warning) => warning.startsWith("excluded "));
    expect(exclusionWarnings).toEqual([
      "excluded 6 generated, vendored or lock file(s) from the target",
    ]);
  });

  it("orders by churn in git-only mode and reports the missing graph", () => {
    const path = buildReadingPath({
      target: "src",
      evolution: evolutionOf([
        evolutionFile("src/a.ts", {
          commits: 1,
          churn: 10,
          authors: [["marta@company.com", 1]],
        }),
        evolutionFile("src/b.ts", {
          commits: 3,
          churn: 30,
          authors: [["bob@company.com", 3]],
        }),
      ]),
    });

    expect(path.steps.map((step) => step.filePath)).toEqual(["src/b.ts", "src/a.ts"]);
    expect(path.steps[0]?.reason).toBe("changed 30 lines in 3 commits (no structural graph)");
    expect(path.steps[1]?.reason).toBe("changed 10 lines in 1 commit (no structural graph)");
    expect(path.warnings).toContain(
      "no structural graph available: ordered by churn and change coupling",
    );
  });

  it("attributes declared owners and observed authors", () => {
    const input = {
      target: "src",
      graph: graphOf(["src/a.ts"], [["lib/x.ts", "src/a.ts"]]),
      evolution: evolutionOf([
        evolutionFile("src/a.ts", {
          commits: 4,
          churn: 5,
          authors: [
            ["marta@company.com", 3],
            ["bob@company.com", 1],
          ],
        }),
      ]),
      ownership: auditOf([ownershipFile("src/a.ts", [user("marta")], "fallback@company.com")]),
    };

    const path = buildReadingPath(input);
    expect(path.steps[0]?.owner).toEqual([user("marta")]);
    expect(path.steps[0]?.observedTopAuthor).toBe("marta@company.com");
    expect(path.people[0]).toEqual({
      authorId: "marta@company.com",
      files: ["src/a.ts"],
      commits: 3,
    });

    const withoutOwnership: ReadingPathInput = {
      target: input.target,
      graph: input.graph,
      evolution: input.evolution,
    };
    expect(buildReadingPath(withoutOwnership).steps[0]?.owner).toBeNull();
    expect(
      buildReadingPath({ ...input, ownership: unavailableOwnership }).steps[0]?.owner,
    ).toBeNull();

    const withoutEvolution = buildReadingPath({
      target: "src",
      graph: input.graph,
      ownership: auditOf([ownershipFile("src/a.ts", [user("marta")], "observed@company.com")]),
    });
    expect(withoutEvolution.steps[0]?.observedTopAuthor).toBe("observed@company.com");
  });

  it("truncates at maxSteps and reports the truncation", () => {
    const graph = graphOf(
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      [
        ["lib/x.ts", "src/a.ts"],
        ["src/a.ts", "src/b.ts"],
        ["src/a.ts", "src/c.ts"],
        ["src/a.ts", "src/d.ts"],
      ],
    );
    const evolution = evolutionOf([
      evolutionFile("src/a.ts"),
      evolutionFile("src/b.ts"),
      evolutionFile("src/c.ts"),
      evolutionFile("src/d.ts"),
    ]);

    const truncated = buildReadingPath({ target: "src", graph, evolution, maxSteps: 2 });
    expect(truncated.steps).toHaveLength(2);
    expect(truncated.truncated).toBe(true);
    expect(truncated.warnings).toContain("showing 2 of 4 files (truncated)");

    const complete = buildReadingPath({ target: "src", graph, evolution, maxSteps: 8 });
    expect(complete.steps).toHaveLength(4);
    expect(complete.truncated).toBe(false);
    expect(complete.warnings).toEqual([]);
  });

  it("resolves a file target to its direct graph neighbours", () => {
    const path = buildReadingPath({
      target: "src/a.ts",
      graph: graphOf(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        [
          ["lib/x.ts", "src/a.ts"],
          ["src/a.ts", "src/b.ts"],
          ["src/a.ts", "src/c.ts"],
        ],
      ),
      evolution: evolutionOf([
        evolutionFile("src/a.ts"),
        evolutionFile("src/b.ts"),
        evolutionFile("src/c.ts"),
      ]),
    });

    expect(path.targetKind).toBe("file");
    expect(path.steps.map((step) => step.filePath)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("starts a file target at the target even when a neighbour has more external importers", () => {
    const path = buildReadingPath({
      target: "src/a.ts",
      graph: graphOf(
        ["src/a.ts", "src/b.ts"],
        [
          ["lib/x.ts", "src/b.ts"],
          ["lib/y.ts", "src/b.ts"],
          ["src/a.ts", "src/b.ts"],
        ],
      ),
    });

    expect(path.targetKind).toBe("file");
    expect(path.steps[0]?.filePath).toBe("src/a.ts");
  });

  it("uses a neutral entry reason when the entry has no imports in or out", () => {
    const path = buildReadingPath({
      target: "src",
      graph: graphOf(["src/a.ts", "src/b.ts"], []),
    });

    expect(path.steps[0]?.filePath).toBe("src/a.ts");
    expect(path.steps[0]?.reason).toBe("no imports in or out of the module; first by path");
  });

  it("warns when a file target has no graph data", () => {
    const path = buildReadingPath({
      target: "src/missing.ts",
      graph: graphOf(["src/other.ts"], []),
    });

    expect(path.targetKind).toBe("file");
    expect(path.warnings).toContain("target file src/missing.ts has no graph data");
  });

  it("throws ReadingPathError for an empty target", () => {
    let caught: unknown;

    try {
      buildReadingPath({ target: "   " });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ReadingPathError);
    expect(caught).toMatchObject({ code: "invalid_target" });
  });

  it("attaches tests by default and steps them when includeTests is enabled", () => {
    const graph = graphOf(
      ["src/a.ts", "src/b.ts", "src/a.test.ts", "src/__tests__/b.test.ts"],
      [
        ["lib/x.ts", "src/a.ts"],
        ["src/a.ts", "src/b.ts"],
      ],
    );
    const evolution = evolutionOf([
      evolutionFile("src/a.ts"),
      evolutionFile("src/b.ts"),
      evolutionFile("src/a.test.ts"),
      evolutionFile("src/__tests__/b.test.ts"),
    ]);

    const attached = buildReadingPath({ target: "src", graph, evolution });
    expect(attached.steps.map((step) => step.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(attached.steps[0]?.testFiles).toEqual(["src/a.test.ts"]);
    expect(attached.steps[1]?.testFiles).toEqual(["src/__tests__/b.test.ts"]);

    const stepped = buildReadingPath({ target: "src", graph, evolution, includeTests: true });
    expect(stepped.steps.map((step) => step.filePath)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/__tests__/b.test.ts",
      "src/a.test.ts",
    ]);
    expect(stepped.steps.map((step) => step.role)).toEqual(["entry", "core", "test", "test"]);
    expect(stepped.steps.every((step) => step.testFiles.length === 0)).toBe(true);
  });
});
