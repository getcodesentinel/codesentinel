import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPath } from "./open-path.js";

const { spawnMock, platformMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  platformMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:os", () => ({
  platform: platformMock,
}));

const createChildProcessStub = (): EventEmitter & { unref: ReturnType<typeof vi.fn> } => {
  const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  child.unref = vi.fn();
  return child;
};

describe("openPath", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    platformMock.mockReset();
  });

  it("uses the platform opener on macOS", async () => {
    platformMock.mockReturnValue("darwin");
    const child = createChildProcessStub();
    spawnMock.mockReturnValue(child);

    const openPromise = openPath("/tmp/report/index.html");
    child.emit("spawn");

    await expect(openPromise).resolves.toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("open", ["/tmp/report/index.html"], {
      detached: true,
      stdio: "ignore",
    });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("returns false on unsupported platforms", async () => {
    platformMock.mockReturnValue("freebsd");

    await expect(openPath("/tmp/report/index.html")).resolves.toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
