import { describe, expect, it } from "vitest";
import type { DeclaredOwner } from "../domain/codeowners.js";
import { isVerifiableOwnerResolution } from "../domain/identity.js";
import type { OwnerResolution, OwnershipAuthor } from "../domain/identity.js";
import {
  createIdentityResolver,
  isBotAuthor,
  parseOwnerAliases,
  resolveOwnerIdentities,
} from "./resolve-identities.js";

const author = (authorId: string, commits = 1, authorName?: string): OwnershipAuthor =>
  authorName === undefined ? { authorId, commits } : { authorId, commits, authorName };

const user = (handle: string): DeclaredOwner => ({ kind: "user", handle });
const team = (org: string, slug: string): DeclaredOwner => ({ kind: "team", org, slug });
const email = (address: string): DeclaredOwner => ({ kind: "email", address });

const only = (resolutions: readonly OwnerResolution[]): OwnerResolution => {
  const [resolution] = resolutions;
  if (resolution === undefined) throw new Error("expected exactly one resolution");
  return resolution;
};

describe("isBotAuthor", () => {
  it("detects the bot marker in the identity or in the display name", () => {
    expect(isBotAuthor(author("dependabot[bot]@users.noreply.github.com"))).toBe(true);
    expect(isBotAuthor(author("ci@company.com", 1, "CI [bot]"))).toBe(true);
    expect(isBotAuthor(author("marta@company.com", 1, "Marta"))).toBe(false);
  });
});

describe("resolveOwnerIdentities", () => {
  it("matches a normalized noreply id exactly", () => {
    const [resolution] = resolveOwnerIdentities(
      [user("octocat")],
      [author("octocat@users.noreply.github.com", 3)],
    );

    expect(resolution?.kind).toBe("github_noreply");
    expect(resolution?.activeAuthorIds).toEqual(["octocat@users.noreply.github.com"]);
  });

  it("does not guess an unnormalized numeric noreply id", () => {
    // `normalizeAuthorIdentity` in git-log-parser strips `123+` before the audit ever sees the id.
    // An unnormalized id is a caller bug, and silently matching it would hide that bug.
    const [resolution] = resolveOwnerIdentities(
      [user("octocat")],
      [author("123+octocat@users.noreply.github.com", 3)],
    );

    expect(resolution?.kind).toBe("no_activity");
    expect(resolution?.activeAuthorIds).toEqual([]);
  });

  it("matches the email local part, case-insensitively", () => {
    const [resolution] = resolveOwnerIdentities(
      [user("Marta.Gil")],
      [author("Marta.Gil@Company.com", 2)],
    );

    expect(resolution?.kind).toBe("email_local_part");
    expect(resolution?.activeAuthorIds).toEqual(["Marta.Gil@Company.com"]);
  });

  it("matches the normalized author name when the email says nothing", () => {
    const [resolution, second] = resolveOwnerIdentities(
      [user("martagil"), user("marta.gil")],
      [author("mg@company.com", 2, "Marta  Gil")],
    );

    expect(resolution?.kind).toBe("author_name");
    // Normalization removes spaces but keeps dots, so a dotted handle does not match the name.
    expect(second?.kind).toBe("no_activity");
  });

  it("matches through the alias map, including keys written with @", () => {
    const resolve = createIdentityResolver({ "@Marta": ["marta.gil@company.com"] });

    const resolution = resolve(user("marta"), [author("Marta.Gil@company.com", 5)]);

    expect(resolution.kind).toBe("alias");
    expect(resolution.activeAuthorIds).toEqual(["Marta.Gil@company.com"]);
  });

  it("excludes bots even when their email would match the handle", () => {
    const [resolution] = resolveOwnerIdentities(
      [user("ci")],
      [author("ci@company.com", 40, "CI [bot]")],
    );

    expect(resolution?.kind).toBe("no_activity");
    expect(resolution?.activeAuthorIds).toEqual([]);
  });

  it("marks teams as unverified and never verifiable", () => {
    const resolution = only(
      resolveOwnerIdentities([team("acme", "ops")], [author("someone@company.com", 4)]),
    );

    expect(resolution.kind).toBe("team_unverified");
    expect(isVerifiableOwnerResolution(resolution)).toBe(false);
  });

  it("matches an email owner against the exact author id", () => {
    const [resolution] = resolveOwnerIdentities(
      [email("Docs@Example.com")],
      [author("docs@example.com", 3)],
    );

    expect(resolution?.kind).toBe("email_owner");
    expect(resolution?.activeAuthorIds).toEqual(["docs@example.com"]);
  });

  it("flags an alias map entry that never shows up in the window", () => {
    const resolution = only(
      resolveOwnerIdentities([user("marta")], [author("someone@company.com", 3)], {
        marta: ["marta.gil@company.com"],
      }),
    );

    expect(resolution.kind).toBe("alias_unresolved");
    expect(isVerifiableOwnerResolution(resolution)).toBe(false);
  });

  it("applies the cascade in order and reports the first step that matched", () => {
    const [resolution] = resolveOwnerIdentities(
      [user("marta")],
      [
        author("marta@users.noreply.github.com", 1),
        author("marta@company.com", 2),
        author("third@company.com", 3, "Marta"),
      ],
      { marta: ["marta@company.com"] },
    );

    expect(resolution?.kind).toBe("github_noreply");
    expect(resolution?.activeAuthorIds).toEqual(["marta@users.noreply.github.com"]);
  });

  it("collects every author covered by the same cascade step, in evidence order", () => {
    const [resolution] = resolveOwnerIdentities(
      [user("marta")],
      [author("marta@company.com", 2), author("marta@contractors.dev", 1)],
    );

    expect(resolution?.kind).toBe("email_local_part");
    expect(resolution?.activeAuthorIds).toEqual(["marta@company.com", "marta@contractors.dev"]);
  });

  it("does not attribute anything when there are no authors", () => {
    const resolve = createIdentityResolver();
    expect(resolve(user("marta"), []).kind).toBe("no_activity");
    expect(resolve(team("acme", "ops"), []).kind).toBe("team_unverified");
    expect(resolve(email("docs@example.com"), []).kind).toBe("email_owner");
  });
});

describe("parseOwnerAliases", () => {
  it("treats a missing or empty file as no aliases and no warnings", () => {
    for (const raw of [null, undefined, "", "   "]) {
      const parsed = parseOwnerAliases(raw);
      expect(parsed.aliases).toEqual({});
      expect(parsed.warnings).toEqual([]);
    }
  });

  it("normalizes handles and deduplicates author ids", () => {
    const parsed = parseOwnerAliases(
      JSON.stringify({
        aliases: { "@Marta": ["Marta@Company.com", "marta@company.com"], jordi: ["jordi@x.dev"] },
      }),
    );

    expect(parsed.aliases).toEqual({
      marta: ["marta@company.com"],
      jordi: ["jordi@x.dev"],
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("warns instead of failing when the JSON is broken", () => {
    const parsed = parseOwnerAliases("{ aliases: ");
    expect(parsed.aliases).toEqual({});
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("not valid JSON");
  });

  it("warns about unusable entries and keeps the rest", () => {
    const parsed = parseOwnerAliases(
      JSON.stringify({
        aliases: {
          marta: ["marta@company.com"],
          jordi: "jordi@company.com",
          empty: [],
          broken: [1, null, "  "],
          "": ["x@y.dev"],
        },
      }),
    );

    expect(parsed.aliases).toEqual({ marta: ["marta@company.com"] });
    expect(parsed.warnings).toEqual([
      'Alias entry "jordi" was ignored: expected an array of author ids.',
      'Alias entry "empty" was ignored: it contains no usable author id.',
      'Alias entry "broken" was ignored: it contains no usable author id.',
      "An alias entry with an empty handle was ignored.",
    ]);
  });

  it("warns when aliases is not an object", () => {
    expect(parseOwnerAliases('{"aliases": []}').warnings).toHaveLength(1);
    expect(parseOwnerAliases("[]").warnings).toHaveLength(1);
  });

  it("accepts a file without an aliases key", () => {
    const parsed = parseOwnerAliases('{"version": 1}');
    expect(parsed.aliases).toEqual({});
    expect(parsed.warnings).toEqual([]);
  });
});
