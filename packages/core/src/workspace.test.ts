import { describe, expect, it } from "vitest";
import {
  createWorkspaceByFile,
  fileBelongsToWorkspace,
  findWorkspaceForFile,
  type WorkspacePackage,
} from "./index.js";

const appWorkspace: WorkspacePackage = { name: "@acme/app", path: "apps/web", kind: "app" };
const featureWorkspace: WorkspacePackage = {
  name: "@acme/app-feature",
  path: "apps/web/feature",
  kind: "package",
};
const workspaces: readonly WorkspacePackage[] = [
  appWorkspace,
  featureWorkspace,
  { name: "@acme/api", path: "apps/api", kind: "app" },
];

describe("workspace membership", () => {
  it("matches files by exact workspace path or path prefix", () => {
    expect(fileBelongsToWorkspace("apps/web", appWorkspace)).toBe(true);
    expect(fileBelongsToWorkspace("apps/web/src/page.ts", appWorkspace)).toBe(true);
    expect(fileBelongsToWorkspace("apps/web-legacy/src/page.ts", appWorkspace)).toBe(false);
  });

  it("normalizes Windows-style file paths", () => {
    expect(fileBelongsToWorkspace("apps\\web\\src\\page.ts", appWorkspace)).toBe(true);
  });

  it("returns the longest matching workspace", () => {
    expect(findWorkspaceForFile("apps/web/feature/src/index.ts", workspaces)).toEqual(
      featureWorkspace,
    );
  });

  it("creates deterministic workspace membership maps", () => {
    expect([
      ...createWorkspaceByFile(["apps/web/src/page.ts", "unknown/file.ts"], workspaces),
    ]).toEqual([["apps/web/src/page.ts", appWorkspace]]);
  });
});
