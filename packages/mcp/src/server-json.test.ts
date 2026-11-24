import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  mcpName?: unknown;
}

interface ServerMetadata {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  packages?: unknown;
  repository?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (url: URL): Record<string, unknown> => {
  const value: unknown = JSON.parse(readFileSync(url, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`Expected an object in ${url.pathname}`);
  }
  return value;
};

describe("MCP Registry metadata", () => {
  it("matches the package manifest", () => {
    const pkg: PackageManifest = readJson(new URL("../package.json", import.meta.url));
    const server: ServerMetadata = readJson(new URL("../server.json", import.meta.url));

    expect(typeof pkg.mcpName).toBe("string");
    expect(pkg.mcpName).toMatch(/^io\.github\.[^/]+\/[^/]+$/);
    expect(server.name).toBe(pkg.mcpName);

    expect(typeof pkg.version).toBe("string");
    expect(server.version).toBe(pkg.version);

    if (!Array.isArray(server.packages) || !isRecord(server.packages[0])) {
      throw new Error("Expected server.json packages[0] to be an object");
    }
    const packedPackage = server.packages[0];
    expect(packedPackage["version"]).toBe(pkg.version);
    expect(packedPackage["identifier"]).toBe(pkg.name);
    expect(packedPackage["registryType"]).toBe("npm");

    if (!isRecord(server.repository)) {
      throw new Error("Expected server.json repository to be an object");
    }
    expect(server.repository["subfolder"]).toBe("packages/mcp");
    expect(server.repository["source"]).toBe("github");

    expect(typeof pkg.description).toBe("string");
    if (typeof pkg.description !== "string") {
      throw new Error("Expected package description to be a string");
    }
    expect(server.description).toBe(pkg.description);
    expect(pkg.description.length).toBeLessThanOrEqual(100);
  });
});
