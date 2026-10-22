import { PrCommentConfigurationError } from "./format-pr-comment.js";
import type { GitHubIssueComment, PrCommentClient } from "./publish-pr-comment.js";

export type GitHubPrCommentClientOptions = {
  repository: string;
  pullRequest: number;
  token: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
};

const DEFAULT_API_URL = "https://api.github.com";
const REPOSITORY_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseComment = (value: unknown): GitHubIssueComment | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const body = value["body"];
  if (typeof id !== "number" || !Number.isFinite(id) || typeof body !== "string") {
    return null;
  }

  return { id, body };
};

const buildHeaders = (token: string): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "codesentinel",
});

export const createGitHubPrCommentClient = (
  options: GitHubPrCommentClientOptions,
): PrCommentClient => {
  const repositoryMatch = REPOSITORY_PATTERN.exec(options.repository);
  if (repositoryMatch === null) {
    throw new PrCommentConfigurationError(
      "repository must use the owner/repo format (for example: acme/widgets)",
    );
  }
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new PrCommentConfigurationError("pull request number must be a positive integer");
  }

  const owner = repositoryMatch[1] ?? "";
  const repo = repositoryMatch[2] ?? "";
  const apiBase = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const repositoryPath = `${apiBase}/repos/${owner}/${repo}`;
  const commentsPath = `${repositoryPath}/issues/${options.pullRequest}/comments`;
  const headers = buildHeaders(options.token);
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async (url: string, init: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(url, init);
    const text = await response.text();

    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload["message"] === "string"
          ? payload["message"]
          : response.statusText.length > 0
            ? response.statusText
            : "request failed";
      throw new Error(`GitHub API request failed (${response.status}): ${message}`);
    }

    return payload;
  };

  return {
    listComments: async (): Promise<readonly GitHubIssueComment[]> => {
      const payload = await request(`${commentsPath}?per_page=100`, {
        method: "GET",
        headers,
      });
      if (!Array.isArray(payload)) {
        return [];
      }

      return payload
        .map(parseComment)
        .filter((comment): comment is GitHubIssueComment => comment !== null);
    },
    createComment: async (body: string): Promise<GitHubIssueComment> => {
      const payload = await request(commentsPath, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const comment = parseComment(payload);
      if (comment === null) {
        throw new Error("GitHub API returned an invalid comment payload");
      }
      return comment;
    },
    updateComment: async (commentId: number, body: string): Promise<GitHubIssueComment> => {
      const payload = await request(`${repositoryPath}/issues/comments/${commentId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const comment = parseComment(payload);
      if (comment === null) {
        throw new Error("GitHub API returned an invalid comment payload");
      }
      return comment;
    },
  };
};
