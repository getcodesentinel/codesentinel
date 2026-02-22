import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProjectGraphSummary } from "./index.ts";

const createdPaths: string[] = [];

const createProject = async (
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const projectRoot = await mkdtemp(join(tmpdir(), "codesentinel-graph-test-"));
  createdPaths.push(projectRoot);

  await writeFile(
    join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          allowImportingTsExtensions: true,
        },
        include: ["**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(projectRoot, relativePath);
    const directoryPath = dirname(absolutePath);
    await mkdir(directoryPath, { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return projectRoot;
};

afterEach(async () => {
  for (const pathToDelete of createdPaths.splice(0, createdPaths.length)) {
    await rm(pathToDelete, { recursive: true, force: true });
  }
});

describe("buildProjectGraphSummary", () => {
  it("computes fan-in, fan-out, graph depth, and cycle metrics", async () => {
    const projectRoot = await createProject({
      "src/a.ts": 'import "./b.ts";\n',
      "src/b.ts": 'import "./c.ts";\n',
      "src/c.ts": "export const c = 1;\n",
      "src/d.ts": "export const d = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.metrics).toEqual({
      nodeCount: 4,
      edgeCount: 2,
      cycleCount: 0,
      graphDepth: 2,
      maxFanIn: 1,
      maxFanOut: 1,
    });

    expect(summary.edges).toEqual([
      { from: "src/a.ts", to: "src/b.ts" },
      { from: "src/b.ts", to: "src/c.ts" },
    ]);

    const fileById = new Map(summary.files.map((file) => [file.id, file]));
    expect(fileById.get("src/a.ts")).toMatchObject({ fanIn: 0, fanOut: 1, depth: 0 });
    expect(fileById.get("src/b.ts")).toMatchObject({ fanIn: 1, fanOut: 1, depth: 1 });
    expect(fileById.get("src/c.ts")).toMatchObject({ fanIn: 1, fanOut: 0, depth: 2 });
    expect(fileById.get("src/d.ts")).toMatchObject({ fanIn: 0, fanOut: 0, depth: 0 });
  });

  it("detects cycles through strongly connected components", async () => {
    const projectRoot = await createProject({
      "src/a.ts": 'import "./b.ts";\n',
      "src/b.ts": 'import "./a.ts";\n',
      "src/c.ts": 'import "./a.ts";\n',
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.metrics.cycleCount).toBe(1);
    expect(summary.cycles).toEqual([{ nodes: ["src/a.ts", "src/b.ts"] }]);
    expect(summary.metrics.graphDepth).toBe(1);
  });

  it("ignores type-only imports and captures dynamic imports and export dependencies", async () => {
    const projectRoot = await createProject({
      "src/a.ts": [
        'import type { B } from "./b.ts";',
        'export * from "./c.ts";',
        'await import("./d.ts");',
      ].join("\n"),
      "src/b.ts": "export type B = string;\n",
      "src/c.ts": "export const c = 1;\n",
      "src/d.ts": "export const d = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.edges).toEqual([
      { from: "src/a.ts", to: "src/c.ts" },
      { from: "src/a.ts", to: "src/d.ts" },
    ]);

    const aFile = summary.files.find((file) => file.id === "src/a.ts");
    expect(aFile?.directDependencies).toEqual(["src/c.ts", "src/d.ts"]);
  });

  it("is deterministic for identical input", async () => {
    const projectRoot = await createProject({
      "src/z.ts": 'import "./a.ts";\n',
      "src/a.ts": 'import "./m.ts";\n',
      "src/m.ts": "export const m = 1;\n",
    });

    const firstRun = buildProjectGraphSummary({ projectPath: projectRoot });
    const secondRun = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(secondRun).toEqual(firstRun);
  });
});
