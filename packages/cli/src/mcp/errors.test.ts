import { describe, expect, it } from "vitest";
import { McpToolError, redactSecrets, toToolErrorResult } from "./errors.js";

describe("redactSecrets", () => {
  it("redacts GitHub personal access tokens", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const result = redactSecrets(`failed with ${token}`);
    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts fine-grained GitHub tokens and their variants", () => {
    const fineGrained = `github_pat_${"b".repeat(30)}`;
    const oauth = `gho_${"c".repeat(30)}`;
    const result = redactSecrets(`${fineGrained} ${oauth}`);
    expect(result).not.toContain(fineGrained);
    expect(result).not.toContain(oauth);
  });

  it("redacts bearer headers", () => {
    const result = redactSecrets("Authorization: Bearer abc.def-123");
    expect(result).not.toContain("abc.def-123");
    expect(result).toContain("Bearer [REDACTED]");
  });

  it("redacts credentials embedded in URLs", () => {
    const result = redactSecrets("clone https://user:super-secret@github.com/acme/repo");
    expect(result).not.toContain("super-secret");
    expect(result).toContain("//[REDACTED]@");
  });

  it("redacts token query parameters", () => {
    const result = redactSecrets("request failed for token=abc123&ref=main");
    expect(result).not.toContain("abc123");
    expect(result).toContain("token=[REDACTED]");
  });

  it("leaves normal sentences untouched", () => {
    const sentence = "The repository has 42 tracked files and 3 hotspots.";
    expect(redactSecrets(sentence)).toBe(sentence);
  });
});

describe("toToolErrorResult", () => {
  it("maps known tool error codes and messages", () => {
    const result = toToolErrorResult(new McpToolError("path_not_found", "missing file"));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: "path_not_found", message: "missing file" },
    });
  });

  it("maps unexpected errors to analysis_failed without leaking a stack", () => {
    const error = new Error(`boom ghp_${"d".repeat(36)}`);
    error.stack = `Error: boom\n    at secretFunction (/home/someone/private.ts:12:3)`;
    const result = toToolErrorResult(error);
    const text = result.content[0].text;

    expect(text).not.toContain("secretFunction");
    expect(text).not.toContain("/home/someone");
    expect(text).not.toContain("d".repeat(36));
    expect(JSON.parse(text)).toEqual({
      error: { code: "analysis_failed", message: "boom [REDACTED]" },
    });
  });
});
