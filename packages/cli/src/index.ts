import { Command, Option } from "commander";
import { analyzeDependencyCandidateFromRegistry } from "@codesentinel/dependency-firewall";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatAnalyzeOutput, type AnalyzeOutputMode } from "./application/format-analyze-output.js";
import {
  formatDependencyRiskOutput,
  type DependencyRiskOutputMode,
} from "./application/format-dependency-risk-output.js";
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
  .addOption(
    new Option(
      "--output <mode>",
      "output mode: summary (default) or json (full analysis object)",
    )
      .choices(["summary", "json"])
      .default("summary"),
  )
  .option("--json", "shortcut for --output json")
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        logLevel: LogLevel;
        output: AnalyzeOutputMode;
        json?: boolean;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const summary = await runAnalyzeCommand(path, options.authorIdentity, logger);
      const outputMode: AnalyzeOutputMode = options.json === true ? "json" : options.output;
      process.stdout.write(`${formatAnalyzeOutput(summary, outputMode)}\n`);
    },
  );

program
  .command("dependency-risk")
  .argument("<dependency>", "dependency spec to evaluate (for example: react or react@19.0.0)")
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"]) as LogLevel),
  )
  .addOption(
    new Option(
      "--output <mode>",
      "output mode: summary (default) or json (full analysis object)",
    )
      .choices(["summary", "json"])
      .default("summary"),
  )
  .option("--json", "shortcut for --output json")
  .option("--max-nodes <count>", "maximum dependency nodes to resolve", "250")
  .option("--max-depth <count>", "maximum dependency depth to traverse", "6")
  .action(
    async (
      dependency: string,
      options: {
        logLevel: LogLevel;
        output: DependencyRiskOutputMode;
        json?: boolean;
        maxNodes: string;
        maxDepth: string;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const maxNodes = Number.parseInt(options.maxNodes, 10);
      const maxDepth = Number.parseInt(options.maxDepth, 10);

      logger.info(`analyzing dependency candidate: ${dependency}`);
      const result = await analyzeDependencyCandidateFromRegistry({
        dependency,
        maxNodes: Number.isFinite(maxNodes) ? maxNodes : 250,
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : 6,
      });
      if (result.available) {
        logger.info(
          `dependency analysis completed (${result.dependency.name}@${result.dependency.resolvedVersion})`,
        );
      } else {
        logger.warn(`dependency analysis unavailable: ${result.reason}`);
      }

      const outputMode: DependencyRiskOutputMode = options.json === true ? "json" : options.output;
      process.stdout.write(`${formatDependencyRiskOutput(result, outputMode)}\n`);
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
