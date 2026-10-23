import { Command, CommanderError, Option } from "commander";
import { analyzeDependencyCandidateFromRegistry } from "@codesentinel/dependency-firewall";
import { EXIT_CODES, type GateConfig } from "@codesentinel/governance";
import {
  compareSnapshots,
  createReport,
  createSnapshot,
  formatReport,
  parseSnapshot,
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
import { checkForCliUpdates, runManualCliUpdate } from "./application/check-for-updates.js";
import { runInteractiveCliMenu } from "./application/interactive-menu.js";
import {
  runAnalyzeCommand,
  type AuthorIdentityCliMode,
  type ScoringProfileCliMode,
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
import {
  OWNERS_EXIT_CODES,
  OwnersConfigurationError,
  runOwnersCommand,
  type OwnersCommandOptions,
} from "./application/run-owners-command.js";
import type { OwnersFailOn, OwnersOutputFormat } from "./application/format-owners-output.js";
import type { PathOutputFormat } from "./application/format-path-output.js";
import {
  PATH_EXIT_CODES,
  PathConfigurationError,
  runPathCommand,
  type PathCommandOptions,
} from "./application/run-path-command.js";
import { PrCommentConfigurationError } from "./application/format-pr-comment.js";
import { COMMENT_EXIT_CODES, runCommentCommand } from "./application/run-comment-command.js";
import type { PrCommentMode } from "./application/publish-pr-comment.js";
import type { TrendOutputFormat } from "./application/format-trend-output.js";
import {
  runTrendCommand,
  TREND_EXIT_CODES,
  TrendConfigurationError,
} from "./application/run-trend-command.js";
import { runInitCommand, type InitCiMode } from "./application/run-init-command.js";
import { writeHtmlReportBundle } from "./application/html-report.js";
import { openPath } from "./application/open-path.js";
import { runMcpServer } from "./mcp/server.js";

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

type RunDetail = "compact" | "standard" | "full";

const stripLeadingMarkdownHeading = (value: string, heading: string): string => {
  const prefix = `${heading}\n`;
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length).trimStart();
  }

  return value;
};

const extractExplainTextSummary = (text: string): string => {
  const splitIndex = text.search(/\n\n(?:file|module|dependency|repository): /);
  if (splitIndex < 0) {
    return text.trim();
  }

  return text.slice(0, splitIndex).trim();
};

const extractExplainMarkdownSummary = (markdown: string): string => {
  const splitIndex = markdown.search(/\n\n## (?:file|module|dependency|repository): /);
  if (splitIndex < 0) {
    return markdown.trim();
  }

  return markdown.slice(0, splitIndex).trim();
};

const extractSummaryValue = (summary: string, key: string): string | undefined => {
  const prefix = `${key}: `;
  for (const rawLine of summary.split("\n")) {
    const line = rawLine.trimStart();
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }

  return undefined;
};

const renderReportHighlightsText = (
  report: Awaited<ReturnType<typeof runReportCommand>>["report"],
) => {
  const lines: string[] = [];
  lines.push("Repository Summary");
  lines.push(`  target: ${report.repository.targetPath}`);
  lines.push(`  riskScore: ${report.repository.riskScore}`);
  lines.push(`  healthScore: ${report.health.healthScore}`);
  lines.push(`  normalizedScore: ${report.repository.normalizedScore}`);
  lines.push(`  riskTier: ${report.repository.riskTier}`);
  lines.push(`  healthTier: ${report.repository.healthTier}`);
  lines.push("");
  lines.push("Top Hotspots");
  for (const hotspot of report.hotspots.slice(0, 5)) {
    lines.push(`  - ${hotspot.target} | score=${hotspot.score}`);
    lines.push(`    priority actions: ${hotspot.suggestedActions.join(" | ") || "none"}`);
  }

  return lines.join("\n");
};

const renderReportHighlightsMarkdown = (
  report: Awaited<ReturnType<typeof runReportCommand>>["report"],
): string => {
  const lines: string[] = [];
  lines.push("## Repository Summary");
  lines.push(`- target: \`${report.repository.targetPath}\``);
  lines.push(`- riskScore: \`${report.repository.riskScore}\``);
  lines.push(`- healthScore: \`${report.health.healthScore}\``);
  lines.push(`- normalizedScore: \`${report.repository.normalizedScore}\``);
  lines.push(`- riskTier: \`${report.repository.riskTier}\``);
  lines.push(`- healthTier: \`${report.repository.healthTier}\``);
  lines.push("");
  lines.push("## Top Hotspots");
  for (const hotspot of report.hotspots.slice(0, 5)) {
    lines.push(`- **${hotspot.target}** (score: \`${hotspot.score}\`)`);
    lines.push(`  - priority actions: ${hotspot.suggestedActions.join(" | ") || "none"}`);
  }

  return lines.join("\n");
};

const renderCompactText = (
  report: Awaited<ReturnType<typeof runReportCommand>>["report"],
  explainSummary: string,
): string => {
  const lines: string[] = [];
  lines.push("CodeSentinel Run (compact)");
  lines.push("");
  lines.push("Repository");
  lines.push(`  target: ${report.repository.targetPath}`);
  lines.push(`  riskScore: ${report.repository.riskScore}`);
  lines.push(`  healthScore: ${report.health.healthScore}`);
  lines.push(`  riskTier: ${report.repository.riskTier}`);
  lines.push(`  healthTier: ${report.repository.healthTier}`);
  lines.push(
    `  dimensions: structural=${report.repository.dimensionScores.structural ?? "n/a"}, evolution=${report.repository.dimensionScores.evolution ?? "n/a"}, external=${report.repository.dimensionScores.external ?? "n/a"}, interactions=${report.repository.dimensionScores.interactions ?? "n/a"}`,
  );
  lines.push("");
  lines.push(
    `Key Drivers: ${extractSummaryValue(explainSummary, "key drivers") ?? "insufficient data"}`,
  );
  lines.push(
    `Priority Actions: ${extractSummaryValue(explainSummary, "priority actions") ?? "insufficient data"}`,
  );
  lines.push("");
  lines.push("Top Hotspots");
  for (const hotspot of report.hotspots.slice(0, 3)) {
    lines.push(`  - ${hotspot.target} | score=${hotspot.score}`);
  }

  return lines.join("\n");
};

const renderCompactMarkdown = (
  report: Awaited<ReturnType<typeof runReportCommand>>["report"],
  explainSummary: string,
): string => {
  const lines: string[] = [];
  lines.push("# CodeSentinel Run (compact)");
  lines.push("");
  lines.push("## Repository");
  lines.push(`- target: \`${report.repository.targetPath}\``);
  lines.push(`- riskScore: \`${report.repository.riskScore}\``);
  lines.push(`- healthScore: \`${report.health.healthScore}\``);
  lines.push(`- riskTier: \`${report.repository.riskTier}\``);
  lines.push(`- healthTier: \`${report.repository.healthTier}\``);
  lines.push(
    `- dimensions: structural=\`${report.repository.dimensionScores.structural ?? "n/a"}\`, evolution=\`${report.repository.dimensionScores.evolution ?? "n/a"}\`, external=\`${report.repository.dimensionScores.external ?? "n/a"}\`, interactions=\`${report.repository.dimensionScores.interactions ?? "n/a"}\``,
  );
  lines.push("");
  lines.push(
    `- key drivers: ${extractSummaryValue(explainSummary, "- key drivers") ?? "insufficient data"}`,
  );
  lines.push(
    `- priority actions: ${extractSummaryValue(explainSummary, "- priority actions") ?? "insufficient data"}`,
  );
  lines.push("");
  lines.push("## Top Hotspots");
  for (const hotspot of report.hotspots.slice(0, 3)) {
    lines.push(`- \`${hotspot.target}\` (score: \`${hotspot.score}\`)`);
  }

  return lines.join("\n");
};

const scoringProfileOption = (): Option =>
  new Option(
    "--scoring-profile <profile>",
    "scoring profile: default (balanced) or personal (down-weights single-maintainer ownership penalties for risk and health ownership)",
  )
    .choices(["default", "personal"])
    .default("default");

program
  .name("codesentinel")
  .description("Structural and evolutionary risk analysis for TypeScript/JavaScript codebases")
  .version(version);

program
  .command("update")
  .description("check for a newer CodeSentinel version and install it")
  .action(async () => {
    process.exitCode = await runManualCliUpdate({
      packageName: "@getcodesentinel/codesentinel",
      currentVersion: version,
    });
  });

program
  .command("mcp")
  .exitOverride()
  .description("serve CodeSentinel over the Model Context Protocol (stdio transport)")
  .addHelpText(
    "after",
    `
Transport: stdio only. JSON-RPC messages on stdin/stdout; every log goes to stderr.
Tools: get_file_owner, get_file_risk, get_reading_path, get_trend, list_hotspots, run_scan, search_findings.
No credentials are accepted as tool arguments; git and CI credentials come from the environment.
Repository root: --root is not a flag; set CODESENTINEL_ROOT (defaults to the current directory).
Register it with: claude mcp add codesentinel -- codesentinel mcp`,
  )
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .action(async (options: { logLevel: LogLevel }) => {
    const logger = createStderrLogger(options.logLevel);
    await runMcpServer({ version, logger });
  });

program
  .command("analyze")
  .argument("[path]", "path to the project to analyze")
  .addOption(scoringProfileOption())
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
        scoringProfile: ScoringProfileCliMode;
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
        { recentWindowDays: options.recentWindowDays, scoringProfile: options.scoringProfile },
        logger,
      );
      const outputMode: AnalyzeOutputMode = options.json === true ? "json" : options.output;
      process.stdout.write(`${formatAnalyzeOutput(summary, outputMode)}\n`);
    },
  );

program
  .command("explain")
  .argument("[path]", "path to the project to analyze")
  .addOption(scoringProfileOption())
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
        scoringProfile: ScoringProfileCliMode;
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
        scoringProfile: options.scoringProfile,
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
  .addOption(scoringProfileOption())
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
    new Option("--format <mode>", "output format: text, json, md, html")
      .choices(["text", "json", "md", "html"])
      .default("md"),
  )
  .option("--output <path>", "write rendered report to a file path")
  .option("--open", "open the generated HTML report in the default browser")
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
        scoringProfile: ScoringProfileCliMode;
        logLevel: LogLevel;
        format: "text" | "json" | "md" | "html";
        output?: string;
        open?: boolean;
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
          ...(options.open === undefined ? {} : { open: options.open }),
          includeTrace: options.trace,
          scoringProfile: options.scoringProfile,
          recentWindowDays: options.recentWindowDays,
        },
        logger,
      );

      if (options.output === undefined && options.format !== "html") {
        process.stdout.write(`${result.rendered}\n`);
        return;
      }

      if (options.format === "html") {
        process.stdout.write(`${result.outputPath ?? result.rendered}\n`);
      }
    },
  );

program
  .command("run")
  .argument("[path]", "path to the project to analyze")
  .addOption(scoringProfileOption())
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
      .default("md"),
  )
  .addOption(
    new Option("--detail <level>", "run detail level: compact (default), standard, full")
      .choices(["compact", "standard", "full"])
      .default("compact"),
  )
  .option("--file <path>", "explain a specific file target")
  .option("--module <name>", "explain a specific module target")
  .option("--top <count>", "number of top hotspots to explain when no target is selected", "5")
  .option("--compare <baseline>", "compare against a baseline snapshot JSON file")
  .option("--snapshot <path>", "write current snapshot JSON artifact")
  .addOption(
    new Option("--report <format>", "write an additional report bundle during the run")
      .choices(["html"])
      .default(undefined),
  )
  .option("--report-output <path>", "output path for the generated report bundle")
  .option("--open", "open the generated HTML report in the default browser")
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
        scoringProfile: ScoringProfileCliMode;
        logLevel: LogLevel;
        format: "text" | "md" | "json";
        detail: RunDetail;
        file?: string;
        module?: string;
        top: string;
        compare?: string;
        snapshot?: string;
        report?: "html";
        reportOutput?: string;
        open?: boolean;
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
          format: options.format,
          recentWindowDays: options.recentWindowDays,
          scoringProfile: options.scoringProfile,
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

      if (options.report === "html") {
        const htmlOutputPath = await writeHtmlReportBundle(report, {
          repositoryPath: explain.summary.structural.targetPath,
          ...(options.reportOutput === undefined ? {} : { outputPath: options.reportOutput }),
        });
        if (options.open === true) {
          const opened = await openPath(`${htmlOutputPath}/index.html`);
          if (!opened) {
            logger.warn("unable to open html report automatically on this platform");
          }
        }
        logger.info(`html report written: ${htmlOutputPath}`);
      } else if (options.open === true) {
        logger.warn("--open has no effect unless --report html is set");
      }

      if (options.format === "json") {
        const analyzeSummaryOutput = formatAnalyzeOutput(explain.summary, "summary");

        if (options.detail === "compact") {
          process.stdout.write(
            `${JSON.stringify(
              {
                schemaVersion: "codesentinel.run.v1",
                generatedAt: new Date().toISOString(),
                repository: report.repository,
                keyDrivers: extractSummaryValue(
                  extractExplainTextSummary(formatExplainOutput(explain, "text")),
                  "key drivers",
                ),
                priorityActions: extractSummaryValue(
                  extractExplainTextSummary(formatExplainOutput(explain, "text")),
                  "priority actions",
                ),
                topHotspots: report.hotspots.slice(0, 3).map((hotspot) => ({
                  target: hotspot.target,
                  score: hotspot.score,
                })),
              },
              null,
              2,
            )}\n`,
          );
          return;
        }

        if (options.detail === "standard") {
          const analyzeSummaryPayload: unknown = JSON.parse(analyzeSummaryOutput);

          process.stdout.write(
            `${JSON.stringify(
              {
                schemaVersion: "codesentinel.run.v1",
                generatedAt: new Date().toISOString(),
                analyze: analyzeSummaryPayload,
                explain: {
                  summary: extractExplainTextSummary(formatExplainOutput(explain, "text")),
                },
                report: {
                  repository: report.repository,
                  health: report.health,
                  hotspots: report.hotspots.slice(0, 5),
                  structural: report.structural,
                  external: report.external,
                },
              },
              null,
              2,
            )}\n`,
          );
          return;
        }

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

      if (options.detail === "compact") {
        if (options.format === "md") {
          process.stdout.write(
            `${renderCompactMarkdown(
              report,
              extractExplainMarkdownSummary(formatExplainOutput(explain, "md")),
            )}\n`,
          );
          return;
        }

        process.stdout.write(
          `${renderCompactText(report, extractExplainTextSummary(formatExplainOutput(explain, "text")))}\n`,
        );
        return;
      }

      if (options.detail === "standard") {
        if (options.format === "md") {
          process.stdout.write(
            `# CodeSentinel Run\n\n## Analyze\n\`\`\`json\n${analyzeRendered}\n\`\`\`\n\n## Explain\n${extractExplainMarkdownSummary(
              formatExplainOutput(explain, "md"),
            )}\n\n${renderReportHighlightsMarkdown(report)}\n`,
          );
          return;
        }

        process.stdout.write(
          `CodeSentinel Run\n\nAnalyze\n${analyzeRendered}\n\nExplain\n${extractExplainTextSummary(
            formatExplainOutput(explain, "text"),
          )}\n\nReport\n${renderReportHighlightsText(report)}\n`,
        );
        return;
      }

      const reportRendered = formatReport(report, options.format);

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

const parseCiCount = (value: string | undefined, optionName: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new CiConfigurationError(`${optionName} must be an integer >= 0`);
  }

  return parsed;
};

const parseCiRatio = (value: string | undefined, optionName: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new CiConfigurationError(`${optionName} must be a number between 0 and 1`);
  }

  return parsed;
};

const buildGateConfigFromOptions = (options: {
  maxRiskDelta?: string;
  maxHealthDelta?: string;
  noNewCycles?: boolean;
  noNewHighRiskDeps?: boolean;
  maxNewHotspots?: string;
  maxRiskScore?: string;
  minHealthScore?: string;
  newHotspotScoreThreshold?: string;
  maxUnownedCritical?: string;
  maxGhostOwners?: string;
  maxDrift?: string;
  failOn: "error" | "warn";
}): GateConfig => {
  const maxRiskDelta = parseGateNumber(options.maxRiskDelta, "--max-risk-delta");
  const maxHealthDelta = parseGateNumber(options.maxHealthDelta, "--max-health-delta");
  const maxNewHotspots = parseGateNumber(options.maxNewHotspots, "--max-new-hotspots");
  const maxRiskScore = parseGateNumber(options.maxRiskScore, "--max-risk-score");
  const minHealthScore = parseGateNumber(options.minHealthScore, "--min-health-score");
  const newHotspotScoreThreshold = parseGateNumber(
    options.newHotspotScoreThreshold,
    "--new-hotspot-score-threshold",
  );
  const maxUnownedCritical = parseCiCount(options.maxUnownedCritical, "--max-unowned-critical");
  const maxGhostOwners = parseCiCount(options.maxGhostOwners, "--max-ghost-owners");
  const maxDrift = parseCiRatio(options.maxDrift, "--max-drift");

  return {
    ...(maxRiskDelta === undefined ? {} : { maxRiskDelta }),
    ...(maxHealthDelta === undefined ? {} : { maxHealthDelta }),
    ...(options.noNewCycles === true ? { noNewCycles: true } : {}),
    ...(options.noNewHighRiskDeps === true ? { noNewHighRiskDeps: true } : {}),
    ...(maxNewHotspots === undefined ? {} : { maxNewHotspots }),
    ...(maxRiskScore === undefined ? {} : { maxRiskScore }),
    ...(minHealthScore === undefined ? {} : { minHealthScore }),
    ...(newHotspotScoreThreshold === undefined ? {} : { newHotspotScoreThreshold }),
    ...(maxUnownedCritical === undefined ? {} : { maxUnownedCritical }),
    ...(maxGhostOwners === undefined ? {} : { maxGhostOwners }),
    ...(maxDrift === undefined ? {} : { maxDrift }),
    failOn: options.failOn,
  };
};

program
  .command("check")
  .argument("[path]", "path to the project to analyze")
  .addOption(scoringProfileOption())
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
  .option("--max-risk-delta <value>", "maximum allowed normalized risk score increase")
  .option(
    "--max-health-delta <value>",
    "maximum allowed normalized health score regression versus baseline (requires --compare)",
  )
  .option("--no-new-cycles", "fail if new structural cycles are introduced")
  .option("--no-new-high-risk-deps", "fail if new high-risk direct dependencies are introduced")
  .option("--max-new-hotspots <count>", "maximum allowed number of new hotspots")
  .option("--new-hotspot-score-threshold <score>", "minimum hotspot score to count as new hotspot")
  .option("--max-risk-score <score>", "absolute risk score limit (0..100)")
  .option("--min-health-score <score>", "minimum health score threshold (0..100)")
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
        scoringProfile: ScoringProfileCliMode;
        logLevel: LogLevel;
        compare?: string;
        maxRiskDelta?: string;
        maxHealthDelta?: string;
        noNewCycles?: boolean;
        noNewHighRiskDeps?: boolean;
        maxNewHotspots?: string;
        newHotspotScoreThreshold?: string;
        maxRiskScore?: string;
        minHealthScore?: string;
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
            scoringProfile: options.scoringProfile,
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
  .addOption(scoringProfileOption())
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
  .option("--max-risk-delta <value>", "maximum allowed normalized risk score increase")
  .option(
    "--max-health-delta <value>",
    "maximum allowed normalized health score regression versus baseline",
  )
  .option("--no-new-cycles", "fail if new structural cycles are introduced")
  .option("--no-new-high-risk-deps", "fail if new high-risk direct dependencies are introduced")
  .option("--max-new-hotspots <count>", "maximum allowed number of new hotspots")
  .option("--new-hotspot-score-threshold <score>", "minimum hotspot score to count as new hotspot")
  .option("--max-risk-score <score>", "absolute risk score limit (0..100)")
  .option("--min-health-score <score>", "minimum health score threshold (0..100)")
  .option(
    "--max-unowned-critical <count>",
    "maximum allowed unowned critical files (requires CODEOWNERS)",
  )
  .option(
    "--max-ghost-owners <count>",
    "maximum allowed owners without activity (requires CODEOWNERS)",
  )
  .option(
    "--max-drift <ratio>",
    "maximum allowed ownership drift ratio between 0 and 1 (requires CODEOWNERS)",
  )
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
        scoringProfile: ScoringProfileCliMode;
        logLevel: LogLevel;
        baseline?: string;
        baselineRef?: string;
        baselineSha?: string;
        mainBranch?: string[];
        mainBranches?: string;
        snapshot?: string;
        report?: string;
        jsonOutput?: string;
        maxRiskDelta?: string;
        maxHealthDelta?: string;
        noNewCycles?: boolean;
        noNewHighRiskDeps?: boolean;
        maxNewHotspots?: string;
        newHotspotScoreThreshold?: string;
        maxRiskScore?: string;
        minHealthScore?: string;
        maxUnownedCritical?: string;
        maxGhostOwners?: string;
        maxDrift?: string;
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
            scoringProfile: options.scoringProfile,
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

const parseOwnersInteger = (
  value: string | undefined,
  optionName: string,
  minimum: number,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed < minimum) {
    throw new OwnersConfigurationError(
      `${optionName} must be an integer greater than or equal to ${minimum}`,
    );
  }

  return parsed;
};

const parseOwnersRatio = (value: string | undefined, optionName: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new OwnersConfigurationError(`${optionName} must be a ratio between 0 and 1`);
  }

  return parsed;
};

const parseOwnersIgnoreAuthors = (values: string[] | undefined): readonly string[] | undefined => {
  if (values === undefined) {
    return undefined;
  }

  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const value of values) {
    const pattern = value.trim();
    if (pattern.length === 0) {
      throw new OwnersConfigurationError("--ignore-author must be a non-empty glob pattern");
    }

    const key = pattern.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    patterns.push(pattern);
  }

  return patterns.length > 0 ? patterns : undefined;
};

const parseCommentPullRequest = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new PrCommentConfigurationError("--pr must be a positive integer");
  }

  return parsed;
};

const parsePathInteger = (
  value: string | undefined,
  optionName: string,
  minimum: number,
  maximum?: number,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (
    !/^\d+$/.test(trimmed) ||
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    (maximum !== undefined && parsed > maximum)
  ) {
    const range =
      maximum === undefined
        ? `an integer greater than or equal to ${minimum}`
        : `an integer between ${minimum} and ${maximum}`;
    throw new PathConfigurationError(`${optionName} must be ${range}`);
  }

  return parsed;
};

program
  .command("owners")
  .alias("ownership")
  // The owners command owns the ESLint-style 0/1/2 contract, so a usage error has to surface as
  // the configuration exit code (2) instead of commander's default 1.
  .exitOverride()
  .argument("[path]", "path to the repository to audit")
  .option(
    "--codeowners <file>",
    "explicit CODEOWNERS path, relative to the repository root (default: auto-discovery)",
  )
  .option("--ref <ref>", "git ref to read CODEOWNERS and the tracked tree from", "HEAD")
  .option("--window-days <days>", "authorship observation window in days", "90")
  .option("--min-commits <count>", "minimum per-file commits before a verdict is emitted", "2")
  .option("--top <count>", "rows per console and markdown section", "10")
  .addOption(
    new Option(
      "--format <mode>",
      "output format: console (default), json (stable, sorted payload), md (pastes into a PR) or sarif (code scanning)",
    )
      .choices(["console", "json", "md", "sarif"])
      .default("console"),
  )
  .option("--output <file>", "write the rendered output to a file instead of stdout")
  .option("--aliases <file>", "identity alias map", ".codesentinel/owners.json")
  .addOption(
    new Option(
      "--ignore-author <glob>",
      "additional author glob to exclude from ownership evidence (repeatable; the defaults stay active)",
    ).argParser(collectOptionValues),
  )
  .option(
    "--resolve-github",
    "accepted for compatibility; not implemented in this iteration, the audit stays offline",
  )
  .addOption(
    new Option("--fail-on <level>", "failing severity threshold: none, warn or error")
      .choices(["none", "warn", "error"])
      .default("none"),
  )
  .option("--max-unowned-critical <count>", "maximum allowed unowned critical files")
  .option("--max-ghost-owners <count>", "maximum allowed owners without activity")
  .option("--max-drift <ratio>", "maximum allowed drift ratio between 0 and 1")
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .action(
    async (
      path: string | undefined,
      options: {
        codeowners?: string;
        ref: string;
        windowDays: string;
        minCommits: string;
        top: string;
        format: OwnersOutputFormat;
        output?: string;
        aliases: string;
        ignoreAuthor?: string[];
        resolveGithub?: boolean;
        failOn: OwnersFailOn;
        maxUnownedCritical?: string;
        maxGhostOwners?: string;
        maxDrift?: string;
        logLevel: LogLevel;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);

      try {
        const windowDays = parseOwnersInteger(options.windowDays, "--window-days", 1) ?? 90;
        const minCommits = parseOwnersInteger(options.minCommits, "--min-commits", 0) ?? 2;
        const top = parseOwnersInteger(options.top, "--top", 1) ?? 10;
        const ignoreAuthors = parseOwnersIgnoreAuthors(options.ignoreAuthor);
        const commandOptions: OwnersCommandOptions = {
          ...(options.codeowners === undefined ? {} : { codeownersPath: options.codeowners }),
          ref: options.ref,
          windowDays,
          minCommits,
          top,
          format: options.format,
          ...(options.output === undefined ? {} : { outputPath: options.output }),
          aliasesPath: options.aliases,
          ...(ignoreAuthors === undefined ? {} : { ignoreAuthors }),
          toolVersion: version,
          ...(options.resolveGithub === true ? { resolveGithub: true } : {}),
          thresholds: {
            failOn: options.failOn,
            maxUnownedCritical:
              parseOwnersInteger(options.maxUnownedCritical, "--max-unowned-critical", 0) ?? null,
            maxGhostOwners:
              parseOwnersInteger(options.maxGhostOwners, "--max-ghost-owners", 0) ?? null,
            maxDrift: parseOwnersRatio(options.maxDrift, "--max-drift") ?? null,
          },
        };

        const result = await runOwnersCommand(path, commandOptions, logger);

        if (result.outputPath === undefined) {
          process.stdout.write(`${result.rendered}\n`);
        }

        process.exitCode = result.exitCode;
      } catch (error) {
        if (error instanceof OwnersConfigurationError) {
          logger.error(error.message);
          process.exitCode = OWNERS_EXIT_CODES.invalidConfiguration;
          return;
        }

        logger.error(error instanceof Error ? error.message : "internal error");
        process.exitCode = OWNERS_EXIT_CODES.invalidConfiguration;
      }
    },
  );

program
  .command("path")
  .description("show which files to read first for a target, in order")
  // Like owners, this command owns its 0/2 contract, so usage errors must surface as exit code 2.
  .exitOverride()
  .argument("<target>", "file or directory to read, relative to the repository root")
  .option("--max-steps <count>", "maximum number of files in the reading path (1..25)", "8")
  .addOption(
    new Option("--format <mode>", "output format: console (default), md or json")
      .choices(["console", "md", "json"])
      .default("console"),
  )
  .option("--output <file>", "write the rendered output to a file instead of stdout")
  .option("--window-days <days>", "ownership observation window in days", "90")
  .option(
    "--include-tests",
    "include test files as their own steps instead of attaching them to their source",
  )
  .option("--ref <ref>", "git ref to read CODEOWNERS and the tracked history from", "HEAD")
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .action(
    async (
      target: string,
      options: {
        maxSteps: string;
        format: PathOutputFormat;
        output?: string;
        windowDays: string;
        includeTests?: boolean;
        ref: string;
        logLevel: LogLevel;
      },
    ) => {
      const logger = createStderrLogger(options.logLevel);

      try {
        const maxSteps = parsePathInteger(options.maxSteps, "--max-steps", 1, 25) ?? 8;
        const windowDays = parsePathInteger(options.windowDays, "--window-days", 1) ?? 90;
        const commandOptions: PathCommandOptions = {
          maxSteps,
          format: options.format,
          ...(options.output === undefined ? {} : { outputPath: options.output }),
          windowDays,
          ...(options.includeTests === true ? { includeTests: true } : {}),
          ref: options.ref,
        };

        const result = await runPathCommand(target, commandOptions, logger);

        if (result.outputPath === undefined) {
          process.stdout.write(`${result.rendered}\n`);
        }

        process.exitCode = result.exitCode;
      } catch (error) {
        if (error instanceof PathConfigurationError) {
          logger.error(error.message);
          process.exitCode = PATH_EXIT_CODES.invalidTarget;
          return;
        }

        logger.error(error instanceof Error ? error.message : "internal error");
        process.exitCode = PATH_EXIT_CODES.invalidTarget;
      }
    },
  );

program
  .command("comment")
  .exitOverride()
  .description("render or upsert the sticky CodeSentinel pull request summary comment")
  .requiredOption("--input <file>", "CI JSON input written by `codesentinel ci --json-output`")
  .option("--pr <number>", "pull request number to comment on")
  .addOption(
    new Option(
      "--comment-on <mode>",
      "comment behavior: change (only when the body moved), always or never",
    )
      .choices(["change", "always", "never"])
      .default("change"),
  )
  .option("--repository <owner/repo>", "repository slug (default: GITHUB_REPOSITORY)")
  .option("--output <file>", "write the rendered comment body to a file instead of stdout")
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .action(
    async (options: {
      input: string;
      pr?: string;
      commentOn: PrCommentMode;
      repository?: string;
      output?: string;
      logLevel: LogLevel;
    }) => {
      const logger = createStderrLogger(options.logLevel);

      try {
        const pullRequest = parseCommentPullRequest(options.pr);
        const result = await runCommentCommand(
          {
            inputPath: options.input,
            ...(pullRequest === undefined ? {} : { pullRequest }),
            mode: options.commentOn,
            ...(options.repository === undefined ? {} : { repository: options.repository }),
            ...(options.output === undefined ? {} : { outputPath: options.output }),
          },
          logger,
        );

        if (result.outputPath === undefined) {
          process.stdout.write(`${result.body}\n`);
        }

        process.exitCode = result.exitCode;
      } catch (error) {
        if (error instanceof PrCommentConfigurationError) {
          logger.error(error.message);
          process.exitCode = COMMENT_EXIT_CODES.invalidConfiguration;
          return;
        }

        logger.error(error instanceof Error ? error.message : "internal error");
        process.exitCode = COMMENT_EXIT_CODES.invalidConfiguration;
      }
    },
  );

program
  .command("trend")
  .exitOverride()
  .option(
    "--from <dir-or-glob>",
    "directory of snapshot JSON files (non-recursive) or a glob pattern (required)",
  )
  .option("--since <window>", "only include snapshots newer than this window, for example 90d")
  .option("--last <count>", "only include the N most recent snapshots")
  .addOption(
    new Option(
      "--format <mode>",
      "output format: console (default), json (stable payload) or md (pastes into a PR)",
    )
      .choices(["console", "json", "md"])
      .default("console"),
  )
  .option("--output <file>", "write the rendered output to a file instead of stdout")
  .addOption(
    new Option(
      "--log-level <level>",
      "log verbosity: silent, error, warn, info, debug (logs are written to stderr)",
    )
      .choices(["silent", "error", "warn", "info", "debug"])
      .default(parseLogLevel(process.env["CODESENTINEL_LOG_LEVEL"])),
  )
  .action(
    async (options: {
      from?: string;
      since?: string;
      last?: string;
      format: TrendOutputFormat;
      output?: string;
      logLevel: LogLevel;
    }) => {
      const logger = createStderrLogger(options.logLevel);

      try {
        const result = await runTrendCommand(
          {
            ...(options.from === undefined ? {} : { from: options.from }),
            ...(options.since === undefined ? {} : { since: options.since }),
            ...(options.last === undefined ? {} : { last: Number(options.last) }),
            format: options.format,
            ...(options.output === undefined ? {} : { outputPath: options.output }),
          },
          logger,
        );

        if (result.outputPath === undefined) {
          process.stdout.write(`${result.rendered}\n`);
        }

        process.exitCode = result.exitCode;
      } catch (error) {
        if (error instanceof TrendConfigurationError) {
          logger.error(error.message);
          process.exitCode = TREND_EXIT_CODES.invalidConfiguration;
          return;
        }

        logger.error(error instanceof Error ? error.message : "internal error");
        process.exitCode = TREND_EXIT_CODES.invalidConfiguration;
      }
    },
  );

program
  .command("init")
  .argument("[path]", "path to the repository to scaffold")
  .option("--force", "overwrite generated files that already exist")
  .addOption(
    new Option("--ci <mode>", "CI provider: github (default) or none")
      .choices(["github", "none"])
      .default("github"),
  )
  .option("--dry-run", "print what would be written without writing anything")
  .action(
    async (
      path: string | undefined,
      options: { force?: boolean; ci: InitCiMode; dryRun?: boolean },
    ) => {
      const result = await runInitCommand(path, {
        ...(options.force === true ? { force: true } : {}),
        ci: options.ci,
        ...(options.dryRun === true ? { dryRun: true } : {}),
      });
      process.stdout.write(`${result.rendered}\n`);
      process.exitCode = result.exitCode;
    },
  );

const executablePath = process.argv[0] ?? "";
const scriptPath = process.argv[1] ?? "";

const argv =
  process.argv[2] === "--" ? [executablePath, scriptPath, ...process.argv.slice(3)] : process.argv;

if (argv.length <= 2) {
  if (process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY) {
    process.exitCode = await runInteractiveCliMenu({
      currentVersion: version,
      scriptPath,
    });
    process.exit(process.exitCode ?? 0);
  }

  program.outputHelp();
  process.exit(0);
}

if (argv[2] !== "update" && argv[2] !== "mcp") {
  await checkForCliUpdates({
    packageName: "@getcodesentinel/codesentinel",
    currentVersion: version,
    argv: process.argv,
    env: process.env,
  });
}

try {
  await program.parseAsync(argv);
} catch (error) {
  if (!(error instanceof CommanderError)) {
    throw error;
  }
  // `--help` and usage errors both travel through `exitOverride`; only real usage errors are
  // configuration failures for the command that opted into the ESLint-style exit codes.
  if (error.exitCode !== 0) {
    process.exitCode = OWNERS_EXIT_CODES.invalidConfiguration;
  }
}
