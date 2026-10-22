import type { FileAuthorShare } from "@codesentinel/core";
import { describe, expect, it } from "vitest";
import { medianOf, resolveMaxSteps, topAuthorId } from "./ordering.js";
import { DEFAULT_MAX_STEPS, MAX_MAX_STEPS, MIN_MAX_STEPS } from "./types.js";

const share = (authorId: string, commits: number): FileAuthorShare => ({
  authorId,
  commits,
  share: commits,
});

describe("resolveMaxSteps", () => {
  it("uses the default for missing or non-finite values", () => {
    expect(resolveMaxSteps(undefined)).toBe(DEFAULT_MAX_STEPS);
    expect(resolveMaxSteps(Number.NaN)).toBe(DEFAULT_MAX_STEPS);
    expect(resolveMaxSteps(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_STEPS);
    expect(resolveMaxSteps(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_MAX_STEPS);
  });

  it("clamps to the supported range and truncates fractions", () => {
    expect(resolveMaxSteps(0)).toBe(MIN_MAX_STEPS);
    expect(resolveMaxSteps(-10)).toBe(MIN_MAX_STEPS);
    expect(resolveMaxSteps(MAX_MAX_STEPS + 1)).toBe(MAX_MAX_STEPS);
    expect(resolveMaxSteps(8.9)).toBe(8);
    expect(resolveMaxSteps(3)).toBe(3);
  });
});

describe("medianOf", () => {
  it("handles empty, odd and even collections", () => {
    expect(medianOf([])).toBe(0);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("topAuthorId", () => {
  it("picks the highest commit count, ties by author id and ignores empty ids", () => {
    expect(topAuthorId([])).toBeNull();
    expect(topAuthorId([share("", 100)])).toBeNull();
    expect(topAuthorId([share("bob", 3), share("marta", 5)])).toBe("marta");
    expect(topAuthorId([share("bob", 3), share("marta", 3)])).toBe("bob");
  });
});
