import { resolve } from "node:path";
import type { AnalyzeSummary } from "@codesentinel/core";
import {
  buildProjectGraphSummary,
  type ParseTypescriptProjectProgressEvent,
} from "@codesentinel/code-graph";
import {
  analyzeDependencyExposureFromProject,
  type DependencyExposureProgressEvent,
} from "@codesentinel/dependency-firewall";
import {
  analyzeRepositoryEvolutionFromGit,
  type EvolutionAnalysisProgressEvent,
} from "@codesentinel/git-analyzer";
import { computeRepositoryRiskSummary } from "@codesentinel/risk-engine";
import { createSilentLogger, type Logger } from "./logger.js";

export type AuthorIdentityCliMode = "likely_merge" | "strict_email";

const resolveTargetPath = (inputPath: string | undefined, cwd: string): string =>
  resolve(cwd, inputPath ?? ".");

export type AnalysisInputs = {
  structural: AnalyzeSummary["structural"];
  evolution: AnalyzeSummary["evolution"];
  external: AnalyzeSummary["external"];
};

const createExternalProgressReporter = (
  logger: Logger,
): ((event: DependencyExposureProgressEvent) => void) => {
  let lastLoggedProgress = 0;

  return (event) => {
    switch (event.stage) {
      case "package_json_loaded":
        logger.debug("external: package.json loaded");
        break;
      case "lockfile_selected":
        logger.info(`external: lockfile selected (${event.kind})`);
        break;
      case "lockfile_parsed":
        logger.info(
          `external: parsed ${event.dependencyNodes} locked dependencies (${event.directDependencies} direct)`,
        );
        break;
      case "metadata_fetch_started":
        logger.info(`external: fetching dependency metadata (${event.total} packages)`);
        break;
      case "metadata_fetch_progress": {
        const currentPercent =
          event.total === 0 ? 100 : Math.floor((event.completed / event.total) * 100);
        if (
          event.completed === event.total ||
          event.completed === 1 ||
          event.completed - lastLoggedProgress >= 25
        ) {
          lastLoggedProgress = event.completed;
          logger.info(
            `external: metadata progress ${event.completed}/${event.total} (${currentPercent}%)`,
          );
          logger.debug(`external: last package processed ${event.packageName}`);
        }
        break;
      }
      case "metadata_fetch_completed":
        logger.info(`external: metadata fetch completed (${event.total} packages)`);
        break;
      case "summary_built":
        logger.info(
          `external: summary built (${event.totalDependencies} total, ${event.directDependencies} direct)`,
        );
        break;
    }
  };
};

const createStructuralProgressReporter = (
  logger: Logger,
): ((event: ParseTypescriptProjectProgressEvent) => void) => {
  let lastProcessed = 0;

  return (event) => {
    switch (event.stage) {
      case "config_resolved":
        if (event.usedFallbackScan) {
          logger.info(
            `structural: using filesystem scan discovery (tsconfigs=${event.tsconfigCount})`,
          );
        } else {
          logger.info(`structural: discovered tsconfig graph (${event.tsconfigCount} configs)`);
        }
        break;
      case "files_discovered":
        logger.info(`structural: discovered ${event.totalSourceFiles} source files`);
        break;
      case "program_created":
        logger.debug(`structural: TypeScript program created (${event.totalSourceFiles} files)`);
        break;
      case "file_processed":
        if (
          event.processed === event.total ||
          event.processed === 1 ||
          event.processed - lastProcessed >= 50
        ) {
          lastProcessed = event.processed;
          logger.info(`structural: resolved ${event.processed}/${event.total} files`);
          logger.debug(`structural: last file processed ${event.filePath}`);
        }
        break;
      case "edges_resolved":
        logger.info(`structural: resolved ${event.totalEdges} dependency edges`);
        break;
    }
  };
};

const createEvolutionProgressReporter = (
  logger: Logger,
): ((event: EvolutionAnalysisProgressEvent) => void) => {
  let lastParsedRecords = 0;

  return (event) => {
    switch (event.stage) {
      case "checking_git_repository":
        logger.debug("evolution: checking git repository");
        break;
      case "not_git_repository":
        logger.warn("evolution: target path is not a git repository");
        break;
      case "loading_commit_history":
        logger.info("evolution: loading git history");
        break;
      case "history":
        if (event.event.stage === "git_log_received") {
          logger.info(`evolution: git log loaded (${event.event.bytes} bytes)`);
          break;
        }

        if (event.event.stage === "git_log_parsed") {
          logger.info(`evolution: parsed ${event.event.commits} commits`);
          break;
        }

        if (
          event.event.stage === "git_log_parse_progress" &&
          (event.event.parsedRecords === event.event.totalRecords ||
            event.event.parsedRecords === 1 ||
            event.event.parsedRecords - lastParsedRecords >= 500)
        ) {
          lastParsedRecords = event.event.parsedRecords;
          const currentPercent =
            event.event.totalRecords === 0
              ? 100
              : Math.floor((event.event.parsedRecords / event.event.totalRecords) * 100);
          logger.info(
            `evolution: parse progress ${event.event.parsedRecords}/${event.event.totalRecords} (${currentPercent}%)`,
          );
        }
        break;
      case "computing_metrics":
        logger.info("evolution: computing metrics");
        break;
      case "analysis_completed":
        logger.debug(`evolution: analysis completed (available=${event.available})`);
        break;
    }
  };
};

export const collectAnalysisInputs = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  logger: Logger = createSilentLogger(),
): Promise<AnalysisInputs> => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  const targetPath = resolveTargetPath(inputPath, invocationCwd);
  logger.info(`analyzing repository: ${targetPath}`);

  logger.info("building structural graph");
  const structural = buildProjectGraphSummary({
    projectPath: targetPath,
    onProgress: createStructuralProgressReporter(logger),
  });
  logger.debug(
    `structural metrics: nodes=${structural.metrics.nodeCount}, edges=${structural.metrics.edgeCount}, cycles=${structural.metrics.cycleCount}`,
  );

  logger.info(`analyzing git evolution (author identity: ${authorIdentityMode})`);
  const evolution = analyzeRepositoryEvolutionFromGit(
    {
      repositoryPath: targetPath,
      config: { authorIdentityMode },
    },
    createEvolutionProgressReporter(logger),
  );
  if (evolution.available) {
    logger.debug(
      `evolution metrics: commits=${evolution.metrics.totalCommits}, files=${evolution.metrics.totalFiles}, hotspotThreshold=${evolution.metrics.hotspotThresholdCommitCount}`,
    );
  } else {
    logger.warn(`evolution analysis unavailable: ${evolution.reason}`);
  }

  logger.info("analyzing external dependencies");
  const external = await analyzeDependencyExposureFromProject(
    { repositoryPath: targetPath },
    createExternalProgressReporter(logger),
  );
  if (external.available) {
    logger.debug(
      `external metrics: total=${external.metrics.totalDependencies}, direct=${external.metrics.directDependencies}, transitive=${external.metrics.transitiveDependencies}`,
    );
  } else {
    logger.warn(`external analysis unavailable: ${external.reason}`);
  }

  return {
    structural,
    evolution,
    external,
  };
};

export const runAnalyzeCommand = async (
  inputPath: string | undefined,
  authorIdentityMode: AuthorIdentityCliMode,
  logger: Logger = createSilentLogger(),
): Promise<AnalyzeSummary> => {
  const analysisInputs = await collectAnalysisInputs(inputPath, authorIdentityMode, logger);
  logger.info("computing risk summary");
  const risk = computeRepositoryRiskSummary(analysisInputs);
  logger.info(`analysis completed (repositoryScore=${risk.repositoryScore})`);

  return {
    ...analysisInputs,
    risk,
  };
};
