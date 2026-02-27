import { describe, expect, it } from "vitest";
import { parsePackageJson } from "./package-json-loader.js";

describe("parsePackageJson", () => {
  it("assigns prod/dev scopes and gives prod precedence for duplicate dependencies", () => {
    const parsed = parsePackageJson(
      JSON.stringify({
        dependencies: { a: "^1.0.0", shared: "^2.0.0" },
        optionalDependencies: { optionalOnly: "^3.0.0" },
        peerDependencies: { peerOnly: "^4.0.0" },
        devDependencies: { b: "^5.0.0", shared: "^6.0.0" },
      }),
    );

    expect(parsed).toEqual([
      { name: "a", requestedRange: "^1.0.0", scope: "prod" },
      { name: "b", requestedRange: "^5.0.0", scope: "dev" },
      { name: "optionalOnly", requestedRange: "^3.0.0", scope: "prod" },
      { name: "peerOnly", requestedRange: "^4.0.0", scope: "prod" },
      { name: "shared", requestedRange: "^2.0.0", scope: "prod" },
    ]);
  });
});
