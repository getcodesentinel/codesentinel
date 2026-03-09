import { describe, expect, it } from "vitest";
import {
  compareVersions,
  parseNpmViewVersionOutput,
  renderUpdateInProgressMessage,
  renderUpdateSuccessMessage,
  shouldRunUpdateCheck,
} from "./check-for-updates.js";

describe("compareVersions", () => {
  it("compares stable semver values", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.2", "1.2.3")).toBe(-1);
  });

  it("handles prerelease precedence", () => {
    expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBe(1);
    expect(compareVersions("1.2.3-beta.2", "1.2.3-beta.1")).toBe(1);
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(-1);
  });

  it("returns null for non-semver versions", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "0.0.0dev")).toBeNull();
  });
});

describe("parseNpmViewVersionOutput", () => {
  it("parses npm json output", () => {
    expect(parseNpmViewVersionOutput('"1.2.3"\n')).toBe("1.2.3");
  });

  it("falls back to plain text output", () => {
    expect(parseNpmViewVersionOutput("1.2.3\n")).toBe("1.2.3");
  });
});

describe("shouldRunUpdateCheck", () => {
  const nowMs = Date.parse("2026-03-03T12:00:00.000Z");

  it("allows checks in interactive mode when cache is stale", () => {
    expect(
      shouldRunUpdateCheck({
        argv: ["node", "codesentinel", "analyze"],
        env: {},
        isInteractive: true,
        nowMs,
        lastCheckedAt: "2026-03-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("blocks checks in CI and with opt-out flag", () => {
    expect(
      shouldRunUpdateCheck({
        argv: ["node", "codesentinel", "analyze"],
        env: { CI: "true" },
        isInteractive: true,
        nowMs,
        lastCheckedAt: null,
      }),
    ).toBe(false);

    expect(
      shouldRunUpdateCheck({
        argv: ["node", "codesentinel", "analyze"],
        env: { CODESENTINEL_NO_UPDATE_NOTIFIER: "1" },
        isInteractive: true,
        nowMs,
        lastCheckedAt: null,
      }),
    ).toBe(false);
  });

  it("blocks checks for help/version and when checked recently", () => {
    expect(
      shouldRunUpdateCheck({
        argv: ["node", "codesentinel", "--help"],
        env: {},
        isInteractive: true,
        nowMs,
        lastCheckedAt: null,
      }),
    ).toBe(false);

    expect(
      shouldRunUpdateCheck({
        argv: ["node", "codesentinel", "--version"],
        env: {},
        isInteractive: true,
        nowMs,
        lastCheckedAt: "2026-03-03T11:30:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("update messaging", () => {
  it("renders the install command before running the update", () => {
    expect(renderUpdateInProgressMessage("@getcodesentinel/codesentinel")).toBe(
      "Updating CodeSentinel via `npm install -g @getcodesentinel/codesentinel`...\n",
    );
  });

  it("renders the post-update restart message", () => {
    expect(renderUpdateSuccessMessage()).toBe(
      "🎉 Update ran successfully! Please restart CodeSentinel.\n",
    );
  });
});
