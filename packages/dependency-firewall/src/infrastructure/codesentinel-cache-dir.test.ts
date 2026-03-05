import { describe, expect, it, vi } from "vitest";
import { resolveCodesentinelCacheDir } from "./codesentinel-cache-dir.js";

describe("resolveCodesentinelCacheDir", () => {
  it("prefers explicit env override", () => {
    expect(
      resolveCodesentinelCacheDir({
        CODESENTINEL_CACHE_DIR: "/tmp/custom-cache",
      }),
    ).toBe("/tmp/custom-cache");
  });

  it("uses XDG cache home on non-windows platforms", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const result = resolveCodesentinelCacheDir({ XDG_CACHE_HOME: "/tmp/xdg-cache-home" });
    platformSpy.mockRestore();

    expect(result).toBe("/tmp/xdg-cache-home/codesentinel");
  });
});
