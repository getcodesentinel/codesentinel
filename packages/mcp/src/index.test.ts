import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { spawnCodesentinelMcp } from "./index.js";

type ChildStub = EventEmitter & { kill: ReturnType<typeof vi.fn> };

const createChildProcessStub = (): ChildStub => {
  const child = new EventEmitter() as ChildStub;
  child.kill = vi.fn();
  return child;
};

const expectedCliEntry = (): string =>
  createRequire(import.meta.url).resolve("@getcodesentinel/codesentinel");

describe("spawnCodesentinelMcp", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the CLI entry and forwards the mcp subcommand", () => {
    const child = createChildProcessStub();
    spawnMock.mockReturnValue(child);
    const onSpy = vi.spyOn(process, "on");

    const spawned = spawnCodesentinelMcp(["--log-level", "debug"]);

    expect(spawned).toBe(child);
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [expectedCliEntry(), "mcp", "--log-level", "debug"],
      { stdio: "inherit", env: process.env },
    );

    const sigint = onSpy.mock.calls.find(([event]) => event === "SIGINT")?.[1] as
      ((signal: NodeJS.Signals) => void) | undefined;
    const sigterm = onSpy.mock.calls.find(([event]) => event === "SIGTERM")?.[1] as
      ((signal: NodeJS.Signals) => void) | undefined;
    sigint?.("SIGINT");
    sigterm?.("SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGINT");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGTERM");

    child.emit("exit", 3, null);
    expect(process.exitCode).toBe(3);
  });

  it("propagates a missing exit code as failure", () => {
    const child = createChildProcessStub();
    spawnMock.mockReturnValue(child);

    spawnCodesentinelMcp([]);
    child.emit("exit", null, "SIGTERM");

    expect(process.exitCode).toBe(1);
  });

  it("propagates spawn errors as failure", () => {
    const child = createChildProcessStub();
    spawnMock.mockReturnValue(child);

    spawnCodesentinelMcp([]);
    child.emit("error", new Error("spawn failed"));

    expect(process.exitCode).toBe(1);
  });
});
