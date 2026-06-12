import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProjectGraphSummary, discoverWorkspacePackages } from "./index.js";

const createdPaths: string[] = [];

const createProject = async (files: Readonly<Record<string, string>>): Promise<string> => {
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

  it("discovers files through tsconfig project references in monorepo roots", async () => {
    const projectRoot = await createProject({
      "tsconfig.json": JSON.stringify(
        {
          files: [],
          references: [{ path: "./packages/a" }, { path: "./packages/b" }],
        },
        null,
        2,
      ),
      "packages/a/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            allowImportingTsExtensions: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "packages/b/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            allowImportingTsExtensions: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "packages/a/src/a.ts": 'import "../../b/src/b.ts";\n',
      "packages/b/src/b.ts": "export const b = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });
    expect(summary.metrics.nodeCount).toBe(2);
    expect(summary.edges).toEqual([{ from: "packages/a/src/a.ts", to: "packages/b/src/b.ts" }]);
  });

  it("falls back to filesystem scan when tsconfig provides no source files", async () => {
    const projectRoot = await createProject({
      "tsconfig.json": JSON.stringify({ files: [] }, null, 2),
      "src/index.js": 'const util = require("./util.js");\nexport { util };\n',
      "src/util.js": "module.exports = { x: 1 };\n",
      "dist/generated.js": 'import "../src/util.js";\n',
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });
    expect(summary.metrics.nodeCount).toBe(2);
    expect(summary.nodes.map((node) => node.id).sort((a, b) => a.localeCompare(b))).toEqual([
      "src/index.js",
      "src/util.js",
    ]);
    expect(summary.edges).toEqual([{ from: "src/index.js", to: "src/util.js" }]);
  });

  it("discovers pnpm workspace packages deterministically", async () => {
    const projectRoot = await createProject({
      "pnpm-workspace.yaml": [
        "packages:",
        '  - "docs"',
        '  - "examples/*"',
        '  - "packages/*"',
        '  - "!packages/ignored"',
      ].join("\n"),
      "docs/package.json": JSON.stringify({ name: "docs" }),
      "examples/next/package.json": JSON.stringify({ name: "next-example" }),
      "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
      "packages/ignored/package.json": JSON.stringify({ name: "@acme/ignored" }),
      "packages/no-manifest/src/index.ts": "export const skipped = 1;\n",
    });

    expect(discoverWorkspacePackages(projectRoot)).toEqual([
      { name: "docs", path: "docs", kind: "docs" },
      { name: "next-example", path: "examples/next", kind: "example" },
      { name: "@acme/core", path: "packages/core", kind: "package" },
    ]);
  });

  it("summarizes workspace file and edge counts from package.json workspaces", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["apps/*", "packages/*"],
      }),
      "apps/api/package.json": JSON.stringify({ name: "@acme/api" }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "packages/shared/package.json": JSON.stringify({ name: "@acme/shared" }),
      "apps/api/src/index.ts": 'import "../../../packages/shared/src/shared.ts";\n',
      "apps/web/src/index.ts": 'import "../../../packages/shared/src/shared.ts";\n',
      "packages/shared/src/shared.ts": 'import "./util.ts";\n',
      "packages/shared/src/util.ts": "export const util = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.workspaces).toEqual([
      {
        name: "@acme/api",
        path: "apps/api",
        kind: "app",
        fileCount: 1,
        internalEdgeCount: 0,
        incomingEdgeCount: 0,
        outgoingEdgeCount: 1,
      },
      {
        name: "@acme/web",
        path: "apps/web",
        kind: "app",
        fileCount: 1,
        internalEdgeCount: 0,
        incomingEdgeCount: 0,
        outgoingEdgeCount: 1,
      },
      {
        name: "@acme/shared",
        path: "packages/shared",
        kind: "package",
        fileCount: 2,
        internalEdgeCount: 1,
        incomingEdgeCount: 2,
        outgoingEdgeCount: 0,
      },
    ]);
  });

  it("resolves workspace package-name imports to source files", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["apps/*", "packages/*"],
      }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "packages/shared/package.json": JSON.stringify({
        name: "@acme/shared",
        source: "src/index.ts",
      }),
      "apps/web/src/index.ts": 'import { shared } from "@acme/shared";\n',
      "packages/shared/src/index.ts": "export const shared = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.edges).toEqual([
      { from: "apps/web/src/index.ts", to: "packages/shared/src/index.ts" },
    ]);
    expect(summary.crossWorkspaceEdges).toEqual([
      {
        fromWorkspace: "apps/web",
        toWorkspace: "packages/shared",
        from: "apps/web/src/index.ts",
        to: "packages/shared/src/index.ts",
      },
    ]);
    expect(summary.workspaces).toEqual([
      {
        name: "@acme/web",
        path: "apps/web",
        kind: "app",
        fileCount: 1,
        internalEdgeCount: 0,
        incomingEdgeCount: 0,
        outgoingEdgeCount: 1,
      },
      {
        name: "@acme/shared",
        path: "packages/shared",
        kind: "package",
        fileCount: 1,
        internalEdgeCount: 0,
        incomingEdgeCount: 1,
        outgoingEdgeCount: 0,
      },
    ]);
  });

  it("resolves workspace package subpath imports to source files", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["apps/*", "packages/*"],
      }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "packages/shared/package.json": JSON.stringify({ name: "@acme/shared" }),
      "apps/web/src/index.ts": 'import { util } from "@acme/shared/util";\n',
      "packages/shared/src/index.ts": "export const shared = 1;\n",
      "packages/shared/src/util.ts": "export const util = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.edges).toEqual([
      { from: "apps/web/src/index.ts", to: "packages/shared/src/util.ts" },
    ]);
    expect(
      summary.workspaces?.find((workspace) => workspace.name === "@acme/shared"),
    ).toMatchObject({
      incomingEdgeCount: 1,
    });
  });

  it("resolves workspace package exports to source files", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["apps/*", "packages/*"],
      }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "packages/shared/package.json": JSON.stringify({
        name: "@acme/shared",
        exports: {
          ".": {
            types: "./src/index.ts",
            default: "./dist/index.js",
          },
          "./ui": {
            source: "./src/ui.ts",
            default: "./dist/ui.js",
          },
        },
      }),
      "apps/web/src/index.ts": [
        'import { shared } from "@acme/shared";',
        'import { ui } from "@acme/shared/ui";',
      ].join("\n"),
      "packages/shared/src/index.ts": "export const shared = 1;\n",
      "packages/shared/src/ui.ts": "export const ui = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.edges).toEqual([
      { from: "apps/web/src/index.ts", to: "packages/shared/src/index.ts" },
      { from: "apps/web/src/index.ts", to: "packages/shared/src/ui.ts" },
    ]);
    expect(summary.crossWorkspaceEdges).toEqual([
      {
        fromWorkspace: "apps/web",
        toWorkspace: "packages/shared",
        from: "apps/web/src/index.ts",
        to: "packages/shared/src/index.ts",
      },
      {
        fromWorkspace: "apps/web",
        toWorkspace: "packages/shared",
        from: "apps/web/src/index.ts",
        to: "packages/shared/src/ui.ts",
      },
    ]);
  });

  it("resolves workspace package wildcard exports to source files", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["apps/*", "packages/*"],
      }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "packages/shared/package.json": JSON.stringify({
        name: "@acme/shared",
        exports: {
          "./*": "./src/*.ts",
        },
      }),
      "apps/web/src/index.ts": 'import { button } from "@acme/shared/button";\n',
      "packages/shared/src/button.ts": "export const button = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.edges).toEqual([
      { from: "apps/web/src/index.ts", to: "packages/shared/src/button.ts" },
    ]);
  });

  it("resolves TypeScript path aliases to workspace source files", async () => {
    const projectRoot = await createProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            allowImportingTsExtensions: true,
            baseUrl: ".",
            paths: {
              "#shared/*": ["packages/shared/src/*"],
            },
          },
          include: ["**/*.ts"],
        },
        null,
        2,
      ),
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["apps/*", "packages/*"],
      }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "packages/shared/package.json": JSON.stringify({ name: "@acme/shared" }),
      "apps/web/src/index.ts": 'import { util } from "#shared/util";\n',
      "packages/shared/src/util.ts": "export const util = 1;\n",
    });

    const summary = buildProjectGraphSummary({ projectPath: projectRoot });

    expect(summary.edges).toEqual([
      { from: "apps/web/src/index.ts", to: "packages/shared/src/util.ts" },
    ]);
    expect(summary.crossWorkspaceEdges).toEqual([
      {
        fromWorkspace: "apps/web",
        toWorkspace: "packages/shared",
        from: "apps/web/src/index.ts",
        to: "packages/shared/src/util.ts",
      },
    ]);
  });

  it("discovers package.json workspaces declared as a packages object", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: {
          packages: ["apps/*", "packages/*"],
        },
      }),
      "apps/api/package.json": JSON.stringify({ name: "@acme/api" }),
      "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
    });

    expect(discoverWorkspacePackages(projectRoot)).toEqual([
      { name: "@acme/api", path: "apps/api", kind: "app" },
      { name: "@acme/core", path: "packages/core", kind: "package" },
    ]);
  });

  it("discovers nested workspace package globs without external fixtures", async () => {
    const projectRoot = await createProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: [
          "apps/*",
          "apps/api/*",
          "packages/*",
          "packages/embeds/*",
          "packages/app-store",
          "packages/app-store/*",
          "example-apps/*",
        ],
      }),
      "apps/api/package.json": JSON.stringify({ name: "@acme/api" }),
      "apps/api/v2/package.json": JSON.stringify({ name: "@acme/api-v2" }),
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "example-apps/credential-sync/package.json": JSON.stringify({
        name: "@acme/example-credential-sync",
      }),
      "packages/app-store/package.json": JSON.stringify({ name: "@acme/app-store" }),
      "packages/app-store/calendar/package.json": JSON.stringify({
        name: "@acme/calendar",
      }),
      "packages/embeds/react/package.json": JSON.stringify({ name: "@acme/embed-react" }),
      "packages/ui/package.json": JSON.stringify({ name: "@acme/ui" }),
    });

    expect(discoverWorkspacePackages(projectRoot)).toEqual([
      { name: "@acme/api", path: "apps/api", kind: "app" },
      { name: "@acme/api-v2", path: "apps/api/v2", kind: "app" },
      { name: "@acme/web", path: "apps/web", kind: "app" },
      {
        name: "@acme/example-credential-sync",
        path: "example-apps/credential-sync",
        kind: "example",
      },
      { name: "@acme/app-store", path: "packages/app-store", kind: "package" },
      { name: "@acme/calendar", path: "packages/app-store/calendar", kind: "package" },
      { name: "@acme/embed-react", path: "packages/embeds/react", kind: "package" },
      { name: "@acme/ui", path: "packages/ui", kind: "package" },
    ]);
  });
});
