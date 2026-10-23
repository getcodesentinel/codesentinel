import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitIdentityEnvironment,
  createGitFixtureEnvironment,
  runGit,
} from "../test-support/git-fixture.js";

const EXPECTED_TOOLS = [
  "get_file_owner",
  "get_file_risk",
  "get_reading_path",
  "get_trend",
  "list_hotspots",
  "run_scan",
  "search_findings",
] as const;

type McpClient = Client;
type ToolResult = Awaited<ReturnType<McpClient["callTool"]>>;

const tsx = import.meta.resolve("tsx/esm");
const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

const toSpawnEnvironment = (environment: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const createClient = async (
  root: string,
  snapshotsDirectory: string = join(root, ".codesentinel", "snapshots"),
): Promise<{ client: Client; transport: StdioClientTransport }> => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", tsx, cliEntry, "mcp"],
    env: toSpawnEnvironment(
      createGitFixtureEnvironment({
        CODESENTINEL_ROOT: root,
        CODESENTINEL_SNAPSHOTS_DIR: snapshotsDirectory,
        CODESENTINEL_LOG_LEVEL: "silent",
      }),
    ),
    stderr: "pipe",
  });
  const client = new Client({ name: "codesentinel-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
};

const writeFixtureFiles = async (root: string): Promise<void> => {
  await mkdir(join(root, "src", "lib"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "mcp-fixture", private: true }, null, 2),
    "utf8",
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(join(root, "src", "index.ts"), 'export { add } from "./lib/math.js";\n', "utf8");
  await writeFile(
    join(root, "src", "lib", "math.ts"),
    "export const add = (a: number, b: number): number => a + b;\n",
    "utf8",
  );
  await writeFile(
    join(root, ".github", "CODEOWNERS"),
    "* @acme/platform\nsrc/lib/* @acme/math\n",
    "utf8",
  );
};

const commitAll = (
  root: string,
  message: string,
  author: { name: string; email: string },
  authoredAt: string,
): void => {
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", message], commitIdentityEnvironment(author, authoredAt));
};

const writeSnapshots = async (root: string): Promise<void> => {
  const snapshots = join(root, ".codesentinel", "snapshots");
  await mkdir(snapshots, { recursive: true });

  const point = (
    generatedAt: string,
    riskScore: number,
    healthScore: number,
    unownedCriticalCount: number,
  ) =>
    JSON.stringify(
      {
        schemaVersion: "codesentinel.snapshot.v2",
        generatedAt,
        analysis: {
          risk: { riskScore },
          health: { healthScore },
        },
        ownership: {
          available: true,
          metrics: {
            unownedCriticalCount,
            ghostOwnerCount: 1,
            driftPercent: 10,
          },
        },
      },
      null,
      2,
    );

  await writeFile(
    join(snapshots, "2026-01-01.json"),
    point("2026-01-01T00:00:00.000Z", 42.5, 70.5, 2),
    "utf8",
  );
  await writeFile(
    join(snapshots, "2026-02-01.json"),
    point("2026-02-01T00:00:00.000Z", 55.5, 68.5, 3),
    "utf8",
  );
};

const toolText = (result: ToolResult): string => {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("tool result did not contain text content");
  }
  return first.text;
};

const toolErrorCode = (result: ToolResult): string => {
  expect(result.isError).toBe(true);
  const parsed = JSON.parse(toolText(result)) as { error: { code: string } };
  return parsed.error.code;
};

const structured = (result: ToolResult): Record<string, unknown> => {
  expect(result.isError).toBeFalsy();
  if (result.structuredContent === undefined || result.structuredContent === null) {
    throw new Error("tool result did not contain structured content");
  }
  return result.structuredContent as Record<string, unknown>;
};

describe("MCP server", () => {
  let fixture: string;
  let client: Client;

  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), "codesentinel-mcp-"));
    runGit(fixture, ["init", "-b", "main"]);
    await writeFixtureFiles(fixture);

    commitAll(
      fixture,
      "initial",
      { name: "Alice", email: "alice@example.com" },
      "2026-09-01T10:00:00Z",
    );
    await writeFile(
      join(fixture, "src", "lib", "math.ts"),
      "export const add = (a: number, b: number): number => a + b;\nexport const sub = (a: number, b: number): number => a - b;\n",
      "utf8",
    );
    commitAll(
      fixture,
      "extend math",
      { name: "Bob", email: "bob@example.com" },
      "2026-09-02T10:00:00Z",
    );

    await writeFile(join(fixture, "untracked.txt"), "not tracked\n", "utf8");
    await writeSnapshots(fixture);

    const created = await createClient(fixture);
    client = created.client;
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    if (fixture !== undefined) {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("lists the tools in deterministic order with annotations and schemas", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOLS]);
    for (const tool of tools) {
      expect(tool.inputSchema).toBeTypeOf("object");
      expect(tool.outputSchema).toBeTypeOf("object");
      expect(tool.annotations?.readOnlyHint).toBe(tool.name !== "run_scan");
    }
    expect(JSON.stringify(tools)).toMatchSnapshot();
  });

  it("calls every tool successfully", async () => {
    const owner = structured(
      await client.callTool({
        name: "get_file_owner",
        arguments: { path: "src/lib/math.ts" },
      }),
    );
    expect(owner["path"]).toBe("src/lib/math.ts");
    expect(owner["owners"]).toContainEqual({ kind: "team", value: "@acme/math" });
    expect(typeof owner["status"]).toBe("string");

    const risk = structured(
      await client.callTool({
        name: "get_file_risk",
        arguments: { path: "src/lib/math.ts" },
      }),
    );
    expect(typeof risk["score"]).toBe("number");
    expect(typeof risk["normalizedScore"]).toBe("number");
    const riskFactors = risk["factors"] as Record<string, unknown>;
    expect(typeof riskFactors["structural"]).toBe("number");
    expect(typeof riskFactors["evolution"]).toBe("number");
    expect(typeof riskFactors["external"]).toBe("number");

    const reading = structured(
      await client.callTool({
        name: "get_reading_path",
        arguments: { target: "src", maxSteps: 3 },
      }),
    );
    const steps = reading["steps"] as { order: number; reason: string }[];
    expect(steps[0]?.order).toBe(1);
    expect(typeof steps[0]?.reason).toBe("string");

    const trend = structured(
      await client.callTool({
        name: "get_trend",
        arguments: { metric: "riskScore" },
      }),
    );
    const series = trend["series"] as { generatedAt: string; value: number | null }[];
    expect(series.map((point) => point.generatedAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
    expect(series.map((point) => point.value)).toEqual([42.5, 55.5]);
    expect(trend["snapshotCount"]).toBe(2);

    const hotspots = structured(
      await client.callTool({
        name: "list_hotspots",
        arguments: { limit: 1 },
      }),
    );
    const hotspotPage = hotspots["hotspots"] as { rank: number }[];
    expect(hotspotPage[0]?.rank).toBe(1);

    const findings = structured(
      await client.callTool({
        name: "search_findings",
        arguments: { limit: 5 },
      }),
    );
    const findingPage = findings["findings"] as { rule: string }[];
    expect(findingPage.length).toBeGreaterThan(0);
    expect(findingPage[0]?.rule).toMatch(/^ownership\//);

    await writeFile(
      join(fixture, "src", "lib", "math.ts"),
      "export const add = (a: number, b: number): number => a + b + 1;\n",
      "utf8",
    );
    const scan = structured(
      await client.callTool({
        name: "run_scan",
        arguments: { changedOnly: true },
      }),
    );
    const snapshotPath = scan["snapshotPath"];
    expect(typeof snapshotPath).toBe("string");
    expect(existsSync(snapshotPath as string)).toBe(true);
    expect(dirname(snapshotPath as string)).toBe(join(fixture, ".codesentinel", "snapshots"));
    expect(JSON.parse(await readFile(snapshotPath as string, "utf8"))).toMatchObject({
      schemaVersion: "codesentinel.snapshot.v2",
    });
    expect(scan["scope"]).toBe("working_tree_changed");
    expect(scan["changedFiles"]).toContain("src/lib/math.ts");
  }, 120_000);

  it("returns structured tool errors", async () => {
    const outside = await client.callTool({
      name: "get_file_owner",
      arguments: { path: "../../etc/passwd" },
    });
    expect(toolErrorCode(outside)).toBe("path_outside_root");

    const untracked = await client.callTool({
      name: "get_file_owner",
      arguments: { path: "untracked.txt" },
    });
    expect(toolErrorCode(untracked)).toBe("path_not_tracked");

    const perFileTrend = await client.callTool({
      name: "get_trend",
      arguments: { metric: "riskScore", path: "src/index.ts" },
    });
    expect(toolErrorCode(perFileTrend)).toBe("not_supported");

    const badCursor = await client.callTool({
      name: "search_findings",
      arguments: { cursor: "garbage" },
    });
    expect(toolErrorCode(badCursor)).toBe("invalid_argument");

    const missingScanPath = await client.callTool({
      name: "run_scan",
      arguments: { path: "does-not-exist" },
    });
    expect(toolErrorCode(missingScanPath)).toBe("path_not_found");
  }, 120_000);

  it("rejects run_scan outside a git work tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codesentinel-mcp-nongit-"));
    const created = await createClient(directory, join(directory, "snapshots"));
    try {
      const result = await created.client.callTool({
        name: "run_scan",
        arguments: {},
      });
      expect(toolErrorCode(result)).toBe("not_a_git_repository");
    } finally {
      await created.client.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
