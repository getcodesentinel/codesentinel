import { describe, expect, it } from "vitest";
import { resolveTargetPath } from "./index.ts";

describe("resolveTargetPath", () => {
  it("resolves provided path against cwd", () => {
    const target = resolveTargetPath("src", "/repo");
    expect(target.absolutePath).toBe("/repo/src");
  });

  it("defaults to current directory when no input path is given", () => {
    const target = resolveTargetPath(undefined, "/repo");
    expect(target.absolutePath).toBe("/repo");
  });
});
