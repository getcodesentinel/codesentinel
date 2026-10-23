import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitIdentityEnvironment,
  createGitFixtureEnvironment,
  runGit,
} from "../test-support/git-fixture.js";

const tsx = import.meta.resolve("tsx/esm");
const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

const frames = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "stdout-purity", version: "1" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_file_owner", arguments: { path: "src/lib/math.ts" } },
  },
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "search_findings", arguments: { limit: 5 } },
  },
];

const createFixture = async (): Promise<string> => {
  const fixture = await mkdtemp(join(tmpdir(), "codesentinel-mcp-purity-"));
  await mkdir(join(fixture, "src", "lib"), { recursive: true });
  await mkdir(join(fixture, ".github"), { recursive: true });
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ name: "purity-fixture", private: true }, null, 2),
    "utf8",
  );
  await writeFile(
    join(fixture, "tsconfig.json"),
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
  await writeFile(
    join(fixture, "src", "index.ts"),
    'export { add } from "./lib/math.js";\n',
    "utf8",
  );
  await writeFile(
    join(fixture, "src", "lib", "math.ts"),
    "export const add = (a: number, b: number): number => a + b;\n",
    "utf8",
  );
  await writeFile(
    join(fixture, ".github", "CODEOWNERS"),
    "* @acme/platform\nsrc/lib/* @acme/math\n",
    "utf8",
  );

  runGit(fixture, ["init", "-b", "main"]);
  runGit(fixture, ["add", "-A"]);
  runGit(
    fixture,
    ["commit", "-m", "initial"],
    commitIdentityEnvironment(
      { name: "Alice", email: "alice@example.com" },
      "2026-09-01T10:00:00Z",
    ),
  );
  return fixture;
};

const runServer = (
  fixture: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", tsx, cliEntry, "mcp"], {
      env: createGitFixtureEnvironment({
        CODESENTINEL_ROOT: fixture,
        CODESENTINEL_LOG_LEVEL: "debug",
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ stdout, stderr, exitCode });
    });

    child.stdin.write(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
    child.stdin.end();
  });

describe("stdio stdout purity", () => {
  let fixture: string;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 120_000);

  afterAll(async () => {
    if (fixture !== undefined) {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("writes only JSON-RPC messages to stdout and logs to stderr", async () => {
    const result = await runServer(fixture);
    const lines = result.stdout.split("\n").filter((line) => line.length > 0);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const message = JSON.parse(line) as { jsonrpc?: string };
      expect(message.jsonrpc).toBe("2.0");
    }

    expect(result.stdout).not.toContain("[codesentinel]");
    expect(result.stderr.split("\n").filter((line) => line.length > 0).length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  }, 120_000);
});
