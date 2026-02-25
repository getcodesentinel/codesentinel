import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStderrLogger, parseLogLevel, type LogLevel } from "./application/logger.js";
import { runAnalyzeCommand, type AuthorIdentityCliMode } from "./application/run-analyze-command.js";

const program = new Command();
const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

program
  .name("codesentinel")
  .description("Structural and evolutionary risk analysis for TypeScript/JavaScript codebases")
  .version(version);

program
  .command("analyze")
  .argument("[path]", "path to the project to analyze")
  .addOption(
    new Option(
      "--author-identity <mode>",
      "author identity mode: likely_merge (heuristic) or strict_email (deterministic)",
    )
      .choices(["likely_merge", "strict_email"])
      .default("likely_merge"),
  )
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"]) as LogLevel),
  )
  .action(
    async (
      path: string | undefined,
      options: { authorIdentity: AuthorIdentityCliMode; logLevel: LogLevel },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const output = await runAnalyzeCommand(path, options.authorIdentity, logger);
      process.stdout.write(`${output}\n`);
    },
  );

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

const executablePath = process.argv[0] ?? "";
const scriptPath = process.argv[1] ?? "";

const argv =
  process.argv[2] === "--"
    ? [executablePath, scriptPath, ...process.argv.slice(3)]
    : process.argv;

if (argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(argv);
