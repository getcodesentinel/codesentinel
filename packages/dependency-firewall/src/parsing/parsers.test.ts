import { describe, expect, it } from "vitest";
import { parsePnpmLockfile } from "./pnpm-lock-parser.js";
import { parsePackageLock } from "./package-lock-parser.js";
import { parseYarnLock } from "./yarn-lock-parser.js";

const direct = [{ name: "a", requestedRange: "^1.0.0", scope: "prod" }] as const;

describe("lockfile parsers", () => {
  it("parses pnpm lockfile", () => {
    const raw = [
      "lockfileVersion: '9.0'",
      "packages:",
      "  a@1.0.0:",
      "    dependencies:",
      "      b: 2.0.0",
      "  b@2.0.0:",
      "    dependencies:",
      "      c: 3.0.0",
      "  c@3.0.0:",
      "",
    ].join("\n");

    const parsed = parsePnpmLockfile(raw, direct);
    expect(parsed.kind).toBe("pnpm");
    expect(parsed.nodes.find((node) => node.name === "a")?.dependencies).toEqual(["b@2.0.0"]);
  });

  it("parses package-lock", () => {
    const raw = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { a: "^1.0.0" } },
        "node_modules/a": { version: "1.0.0", dependencies: { b: "2.0.0" } },
        "node_modules/b": { version: "2.0.0" },
      },
    });

    const parsed = parsePackageLock(raw, direct);
    expect(parsed.nodes.find((node) => node.name === "a")?.version).toBe("1.0.0");
  });

  it("parses yarn lock", () => {
    const raw = [
      'a@^1.0.0:',
      '  version "1.0.1"',
      '  dependencies:',
      '    b "^2.0.0"',
      '',
      'b@^2.0.0:',
      '  version "2.1.0"',
      '',
    ].join("\n");

    const parsed = parseYarnLock(raw, direct);
    expect(parsed.kind).toBe("yarn");
    expect(parsed.nodes.some((node) => node.name === "a" && node.version === "1.0.1")).toBe(true);
  });
});
