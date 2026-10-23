import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EXPECTED_TOOLS = [
  "get_file_owner",
  "get_file_risk",
  "get_reading_path",
  "get_trend",
  "list_hotspots",
  "run_scan",
  "search_findings",
] as const;

const FRAMES = [
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bin-symlink-test","version":"1"}}}',
  '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
].join("\n");

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const mcpPackageRoot = join(repoRoot, "packages", "mcp");
const distEntry = join(mcpPackageRoot, "dist", "index.js");
const cliDistEntry = join(repoRoot, "packages", "cli", "dist", "index.js");

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
};

type Transcript = {
  stdout: string;
  stderr: string;
  code: number | null;
};

const parseJsonRpcLines = (stdout: string): JsonRpcMessage[] =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonRpcMessage);

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
};

const findResponse = (
  messages: readonly JsonRpcMessage[],
  id: number,
): JsonRpcMessage | undefined => messages.find((message) => message.id === id);

const resultOf = (message: JsonRpcMessage | undefined, id: number): Record<string, unknown> => {
  if (message === undefined) {
    throw new Error(`missing JSON-RPC response with id ${id}`);
  }
  return asRecord(message.result, `result for id ${id}`);
};

const readToolNames = (result: Record<string, unknown>): string[] => {
  const tools = result["tools"];
  if (!Array.isArray(tools)) {
    throw new Error("tools/list result did not contain a tools array");
  }
  return tools.map((tool) => {
    const record = asRecord(tool, "tool entry");
    const name = record["name"];
    if (typeof name !== "string") {
      throw new Error("tool entry did not contain a string name");
    }
    return name;
  });
};

const npmFailure = (command: string, error: unknown): Error => {
  if (typeof error === "object" && error !== null) {
    const details = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const stdout = typeof details.stdout === "string" ? details.stdout : "";
    const stderr = typeof details.stderr === "string" ? details.stderr : "";
    const message = typeof details.message === "string" ? details.message : String(error);
    return new Error(`${command} failed: ${message}\n${stderr}${stdout}`);
  }
  return new Error(`${command} failed: ${String(error)}`);
};

const runTranscript = (binPath: string): Promise<Transcript> =>
  new Promise((resolve, reject) => {
    const child = spawn(binPath, [], {
      env: {
        ...process.env,
        CODESENTINEL_ROOT: repoRoot,
        CODESENTINEL_LOG_LEVEL: "silent",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let receivedToolsList = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      return true;
    };

    const fail = (error: Error): void => {
      if (settle()) {
        reject(error);
      }
    };

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new Error(
          `codesentinel-mcp did not respond within 20000ms\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 20_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!receivedToolsList && stdout.includes('"id":2')) {
        receivedToolsList = true;
        child.stdin.end();
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.stdin.on("error", () => {});

    child.on("error", (error) => {
      fail(
        new Error(
          `failed to spawn ${binPath}: ${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (!receivedToolsList) {
        fail(
          new Error(
            `codesentinel-mcp exited before the tools/list response\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      if (settle()) {
        resolve({ stdout, stderr, code });
      }
    });

    child.stdin.write(`${FRAMES}\n`);
  });

describe("packed codesentinel-mcp bin", () => {
  let workRoot: string | undefined;
  let projectDir: string | undefined;
  let binPath: string | undefined;

  beforeAll(async () => {
    for (const entry of [distEntry, cliDistEntry]) {
      if (!existsSync(entry)) {
        throw new Error(`Missing ${entry}. Run "pnpm build" before this integration test.`);
      }
    }

    workRoot = await mkdtemp(join(tmpdir(), "codesentinel-mcp-pack-"));
    const copiedPackage = join(workRoot, "mcp");
    await cp(mcpPackageRoot, copiedPackage, {
      recursive: true,
      filter: (source) => !source.split(sep).includes("node_modules"),
    });

    const manifestPath = join(copiedPackage, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      [key: string]: unknown;
    };
    const dependencies = manifest.dependencies;
    if (dependencies === undefined) {
      throw new Error("copied package.json has no dependencies");
    }
    if (dependencies["@getcodesentinel/codesentinel"] !== "workspace:*") {
      throw new Error("copied package.json does not declare the workspace CLI dependency");
    }
    dependencies["@getcodesentinel/codesentinel"] = `file:${join(repoRoot, "packages", "cli")}`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const packDestination = join(workRoot, "pack");
    await mkdir(packDestination, { recursive: true });
    try {
      execFileSync("npm", ["pack", "--pack-destination", packDestination], {
        cwd: copiedPackage,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      throw npmFailure("npm pack", error);
    }

    const tarballs = (await readdir(packDestination)).filter((name) => name.endsWith(".tgz"));
    expect(tarballs).toHaveLength(1);
    const [tarballName] = tarballs;
    if (tarballName === undefined) {
      throw new Error(`npm pack produced no tarball in ${packDestination}`);
    }
    const tarballPath = join(packDestination, tarballName);

    projectDir = await mkdtemp(join(tmpdir(), "codesentinel-mcp-bin-"));
    await writeFile(
      join(projectDir, "package.json"),
      `${JSON.stringify({ name: "mcp-bin-symlink-fixture", private: true }, null, 2)}\n`,
      "utf8",
    );

    try {
      execFileSync(
        "npm",
        ["install", "--no-audit", "--no-fund", "--no-package-lock", "--silent", tarballPath],
        { cwd: projectDir, encoding: "utf8", stdio: "pipe" },
      );
    } catch (error) {
      throw npmFailure("npm install", error);
    }

    binPath = join(projectDir, "node_modules", ".bin", "codesentinel-mcp");
  }, 180_000);

  afterAll(async () => {
    if (projectDir !== undefined) {
      await rm(projectDir, { recursive: true, force: true });
    }
    if (workRoot !== undefined) {
      await rm(workRoot, { recursive: true, force: true });
    }
  });

  it("serves MCP over the installed .bin symlink", async () => {
    if (binPath === undefined) {
      throw new Error("test setup did not resolve the installed bin");
    }

    const stats = lstatSync(binPath);
    expect(stats.isSymbolicLink()).toBe(true);
    const linkTarget = readlinkSync(binPath);
    expect(linkTarget.endsWith("@getcodesentinel/mcp/dist/index.js")).toBe(true);

    const transcript = await runTranscript(binPath);
    const messages = parseJsonRpcLines(transcript.stdout);

    expect(messages.length).toBeGreaterThanOrEqual(2);
    for (const message of messages) {
      expect(message.jsonrpc).toBe("2.0");
    }

    const initializeResult = resultOf(findResponse(messages, 1), 1);
    const serverInfo = asRecord(initializeResult["serverInfo"], "initialize serverInfo");
    expect(serverInfo["name"]).toBe("codesentinel");
    expect(typeof initializeResult["protocolVersion"]).toBe("string");
    const capabilities = asRecord(initializeResult["capabilities"], "initialize capabilities");
    expect(capabilities["tools"]).toBeDefined();

    const toolsResult = resultOf(findResponse(messages, 2), 2);
    expect(readToolNames(toolsResult)).toEqual([...EXPECTED_TOOLS]);

    expect(transcript.code).toBe(0);
  }, 180_000);
});
