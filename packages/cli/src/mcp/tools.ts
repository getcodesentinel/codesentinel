import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildAnalysisSnapshot } from "../application/build-analysis-snapshot.js";
import type { Logger } from "../application/logger.js";
import { PathConfigurationError, runPathCommand } from "../application/run-path-command.js";
import {
  readTrendSnapshots,
  TrendConfigurationError,
} from "../application/read-trend-snapshots.js";
import type { AnalysisCache } from "./analysis-cache.js";
import { assertPathInsideRoot, resolveRepositoryPath } from "./context.js";
import { McpToolError, toToolErrorResult } from "./errors.js";
import {
  changedFilesFromGitOutput,
  decodeCursor,
  filterFindings,
  filterTrendByIsoDate,
  normalizePathPrefix,
  paginate,
  shortCommit,
  toFileOwner,
  toFindings,
  toHotspots,
  toReadingPath,
  trendValue,
  type FindingFilters,
  type TrendMetric,
} from "./shapes.js";

export type GitRunner = (args: readonly string[]) => Promise<{ stdout: string; exitCode: number }>;

export type McpServerContext = {
  root: string;
  version: string;
  logger: Logger;
  cache: AnalysisCache;
  git: GitRunner;
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const createGitRunner = (root: string): GitRunner => {
  return async (args) =>
    new Promise((resolvePromise) => {
      const child = spawn("git", args, {
        cwd: root,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "ignore"],
      });

      let stdout = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.on("error", () => {
        resolvePromise({ stdout, exitCode: 1 });
      });
      child.on("close", (code) => {
        resolvePromise({ stdout, exitCode: code ?? 1 });
      });
    });
};

const jsonResult = <T extends Record<string, unknown>>(
  value: T,
): {
  content: [{ type: "text"; text: string }];
  structuredContent: T;
} => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

const ownershipStatusEnum = z.enum([
  "aligned",
  "drifted",
  "ghosted",
  "unowned",
  "unowned-critical",
  "insufficient-evidence",
  "unknown",
]);

const findingSeverityEnum = z.enum(["error", "warning"]);

const ownershipRuleEnum = z.enum([
  "ownership/unowned-critical",
  "ownership/ghost-owner",
  "ownership/drift",
  "ownership/unknown",
]);

const ownerValueSchema = z.object({
  kind: z.enum(["user", "team", "email"]),
  value: z.string(),
});

const ownerValueListSchema = z.array(ownerValueSchema);

const fileOwnerOutputSchema = z.object({
  path: z.string(),
  ref: z.string(),
  owners: ownerValueListSchema,
  teams: z.array(z.string()),
  status: ownershipStatusEnum,
  matchLine: z.number().nullable(),
  topAuthor: z
    .object({
      id: z.string(),
      share: z.number().nullable(),
    })
    .nullable(),
  observed: z.object({
    commits: z.number(),
    recentCommits: z.number(),
    authors: z.number(),
    dormant: z.boolean(),
    busFactor: z.number().nullable(),
    lastCommitUnix: z.number().nullable(),
  }),
  criticality: z.object({
    isCritical: z.boolean(),
    isHotspot: z.boolean(),
    fanIn: z.number().nullable(),
    riskScore: z.number().nullable(),
  }),
  warnings: z.array(z.string()),
});

const fileRiskOutputSchema = z.object({
  path: z.string(),
  ref: z.string(),
  score: z.number(),
  normalizedScore: z.number(),
  factors: z.object({
    structural: z.number(),
    evolution: z.number(),
    external: z.number(),
  }),
  hotspotRank: z.number().nullable(),
  repositoryRiskScore: z.number(),
});

const readingPathOutputSchema = z.object({
  target: z.string(),
  targetKind: z.enum(["file", "directory"]),
  steps: z.array(
    z.object({
      order: z.number(),
      filePath: z.string(),
      role: z.enum(["entry", "core", "helper", "test"]),
      reason: z.string(),
      owner: ownerValueListSchema.nullable(),
      observedTopAuthor: z.string().nullable(),
      commits: z.number(),
      churn: z.number(),
      fanInInternal: z.number(),
      testFiles: z.array(z.string()),
    }),
  ),
  people: z.array(
    z.object({
      authorId: z.string(),
      files: z.array(z.string()),
      commits: z.number(),
    }),
  ),
  commands: z.array(z.string()),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
});

const trendMetricEnum = z.enum([
  "riskScore",
  "healthScore",
  "unownedCriticalCount",
  "ghostOwnerCount",
  "driftPercent",
]);

const DAY_WINDOW_PATTERN = /^\d+d$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

const isIsoDate = (value: string): boolean =>
  ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

const isDayWindow = (value: string): boolean => {
  if (!DAY_WINDOW_PATTERN.test(value)) return false;
  const days = Number.parseInt(value.slice(0, -1), 10);
  return Number.isInteger(days) && days > 0;
};

const trendSinceSchema = z.string().refine((value) => isIsoDate(value) || isDayWindow(value), {
  message: "since must be an ISO date or a day window such as 90d",
});

const trendUntilSchema = z.string().refine((value) => isIsoDate(value), {
  message: "until must be an ISO date",
});

const trendOutputSchema = z.object({
  metric: trendMetricEnum,
  series: z.array(
    z.object({
      file: z.string(),
      generatedAt: z.string(),
      commit: z.string().nullable(),
      value: z.number().nullable(),
    }),
  ),
  snapshotCount: z.number(),
  warnings: z.array(z.string()),
});

const hotspotsOutputSchema = z.object({
  hotspots: z.array(
    z.object({
      rank: z.number(),
      path: z.string(),
      score: z.number(),
      factors: z.object({
        structural: z.number(),
        evolution: z.number(),
        external: z.number(),
      }),
    }),
  ),
  nextCursor: z.string().nullable(),
  total: z.number(),
});

const runScanOutputSchema = z.object({
  snapshotPath: z.string(),
  generatedAt: z.string(),
  commit: z.string().nullable(),
  riskScore: z.number(),
  healthScore: z.number(),
  hotspotCount: z.number(),
  scope: z.enum(["repository", "working_tree_changed"]),
  changedFiles: z.array(z.string()),
  changedHotspots: z.array(
    z.object({
      file: z.string(),
      score: z.number(),
    }),
  ),
});

const findingsOutputSchema = z.object({
  findings: z.array(
    z.object({
      rule: z.string(),
      severity: findingSeverityEnum,
      status: ownershipStatusEnum,
      path: z.string(),
      message: z.string(),
      matchLine: z.number().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
  total: z.number(),
  warnings: z.array(z.string()),
});

const getFileOwner = async (
  context: McpServerContext,
  input: { path: string },
): Promise<ReturnType<typeof jsonResult>> => {
  const filePath = resolveRepositoryPath(context.root, input.path);
  const audit = await context.cache.getOwnershipAudit("HEAD");
  if (!audit.available) {
    throw new McpToolError(
      "no_codeowners",
      "no CODEOWNERS file is available at HEAD: declared owners cannot be reported",
    );
  }

  const file = audit.files.find((candidate) => candidate.filePath === filePath);
  if (file === undefined) {
    throw new McpToolError(
      "path_not_tracked",
      `path "${filePath}" is not tracked at HEAD: declared owners cannot be reported`,
    );
  }

  return jsonResult(toFileOwner(file, "HEAD", audit.warnings));
};

const getFileRisk = async (
  context: McpServerContext,
  input: { path: string; ref?: string | undefined },
): Promise<ReturnType<typeof jsonResult>> => {
  if (input.ref !== undefined && input.ref !== "HEAD") {
    throw new McpToolError(
      "not_supported",
      'risk analysis runs on the working tree; pass ref="HEAD" or omit it',
    );
  }

  const filePath = resolveRepositoryPath(context.root, input.path);
  const analysis = await context.cache.getAnalysis();
  const fileScore = analysis.risk.fileScores.find((candidate) => candidate.file === filePath);
  if (fileScore === undefined) {
    throw new McpToolError(
      "path_not_analyzed",
      `path "${filePath}" is not present in the risk analysis`,
    );
  }

  const hotspotIndex = analysis.risk.hotspots.findIndex((hotspot) => hotspot.file === filePath);

  return jsonResult({
    path: filePath,
    ref: "HEAD",
    score: fileScore.score,
    normalizedScore: fileScore.normalizedScore,
    factors: fileScore.factors,
    hotspotRank: hotspotIndex === -1 ? null : hotspotIndex + 1,
    repositoryRiskScore: analysis.risk.riskScore,
  });
};

const getReadingPath = async (
  context: McpServerContext,
  input: { target: string; maxSteps?: number | undefined },
): Promise<ReturnType<typeof jsonResult>> => {
  try {
    const result = await runPathCommand(
      input.target,
      {
        ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
        format: "json",
      },
      context.logger,
    );
    return jsonResult(toReadingPath(result.readingPath));
  } catch (error) {
    if (error instanceof PathConfigurationError) {
      throw new McpToolError("invalid_argument", error.message);
    }
    throw error;
  }
};

const getTrend = async (
  context: McpServerContext,
  input: {
    metric: TrendMetric;
    path?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
  },
): Promise<ReturnType<typeof jsonResult>> => {
  if (input.path !== undefined) {
    throw new McpToolError(
      "not_supported",
      "per-file trend series are not available: snapshots record repository-level metrics only",
    );
  }

  const snapshotsDir =
    process.env["CODESENTINEL_SNAPSHOTS_DIR"] ?? join(context.root, ".codesentinel", "snapshots");
  const dayWindow = input.since !== undefined && isDayWindow(input.since) ? input.since : null;

  let result: Awaited<ReturnType<typeof readTrendSnapshots>>;
  try {
    result = await readTrendSnapshots({
      from: snapshotsDir,
      ...(dayWindow === null ? {} : { since: dayWindow }),
    });
  } catch (error) {
    if (error instanceof TrendConfigurationError) {
      throw new McpToolError(
        "no_snapshots",
        `${error.message}; set CODESENTINEL_SNAPSHOTS_DIR to the directory or glob holding snapshot artifacts`,
      );
    }
    throw error;
  }

  const isoSince = input.since !== undefined && dayWindow === null ? input.since : undefined;
  const series = filterTrendByIsoDate(result.series, {
    ...(isoSince === undefined ? {} : { since: isoSince }),
    ...(input.until === undefined ? {} : { until: input.until }),
  }).map((point) => ({
    file: point.file,
    generatedAt: point.generatedAt,
    commit: point.commit,
    value: trendValue(point, input.metric),
  }));

  return jsonResult({
    metric: input.metric,
    series,
    snapshotCount: series.length,
    warnings: [...result.warnings],
  });
};

const listHotspots = async (
  context: McpServerContext,
  input: { limit: number; cursor?: string | undefined },
): Promise<ReturnType<typeof jsonResult>> => {
  const analysis = await context.cache.getAnalysis();
  const offset = decodeCursor(input.cursor);
  const { page, nextCursor } = paginate(analysis.risk.hotspots, offset, input.limit);

  return jsonResult({
    hotspots: toHotspots(page, offset),
    nextCursor,
    total: analysis.risk.hotspots.length,
  });
};

const writeSnapshotFile = async (
  context: McpServerContext,
  directory: string,
  baseName: string,
  contents: string,
): Promise<string> => {
  let suffix = 2;
  let candidate = join(directory, `${baseName}.json`);

  for (;;) {
    assertPathInsideRoot(context.root, candidate);
    try {
      await writeFile(candidate, contents, { encoding: "utf8", flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      candidate = join(directory, `${baseName}-${suffix}.json`);
      suffix += 1;
    }
  }
};

const runScan = async (
  context: McpServerContext,
  input: { path?: string | undefined; changedOnly?: boolean | undefined },
): Promise<ReturnType<typeof jsonResult>> => {
  const scanPath =
    input.path === undefined
      ? context.root
      : resolve(context.root, resolveRepositoryPath(context.root, input.path));
  assertPathInsideRoot(context.root, scanPath);

  const insideWorkTree = await context.git(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== "true") {
    throw new McpToolError(
      "not_a_git_repository",
      `run_scan requires a git work tree: ${context.root} is not inside one`,
    );
  }

  const head = await context.git(["rev-parse", "HEAD"]);
  const commit = head.exitCode === 0 && head.stdout.trim().length > 0 ? head.stdout.trim() : null;

  const snapshot = await buildAnalysisSnapshot(
    scanPath,
    "likely_merge",
    {
      includeTrace: false,
      source: {
        ...(commit === null ? {} : { commit }),
        ref: "HEAD",
      },
    },
    context.logger,
  );

  const snapshotDirectory = join(context.root, ".codesentinel", "snapshots");
  await mkdir(snapshotDirectory, { recursive: true });

  const generatedAt = snapshot.generatedAt;
  const baseName = `scan-${generatedAt.replace(/[:.Z]/g, "-")}-${shortCommit(commit) ?? "nocommit"}`;
  const snapshotPath = await writeSnapshotFile(
    context,
    snapshotDirectory,
    baseName,
    JSON.stringify(snapshot, null, 2),
  );

  const changedOnly = input.changedOnly === true;
  let changedFiles: readonly string[] = [];
  if (changedOnly) {
    const diff = await context.git(["diff", "--name-only", "HEAD"]);
    changedFiles = changedFilesFromGitOutput(diff.stdout);
  }

  const changedHotspots = changedOnly
    ? snapshot.analysis.risk.hotspots
        .filter((hotspot) => changedFiles.includes(hotspot.file))
        .map((hotspot) => ({ file: hotspot.file, score: hotspot.score }))
    : [];

  return jsonResult({
    snapshotPath,
    generatedAt,
    commit,
    riskScore: snapshot.analysis.risk.riskScore,
    healthScore: snapshot.analysis.health.healthScore,
    hotspotCount: snapshot.analysis.risk.hotspots.length,
    scope: changedOnly ? "working_tree_changed" : "repository",
    changedFiles: [...changedFiles],
    changedHotspots,
  });
};

const searchFindings = async (
  context: McpServerContext,
  input: {
    path?: string | undefined;
    severity?: z.infer<typeof findingSeverityEnum> | undefined;
    rule?: z.infer<typeof ownershipRuleEnum> | undefined;
    status?: z.infer<typeof ownershipStatusEnum> | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<ReturnType<typeof jsonResult>> => {
  if (input.path !== undefined && isAbsolute(input.path)) {
    throw new McpToolError("path_outside_root", `path "${input.path}" must be repository-relative`);
  }
  const pathPrefix = input.path === undefined ? "" : normalizePathPrefix(input.path);

  const audit = await context.cache.getOwnershipAudit("HEAD");
  if (!audit.available) {
    return jsonResult({
      findings: [],
      nextCursor: null,
      total: 0,
      warnings: ["no CODEOWNERS file is available at HEAD: no ownership findings"],
    });
  }

  const filters: FindingFilters = {
    ...(pathPrefix === "" ? {} : { path: pathPrefix }),
    ...(input.severity === undefined ? {} : { severity: input.severity }),
    ...(input.rule === undefined ? {} : { rule: input.rule }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  const findings = filterFindings(toFindings(audit), filters);
  const offset = decodeCursor(input.cursor);
  const { page, nextCursor } = paginate(findings, offset, input.limit);

  return jsonResult({
    findings: page.map((finding) => ({ ...finding })),
    nextCursor,
    total: findings.length,
    warnings: [...audit.warnings],
  });
};

export const registerCodeSentinelTools = (server: McpServer, context: McpServerContext): void => {
  server.registerTool(
    "get_file_owner",
    {
      title: "Get file owner",
      description:
        "Report the declared CODEOWNERS owners, observed authorship and criticality of one tracked file.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Repository-relative path of the file"),
      }),
      outputSchema: fileOwnerOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await getFileOwner(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_file_risk",
    {
      title: "Get file risk",
      description:
        "Report the composed structural, evolution and external risk score of one analyzed file.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Repository-relative path of the file"),
        ref: z.string().optional().describe('Git ref, only "HEAD" is supported'),
      }),
      outputSchema: fileRiskOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await getFileRisk(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_reading_path",
    {
      title: "Get reading path",
      description:
        "Order the files to read first for a file or directory target, with ownership and activity evidence.",
      inputSchema: z.object({
        target: z.string().min(1).describe("Repository-relative file or directory target"),
        maxSteps: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Maximum number of steps in the reading path"),
      }),
      outputSchema: readingPathOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await getReadingPath(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_trend",
    {
      title: "Get trend",
      description:
        "Read repository-level metric history from snapshot artifacts, ordered oldest to newest.",
      inputSchema: z.object({
        metric: trendMetricEnum.describe("Repository metric to read"),
        path: z
          .string()
          .optional()
          .describe("Unsupported: snapshots record repository-level metrics only"),
        since: trendSinceSchema.optional().describe("ISO date or day window such as 90d"),
        until: trendUntilSchema.optional().describe("Inclusive ISO upper bound"),
      }),
      outputSchema: trendOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await getTrend(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_hotspots",
    {
      title: "List hotspots",
      description: "List the repository risk hotspots in rank order, with cursor pagination.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20).describe("Page size"),
        cursor: z.string().optional().describe("Opaque cursor from a previous page"),
      }),
      outputSchema: hotspotsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await listHotspots(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "run_scan",
    {
      title: "Run scan",
      description:
        "Analyze the repository (or a sub-path) and write a snapshot under .codesentinel/snapshots.",
      inputSchema: z.object({
        path: z.string().optional().describe("Sub-path of the repository root"),
        changedOnly: z
          .boolean()
          .optional()
          .describe("Also report hotspots touched by the working-tree diff against HEAD"),
      }),
      outputSchema: runScanOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await runScan(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "search_findings",
    {
      title: "Search findings",
      description:
        "Search declared-ownership findings by path, severity, rule or status, with cursor pagination.",
      inputSchema: z.object({
        path: z.string().optional().describe("File or directory path prefix"),
        severity: findingSeverityEnum.optional().describe("Finding severity"),
        rule: ownershipRuleEnum.optional().describe("SARIF ownership rule id"),
        status: ownershipStatusEnum.optional().describe("Ownership status"),
        cursor: z.string().optional().describe("Opaque cursor from a previous page"),
        limit: z.number().int().min(1).max(100).default(20).describe("Page size"),
      }),
      outputSchema: findingsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return await searchFindings(context, input);
      } catch (error) {
        return toToolErrorResult(error);
      }
    },
  );
};
