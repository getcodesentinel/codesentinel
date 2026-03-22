import { describe, expect, it } from "vitest";
import { splitShellLikeArgs } from "./interactive-menu.js";

describe("splitShellLikeArgs", () => {
  it("splits plain whitespace-delimited arguments", () => {
    expect(splitShellLikeArgs("--format md --top 5")).toEqual(["--format", "md", "--top", "5"]);
  });

  it("preserves quoted segments", () => {
    expect(splitShellLikeArgs("--file \"src/index.ts\" --module 'core/api'")).toEqual([
      "--file",
      "src/index.ts",
      "--module",
      "core/api",
    ]);
  });

  it("keeps escaped whitespace inside a token", () => {
    expect(splitShellLikeArgs("--output reports\\ current.md")).toEqual([
      "--output",
      "reports current.md",
    ]);
  });

  it("throws on unterminated quotes", () => {
    expect(() => splitShellLikeArgs('--file "src/index.ts')).toThrow(
      "Unterminated quoted argument",
    );
  });
});
