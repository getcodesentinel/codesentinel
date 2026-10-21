import { describe, expect, it } from "vitest";
import { normalizeGitAuthorIdentity, normalizeRepositoryPath } from "./owners-git.js";

describe("normalizeGitAuthorIdentity", () => {
  it("collapses numeric-prefixed GitHub noreply addresses to the handle form used by CODEOWNERS", () => {
    expect(normalizeGitAuthorIdentity("Marta Gil", "64553911+marta@users.noreply.github.com")).toBe(
      "marta@users.noreply.github.com",
    );
  });

  it("keeps the bare noreply address and lowercases plain emails", () => {
    expect(normalizeGitAuthorIdentity("Marta", "Marta@users.noreply.github.com")).toBe(
      "marta@users.noreply.github.com",
    );
    expect(normalizeGitAuthorIdentity("Marta Gil", "Marta.Gil@Example.com")).toBe(
      "marta.gil@example.com",
    );
  });

  it("keeps the bot marker so bots never resolve to a human handle", () => {
    expect(
      normalizeGitAuthorIdentity(
        "dependabot[bot]",
        "49699333+dependabot[bot]@users.noreply.github.com",
      ),
    ).toBe("49699333+dependabot[bot]@users.noreply.github.com");
  });

  it("falls back to the author name when the email is empty", () => {
    expect(normalizeGitAuthorIdentity("Marta Gil", "   ")).toBe("marta gil");
  });
});

describe("normalizeRepositoryPath", () => {
  it("normalizes explicit CODEOWNERS paths to repository-relative posix form", () => {
    expect(normalizeRepositoryPath("./docs/CODEOWNERS")).toBe("docs/CODEOWNERS");
    expect(normalizeRepositoryPath("/.github/CODEOWNERS")).toBe(".github/CODEOWNERS");
    expect(normalizeRepositoryPath("docs\\CODEOWNERS")).toBe("docs/CODEOWNERS");
  });
});
