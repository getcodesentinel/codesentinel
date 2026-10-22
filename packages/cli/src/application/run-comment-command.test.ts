import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PR_COMMENT_MARKER, PrCommentConfigurationError } from "./format-pr-comment.js";
import { runCommentCommand } from "./run-comment-command.js";

const CI_INPUT = {
  current: {
    analysis: {
      risk: { riskScore: 42.13 },
      health: { healthScore: 78.4 },
    },
    ownership: {
      available: true,
      metrics: {
        unownedCriticalCount: 3,
        ghostOwnerCount: 1,
        driftPercent: 23.29,
      },
      files: [
        {
          filePath: "payments/refund.ts",
          status: "unowned-critical",
          declared: [],
          observed: { commits: 31, authors: 4 },
          criticality: { fanIn: 12 },
        },
      ],
    },
  },
};

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "codesentinel-comment-"));
  temporaryDirectories.push(directory);
  return directory;
};

const writeInput = (): string => {
  const directory = createTemporaryDirectory();
  const inputPath = join(directory, "ci.json");
  writeFileSync(inputPath, JSON.stringify(CI_INPUT), "utf8");
  return inputPath;
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const requestBody = (init: RequestInit | undefined): string =>
  typeof init?.body === "string" ? init.body : "";

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("runCommentCommand", () => {
  it("renders without posting when --pr is absent", async () => {
    const inputPath = writeInput();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runCommentCommand({ inputPath, fetchImpl });

    expect(result.action).toBe("not-requested");
    expect(result.exitCode).toBe(0);
    expect(result.body.startsWith(PR_COMMENT_MARKER)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a comment with POST when no marker comment exists", async () => {
    const inputPath = writeInput();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: 500, body: "created" }));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const result = await runCommentCommand({
      inputPath,
      pullRequest: 7,
      repository: "acme/repo",
      token: "secret-token",
      fetchImpl,
    });

    expect(result.action).toBe("created");
    expect(result.commentId).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const postCall = fetchImpl.mock.calls[1];
    expect(postCall?.[1]?.method).toBe("POST");
    expect(requestUrl(postCall?.[0] ?? "")).toContain("/repos/acme/repo/issues/7/comments");
    const headers = new Headers(postCall?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(requestBody(postCall?.[1])).not.toContain("secret-token");
  });

  it("updates the sticky comment with PATCH when it already exists", async () => {
    const inputPath = writeInput();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ id: 123, body: "updated" }));
      }
      return Promise.resolve(jsonResponse([{ id: 123, body: `${PR_COMMENT_MARKER}\nold body` }]));
    });

    const result = await runCommentCommand({
      inputPath,
      pullRequest: 7,
      repository: "acme/repo",
      token: "secret-token",
      fetchImpl,
    });

    expect(result.action).toBe("updated");
    expect(result.commentId).toBe(123);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const patchCall = fetchImpl.mock.calls[1];
    expect(patchCall?.[1]?.method).toBe("PATCH");
    expect(requestUrl(patchCall?.[0] ?? "")).toContain("/repos/acme/repo/issues/comments/123");
    const headers = new Headers(patchCall?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(requestBody(patchCall?.[1])).not.toContain("secret-token");
  });

  it("requires GITHUB_TOKEN when --pr is provided", async () => {
    const inputPath = writeInput();
    const originalToken = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];

    try {
      await expect(
        runCommentCommand({ inputPath, pullRequest: 7, repository: "acme/repo" }),
      ).rejects.toBeInstanceOf(PrCommentConfigurationError);
    } finally {
      if (originalToken !== undefined) {
        process.env["GITHUB_TOKEN"] = originalToken;
      }
    }
  });

  it("writes the body with a trailing newline when --output is used", async () => {
    const inputPath = writeInput();
    const directory = createTemporaryDirectory();
    const outputPath = join(directory, "comment.md");

    const result = await runCommentCommand({ inputPath, outputPath });

    expect(result.outputPath).toBe(outputPath);
    expect(readFileSync(outputPath, "utf8")).toBe(`${result.body}\n`);
  });

  it("honours comment-on never without calling GitHub", async () => {
    const inputPath = writeInput();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runCommentCommand({
      inputPath,
      pullRequest: 7,
      mode: "never",
      repository: "acme/repo",
      token: "secret-token",
      fetchImpl,
    });

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("comment-on never");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips in change mode when the rendered body did not move", async () => {
    const inputPath = writeInput();
    const rendered = await runCommentCommand({ inputPath });
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse([{ id: 123, body: rendered.body }])),
    );

    const result = await runCommentCommand({
      inputPath,
      pullRequest: 7,
      mode: "change",
      repository: "acme/repo",
      token: "secret-token",
      fetchImpl,
    });

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("no change");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("updates in always mode even when the body is unchanged", async () => {
    const inputPath = writeInput();
    const rendered = await runCommentCommand({ inputPath });
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ id: 123, body: rendered.body }));
      }
      return Promise.resolve(jsonResponse([{ id: 123, body: rendered.body }]));
    });

    const result = await runCommentCommand({
      inputPath,
      pullRequest: 7,
      mode: "always",
      repository: "acme/repo",
      token: "secret-token",
      fetchImpl,
    });

    expect(result.action).toBe("updated");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
