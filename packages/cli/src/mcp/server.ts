import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { Logger } from "../application/logger.js";
import { createAnalysisCache } from "./analysis-cache.js";
import { resolveMcpRoot } from "./context.js";
import {
  createGitRunner,
  registerCodeSentinelTools,
  type GitRunner,
  type McpServerContext,
} from "./tools.js";

export const MCP_SERVER_NAME = "codesentinel";

const SERVER_INSTRUCTIONS =
  "CodeSentinel exposes repository ownership, risk, trend and reading-path data from local git history. All tools are read-only except run_scan, which analyzes the repository and writes a snapshot under .codesentinel/snapshots.";

export const setProcessRoot = (root: string): void => {
  process.env["INIT_CWD"] = root;
};

export const createCodeSentinelServer = (options: {
  version: string;
  root?: string;
  logger: Logger;
  git?: GitRunner;
}): McpServer => {
  const root = options.root ?? resolveMcpRoot(process.env);
  setProcessRoot(root);

  const context: McpServerContext = {
    root,
    version: options.version,
    logger: options.logger,
    cache: createAnalysisCache(root, options.logger),
    git: options.git ?? createGitRunner(root),
  };

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: options.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerCodeSentinelTools(server, context);
  return server;
};

export const runMcpServer = async (options: { version: string; logger: Logger }): Promise<void> => {
  const handle = serveStdio(
    () => createCodeSentinelServer({ version: options.version, logger: options.logger }),
    {
      onerror: (error) => options.logger.error(error.message),
    },
  );

  await new Promise<void>((resolveClose) => {
    const close = (): void => {
      process.stdin.off("end", close);
      process.stdin.off("close", close);
      resolveClose();
    };
    process.stdin.once("end", close);
    process.stdin.once("close", close);
  });
  await handle.close();
};
