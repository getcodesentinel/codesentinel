import { readFile, writeFile } from "node:fs/promises";
import {
  parsePrCommentInput,
  PrCommentConfigurationError,
  renderPrCommentBody,
} from "./format-pr-comment.js";
import { createGitHubPrCommentClient } from "./github-pr-comment-client.js";
import { createSilentLogger, type Logger } from "./logger.js";
import {
  publishPrComment,
  type PrCommentAction,
  type PrCommentMode,
} from "./publish-pr-comment.js";

export const COMMENT_EXIT_CODES = {
  ok: 0,
  invalidConfiguration: 2,
} as const;

export type CommentCommandOptions = {
  inputPath: string;
  pullRequest?: number;
  mode?: PrCommentMode;
  repository?: string;
  token?: string;
  outputPath?: string;
  fetchImpl?: typeof fetch;
};

export type CommentCommandResult = {
  body: string;
  mode: PrCommentMode;
  action: PrCommentAction | "not-requested";
  reason?: string;
  commentId?: number;
  outputPath?: string;
  exitCode: number;
};

const readCiJson = async (inputPath: string): Promise<unknown> => {
  const raw = await readFile(inputPath, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PrCommentConfigurationError(`invalid CI JSON input: ${inputPath} is not valid JSON`);
  }
};

const nonEmpty = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }
  return value.trim().length === 0 ? null : value;
};

export const runCommentCommand = async (
  options: CommentCommandOptions,
  logger: Logger = createSilentLogger(),
): Promise<CommentCommandResult> => {
  const input = parsePrCommentInput(await readCiJson(options.inputPath));
  const body = renderPrCommentBody(input);
  const mode = options.mode ?? "change";

  if (options.outputPath !== undefined) {
    await writeFile(options.outputPath, `${body}\n`, "utf8");
    logger.info(`comment body written: ${options.outputPath}`);
  }

  const output = options.outputPath === undefined ? {} : { outputPath: options.outputPath };

  if (options.pullRequest === undefined) {
    logger.info("no pull request provided; rendered the comment body without posting");
    return {
      body,
      mode,
      action: "not-requested",
      exitCode: COMMENT_EXIT_CODES.ok,
      ...output,
    };
  }

  if (mode === "never") {
    return {
      body,
      mode,
      action: "skipped",
      reason: "comment-on never",
      exitCode: COMMENT_EXIT_CODES.ok,
      ...output,
    };
  }

  const token = nonEmpty(options.token ?? process.env["GITHUB_TOKEN"]);
  if (token === null) {
    throw new PrCommentConfigurationError(
      "GITHUB_TOKEN is not set; set it in the environment to post a pull request comment.",
    );
  }

  const repository = nonEmpty(options.repository ?? process.env["GITHUB_REPOSITORY"]);
  if (repository === null) {
    throw new PrCommentConfigurationError(
      "GITHUB_REPOSITORY is not set; pass --repository or set GITHUB_REPOSITORY.",
    );
  }

  const client = createGitHubPrCommentClient({
    repository,
    pullRequest: options.pullRequest,
    token,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const published = await publishPrComment(client, body, mode);
  logger.info(`pull request comment ${published.action}`);

  return {
    body,
    mode,
    action: published.action,
    ...(published.reason === undefined ? {} : { reason: published.reason }),
    ...(published.commentId === undefined ? {} : { commentId: published.commentId }),
    exitCode: COMMENT_EXIT_CODES.ok,
    ...output,
  };
};
