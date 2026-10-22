import { describe, expect, it } from "vitest";
import type { OwnershipAuthor } from "../domain/identity.js";
import {
  DEFAULT_IGNORED_AUTHOR_PATTERNS,
  compileAuthorIgnorePatterns,
  createAuthorIgnoreMatcher,
  isBotAuthor,
} from "./ignore-authors.js";

const author = (authorId: string, authorName?: string): OwnershipAuthor =>
  authorName === undefined ? { authorId, commits: 1 } : { authorId, authorName, commits: 1 };

describe("DEFAULT_IGNORED_AUTHOR_PATTERNS", () => {
  it("lists the documented defaults in a stable order", () => {
    expect(DEFAULT_IGNORED_AUTHOR_PATTERNS).toEqual([
      "*[bot]*",
      "*-bot@*",
      "*bot@users.noreply.github.com",
      "semantic-release-bot@*",
      "renovate@*",
      "dependabot@*",
      "github-actions@*",
      "noreply@github.com",
    ]);
  });
});

describe("createAuthorIgnoreMatcher", () => {
  it("ignores the semantic-release bot by default", () => {
    expect(isBotAuthor(author("semantic-release-bot@martynus.net"))).toBe(true);
  });

  it("ignores renovate by id and by name", () => {
    const matcher = createAuthorIgnoreMatcher();

    expect(matcher(author("renovate[bot]@users.noreply.github.com"))).toBe(true);
    expect(matcher(author("update@example.com", "Renovate[bot]"))).toBe(true);
  });

  it("ignores GitHub noreply senders", () => {
    expect(isBotAuthor(author("noreply@github.com"))).toBe(true);
  });

  it("matches author ids case-insensitively", () => {
    expect(isBotAuthor(author("Semantic-Release-Bot@Martynus.Net"))).toBe(true);
    expect(isBotAuthor(author("RENOVATE@example.com"))).toBe(true);
  });

  it("does not ignore a human author", () => {
    expect(isBotAuthor(author("marta@company.com", "Marta Gil"))).toBe(false);
  });

  it("ignores a house bot through an extra pattern", () => {
    const matcher = createAuthorIgnoreMatcher(["acme-robot@*"]);

    expect(matcher(author("acme-robot@company.com"))).toBe(true);
    expect(matcher(author("marta@company.com"))).toBe(false);
  });

  it("matches on the author name alone", () => {
    const matcher = createAuthorIgnoreMatcher(["*release bot*"]);

    expect(matcher(author("automation@company.com", "Acme Release Bot"))).toBe(true);
    expect(matcher(author("automation@company.com", "Acme Release Engineer"))).toBe(false);
  });

  it("treats brackets in *[bot]* as literal characters", () => {
    const matcher = compileAuthorIgnorePatterns(["*[bot]*"]);

    expect(matcher(author("xb@example.com"))).toBe(false);
    expect(matcher(author("dependabot[bot]@users.noreply.github.com"))).toBe(true);
  });

  it("treats ? as exactly one character", () => {
    const matcher = createAuthorIgnoreMatcher(["ops-?@example.com"]);

    expect(matcher(author("ops-1@example.com"))).toBe(true);
    expect(matcher(author("ops-12@example.com"))).toBe(false);
    expect(matcher(author("ops-@example.com"))).toBe(false);
  });

  it("drops empty patterns", () => {
    const matcher = compileAuthorIgnorePatterns(["", "   "]);

    expect(matcher(author("dependabot[bot]@users.noreply.github.com"))).toBe(false);
  });

  it("collapses duplicate extra patterns case-insensitively", () => {
    const matcher = createAuthorIgnoreMatcher(["acme-robot@*", "ACME-ROBOT@*"]);

    expect(matcher(author("acme-robot@company.com"))).toBe(true);
  });

  it("cannot disable the defaults with extra patterns", () => {
    const matcher = createAuthorIgnoreMatcher(["marta@company.com"]);

    expect(matcher(author("marta@company.com"))).toBe(true);
    expect(matcher(author("renovate[bot]@users.noreply.github.com"))).toBe(true);
  });
});
