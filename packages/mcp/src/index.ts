import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const spawnCodesentinelMcp = (argv: readonly string[]): ChildProcess => {
  const cliEntry = require.resolve("@getcodesentinel/codesentinel");
  const child = spawn(process.execPath, [cliEntry, "mcp", ...argv], {
    stdio: "inherit",
    env: process.env,
  });

  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  const cleanup = (): void => {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  };

  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  child.on("exit", (code) => {
    cleanup();
    process.exitCode = code ?? 1;
  });
  child.on("error", () => {
    cleanup();
    process.exitCode = 1;
  });

  return child;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  spawnCodesentinelMcp(process.argv.slice(2));
}
