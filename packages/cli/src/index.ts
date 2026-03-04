import { Command, Option } from "commander";
import { analyzeDependencyCandidateFromRegistry } from "@codesentinel/dependency-firewall";
import { EXIT_CODES, type GateConfig } from "@codesentinel/governance";
import {
  compareSnapshots,
  createReport,
  createSnapshot,
  formatReport,
  parseSnapshot,
  type ReportFormat,
} from "@codesentinel/reporter";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatAnalyzeOutput,
  type AnalyzeOutputMode,
} from "./application/format-analyze-output.js";
import { formatExplainOutput } from "./application/format-explain-output.js";
import {
  formatDependencyRiskOutput,
  type DependencyRiskOutputMode,
} from "./application/format-dependency-risk-output.js";
import { createStderrLogger, parseLogLevel, type LogLevel } from "./application/logger.js";
import { checkForCliUpdates } from "./application/check-for-updates.js";
import {
  runAnalyzeCommand,
  type AuthorIdentityCliMode,
  type RiskProfileCliMode,
} from "./application/run-analyze-command.js";
import {
  GovernanceConfigurationError as CheckConfigurationError,
  runCheckCommand,
  type CheckOutputFormat,
} from "./application/run-check-command.js";
import {
  GovernanceConfigurationError as CiConfigurationError,
  runCiCommand,
} from "./application/run-ci-command.js";
import { runReportCommand } from "./application/run-report-command.js";
import { runExplainCommand, type ExplainFormat } from "./application/run-explain-command.js";

const program = new Command();
const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

const parseRecentWindowDays = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--recent-window-days must be a positive integer");
  }
  return parsed;
};

const stripLeadingMarkdownHeading = (value: string, heading: string): string => {
  const prefix = `${heading}\n`;
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length).trimStart();
  }

  return value;
};

const riskProfileOption = (): Option =>
  new Option(
    "--risk-profile <profile>",
    "risk profile: default (balanced) or personal (down-weights single-maintainer ownership penalties)",
  )
    .choices(["default", "personal"])
    .default("default");

program
  .name("codesentinel")
  .description("Structural and evolutionary risk analysis for TypeScript/JavaScript codebases")
  .version(version);

program
  .command("analyze")
  .argument("[path]", "path to the project to analyze")
  .addOption(riskProfileOption())
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .addOption(
    new Option("--output <mode>", "output mode: summary (default) or json (full analysis object)")
      .choices(["summary", "json"])
      .default("summary"),
  )
  .option("--json", "shortcut for --output json")
  .addOption(
    new Option(
      "--recent-window-days <days>",
      "git recency window in days used for evolution volatility metrics",
    )
      .argParser(parseRecentWindowDays)
      .default(30),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        riskProfile: RiskProfileCliMode;
        logLevel: LogLevel;
        output: AnalyzeOutputMode;
        json?: boolean;
        recentWindowDays: number;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const summary = await runAnalyzeCommand(
        path,
        options.authorIdentity,
        { recentWindowDays: options.recentWindowDays, riskProfile: options.riskProfile },
        logger,
      );
      const outputMode: AnalyzeOutputMode = options.json === true ? "json" : options.output;
      process.stdout.write(`${formatAnalyzeOutput(summary, outputMode)}\n`);
    },
  );

program
  .command("explain")
  .argument("[path]", "path to the project to analyze")
  .addOption(riskProfileOption())
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .option("--file <path>", "explain a specific file target")
  .option("--module <name>", "explain a specific module target")
  .option("--top <count>", "number of top hotspots to explain when no target is selected", "5")
  .addOption(
    new Option(
      "--recent-window-days <days>",
      "git recency window in days used for evolution volatility metrics",
    )
      .argParser(parseRecentWindowDays)
      .default(30),
  )
  .addOption(
    new Option("--format <mode>", "output format: text, json, md")
      .choices(["text", "json", "md"])
      .default("md"),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        riskProfile: RiskProfileCliMode;
        logLevel: LogLevel;
        file?: string;
        module?: string;
        top: string;
        recentWindowDays: number;
        format: ExplainFormat;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const top = Number.parseInt(options.top, 10);
      const explainOptions = {
        ...(options.file === undefined ? {} : { file: options.file }),
        ...(options.module === undefined ? {} : { module: options.module }),
        top: Number.isFinite(top) ? top : 5,
        recentWindowDays: options.recentWindowDays,
        riskProfile: options.riskProfile,
        format: options.format,
      };
      const result = await runExplainCommand(path, options.authorIdentity, explainOptions, logger);
      process.stdout.write(`${formatExplainOutput(result, options.format)}\n`);
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .addOption(
    new Option("--output <mode>", "output mode: summary (default) or json (full analysis object)")
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

program
  .command("report")
  .argument("[path]", "path to the project to analyze")
  .addOption(riskProfileOption())
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .addOption(
    new Option("--format <mode>", "output format: text, json, md")
      .choices(["text", "json", "md"])
      .default("md"),
  )
  .option("--output <path>", "write rendered report to a file path")
  .option("--compare <baseline>", "compare against a baseline snapshot JSON file")
  .option("--snapshot <path>", "write current snapshot JSON artifact")
  .option("--no-trace", "disable trace embedding in generated snapshot")
  .addOption(
    new Option(
      "--recent-window-days <days>",
      "git recency window in days used for evolution volatility metrics",
    )
      .argParser(parseRecentWindowDays)
      .default(30),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        riskProfile: RiskProfileCliMode;
        logLevel: LogLevel;
        format: "text" | "json" | "md";
        output?: string;
        compare?: string;
        snapshot?: string;
        trace: boolean;
        recentWindowDays: number;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const result = await runReportCommand(
        path,
        options.authorIdentity,
        {
          format: options.format,
          ...(options.output === undefined ? {} : { outputPath: options.output }),
          ...(options.compare === undefined ? {} : { comparePath: options.compare }),
          ...(options.snapshot === undefined ? {} : { snapshotPath: options.snapshot }),
          includeTrace: options.trace,
          riskProfile: options.riskProfile,
          recentWindowDays: options.recentWindowDays,
        },
        logger,
      );

      if (options.output === undefined) {
        process.stdout.write(`${result.rendered}\n`);
      }
    },
  );

program
  .command("run")
  .argument("[path]", "path to the project to analyze")
  .addOption(riskProfileOption())
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .addOption(
    new Option("--format <mode>", "combined output format: text, md, json")
      .choices(["text", "md", "json"])
      .default("text"),
  )
  .option("--file <path>", "explain a specific file target")
  .option("--module <name>", "explain a specific module target")
  .option("--top <count>", "number of top hotspots to explain when no target is selected", "5")
  .option("--compare <baseline>", "compare against a baseline snapshot JSON file")
  .option("--snapshot <path>", "write current snapshot JSON artifact")
  .option("--no-trace", "disable trace embedding in generated snapshot")
  .addOption(
    new Option(
      "--recent-window-days <days>",
      "git recency window in days used for evolution volatility metrics",
    )
      .argParser(parseRecentWindowDays)
      .default(30),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        riskProfile: RiskProfileCliMode;
        logLevel: LogLevel;
        format: "text" | "md" | "json";
        file?: string;
        module?: string;
        top: string;
        compare?: string;
        snapshot?: string;
        trace: boolean;
        recentWindowDays: number;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);
      const top = Number.parseInt(options.top, 10);

      const explain = await runExplainCommand(
        path,
        options.authorIdentity,
        {
          ...(options.file === undefined ? {} : { file: options.file }),
          ...(options.module === undefined ? {} : { module: options.module }),
          top: Number.isFinite(top) ? top : 5,
          format: options.format as ExplainFormat,
          recentWindowDays: options.recentWindowDays,
          riskProfile: options.riskProfile,
        },
        logger,
      );

      const snapshot = createSnapshot({
        analysis: explain.summary,
        ...(options.trace === true ? { trace: explain.trace } : {}),
      });

      if (options.snapshot !== undefined) {
        await writeFile(options.snapshot, JSON.stringify(snapshot, null, 2), "utf8");
        logger.info(`snapshot written: ${options.snapshot}`);
      }

      const report =
        options.compare === undefined
          ? createReport(snapshot)
          : createReport(
              snapshot,
              compareSnapshots(snapshot, parseSnapshot(await readFile(options.compare, "utf8"))),
            );

      if (options.format === "json") {
        process.stdout.write(
          `${JSON.stringify(
            {
              schemaVersion: "codesentinel.run.v1",
              generatedAt: new Date().toISOString(),
              analyze: explain.summary,
              explain,
              report,
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      const analyzeRendered = formatAnalyzeOutput(explain.summary, "summary");
      const explainRendered = formatExplainOutput(explain, options.format);
      const reportRendered = formatReport(report, options.format as ReportFormat);

      if (options.format === "md") {
        const explainSection = stripLeadingMarkdownHeading(
          explainRendered,
          "# CodeSentinel Explanation",
        );
        const reportSection = stripLeadingMarkdownHeading(reportRendered, "# CodeSentinel Report");

        process.stdout.write(
          `# CodeSentinel Run\n\n## Analyze\n\`\`\`json\n${analyzeRendered}\n\`\`\`\n\n## Explain\n${explainSection}\n\n## Report\n${reportSection}\n`,
        );
        return;
      }

      process.stdout.write(
        `CodeSentinel Run\n\nAnalyze\n${analyzeRendered}\n\nExplain\n${explainRendered}\n\nReport\n${reportRendered}\n`,
      );
    },
  );

const parseGateNumber = (value: string | undefined, optionName: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new CheckConfigurationError(`${optionName} must be numeric`);
  }

  return parsed;
};

const collectOptionValues = (value: string, previous: string[] = []): string[] => {
  return [...previous, value];
};

const parseMainBranches = (options: {
  mainBranch?: string[];
  mainBranches?: string;
}): readonly string[] | undefined => {
  const fromRepeated = options.mainBranch ?? [];
  const fromCsv =
    options.mainBranches === undefined
      ? []
      : options.mainBranches
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

  const merged = [...fromRepeated, ...fromCsv];
  if (merged.length === 0) {
    return undefined;
  }

  const unique = Array.from(new Set(merged));
  return unique.length > 0 ? unique : undefined;
};

const buildGateConfigFromOptions = (options: {
  maxRepoDelta?: string;
  noNewCycles?: boolean;
  noNewHighRiskDeps?: boolean;
  maxNewHotspots?: string;
  maxRepoScore?: string;
  newHotspotScoreThreshold?: string;
  failOn: "error" | "warn";
}): GateConfig => {
  const maxRepoDelta = parseGateNumber(options.maxRepoDelta, "--max-repo-delta");
  const maxNewHotspots = parseGateNumber(options.maxNewHotspots, "--max-new-hotspots");
  const maxRepoScore = parseGateNumber(options.maxRepoScore, "--max-repo-score");
  const newHotspotScoreThreshold = parseGateNumber(
    options.newHotspotScoreThreshold,
    "--new-hotspot-score-threshold",
  );

  return {
    ...(maxRepoDelta === undefined ? {} : { maxRepoDelta }),
    ...(options.noNewCycles === true ? { noNewCycles: true } : {}),
    ...(options.noNewHighRiskDeps === true ? { noNewHighRiskDeps: true } : {}),
    ...(maxNewHotspots === undefined ? {} : { maxNewHotspots }),
    ...(maxRepoScore === undefined ? {} : { maxRepoScore }),
    ...(newHotspotScoreThreshold === undefined ? {} : { newHotspotScoreThreshold }),
    failOn: options.failOn,
  };
};

program
  .command("check")
  .argument("[path]", "path to the project to analyze")
  .addOption(riskProfileOption())
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .option("--compare <baseline>", "baseline snapshot path")
  .option("--max-repo-delta <value>", "maximum allowed normalized repository score increase")
  .option("--no-new-cycles", "fail if new structural cycles are introduced")
  .option("--no-new-high-risk-deps", "fail if new high-risk direct dependencies are introduced")
  .option("--max-new-hotspots <count>", "maximum allowed number of new hotspots")
  .option("--new-hotspot-score-threshold <score>", "minimum hotspot score to count as new hotspot")
  .option("--max-repo-score <score>", "absolute repository score limit (0..100)")
  .addOption(
    new Option("--fail-on <level>", "failing severity threshold")
      .choices(["error", "warn"])
      .default("error"),
  )
  .addOption(
    new Option("--format <mode>", "output format: text, json, md")
      .choices(["text", "json", "md"])
      .default("text"),
  )
  .option("--output <path>", "write check output to a file path")
  .option("--no-trace", "disable trace embedding in generated snapshot")
  .addOption(
    new Option(
      "--recent-window-days <days>",
      "git recency window in days used for evolution volatility metrics",
    )
      .argParser(parseRecentWindowDays)
      .default(30),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        riskProfile: RiskProfileCliMode;
        logLevel: LogLevel;
        compare?: string;
        maxRepoDelta?: string;
        noNewCycles?: boolean;
        noNewHighRiskDeps?: boolean;
        maxNewHotspots?: string;
        newHotspotScoreThreshold?: string;
        maxRepoScore?: string;
        failOn: "error" | "warn";
        format: CheckOutputFormat;
        output?: string;
        trace: boolean;
        recentWindowDays: number;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);

      try {
        const gateConfig = buildGateConfigFromOptions(options);
        const result = await runCheckCommand(
          path,
          options.authorIdentity,
          {
            ...(options.compare === undefined ? {} : { baselinePath: options.compare }),
            includeTrace: options.trace,
            riskProfile: options.riskProfile,
            recentWindowDays: options.recentWindowDays,
            gateConfig,
            outputFormat: options.format,
            ...(options.output === undefined ? {} : { outputPath: options.output }),
          },
          logger,
        );

        if (options.output === undefined) {
          process.stdout.write(`${result.rendered}\n`);
        }

        process.exitCode = result.gateResult.exitCode;
      } catch (error) {
        if (error instanceof CheckConfigurationError) {
          logger.error(error.message);
          process.exitCode = EXIT_CODES.invalidConfiguration;
          return;
        }

        logger.error(error instanceof Error ? error.message : "internal error");
        process.exitCode = EXIT_CODES.internalError;
      }
    },
  );

program
  .command("ci")
  .argument("[path]", "path to the project to analyze")
  .addOption(riskProfileOption())
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
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .option("--baseline <path>", "baseline snapshot path")
  .option(
    "--baseline-ref <gitRef>",
    "resolve baseline snapshot from a git reference (for example origin/main)",
  )
  .option(
    "--baseline-sha <sha>",
    "explicit baseline commit SHA (only valid with --baseline-ref auto)",
  )
  .addOption(
    new Option(
      "--main-branch <name>",
      "add a default branch candidate for auto baseline resolution (repeatable)",
    ).argParser(collectOptionValues),
  )
  .option(
    "--main-branches <names>",
    "comma-separated default branch candidates for auto baseline resolution (for example: main,master)",
  )
  .option("--snapshot <path>", "write current snapshot JSON to path")
  .option("--report <path>", "write markdown CI summary report")
  .option("--json-output <path>", "write machine-readable CI JSON output")
  .option("--max-repo-delta <value>", "maximum allowed normalized repository score increase")
  .option("--no-new-cycles", "fail if new structural cycles are introduced")
  .option("--no-new-high-risk-deps", "fail if new high-risk direct dependencies are introduced")
  .option("--max-new-hotspots <count>", "maximum allowed number of new hotspots")
  .option("--new-hotspot-score-threshold <score>", "minimum hotspot score to count as new hotspot")
  .option("--max-repo-score <score>", "absolute repository score limit (0..100)")
  .addOption(
    new Option("--fail-on <level>", "failing severity threshold")
      .choices(["error", "warn"])
      .default("error"),
  )
  .option("--no-trace", "disable trace embedding in generated snapshot")
  .addOption(
    new Option(
      "--recent-window-days <days>",
      "git recency window in days used for evolution volatility metrics",
    )
      .argParser(parseRecentWindowDays)
      .default(30),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        authorIdentity: AuthorIdentityCliMode;
        riskProfile: RiskProfileCliMode;
        logLevel: LogLevel;
        baseline?: string;
        baselineRef?: string;
        baselineSha?: string;
        mainBranch?: string[];
        mainBranches?: string;
        snapshot?: string;
        report?: string;
        jsonOutput?: string;
        maxRepoDelta?: string;
        noNewCycles?: boolean;
        noNewHighRiskDeps?: boolean;
        maxNewHotspots?: string;
        newHotspotScoreThreshold?: string;
        maxRepoScore?: string;
        failOn: "error" | "warn";
        trace: boolean;
        recentWindowDays: number;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);

      try {
        const gateConfig = buildGateConfigFromOptions(options);
        const mainBranchCandidates = parseMainBranches(options);
        const result = await runCiCommand(
          path,
          options.authorIdentity,
          {
            ...(options.baseline === undefined ? {} : { baselinePath: options.baseline }),
            ...(options.baselineRef === undefined ? {} : { baselineRef: options.baselineRef }),
            ...(options.baselineSha === undefined ? {} : { baselineSha: options.baselineSha }),
            ...(mainBranchCandidates === undefined ? {} : { mainBranchCandidates }),
            ...(options.snapshot === undefined ? {} : { snapshotPath: options.snapshot }),
            ...(options.report === undefined ? {} : { reportPath: options.report }),
            ...(options.jsonOutput === undefined ? {} : { jsonOutputPath: options.jsonOutput }),
            includeTrace: options.trace,
            riskProfile: options.riskProfile,
            recentWindowDays: options.recentWindowDays,
            gateConfig,
          },
          logger,
        );

        if (options.report === undefined) {
          process.stdout.write(`${result.markdownSummary}\n`);
        }

        process.exitCode = result.gateResult.exitCode;
      } catch (error) {
        if (error instanceof CiConfigurationError) {
          logger.error(error.message);
          process.exitCode = EXIT_CODES.invalidConfiguration;
          return;
        }

        logger.error(error instanceof Error ? error.message : "internal error");
        process.exitCode = EXIT_CODES.internalError;
      }
    },
  );

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

const executablePath = process.argv[0] ?? "";
const scriptPath = process.argv[1] ?? "";

const argv =
  process.argv[2] === "--" ? [executablePath, scriptPath, ...process.argv.slice(3)] : process.argv;

if (argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await checkForCliUpdates({
  packageName: "@getcodesentinel/codesentinel",
  currentVersion: version,
  argv: process.argv,
  env: process.env,
});

await program.parseAsync(argv);
