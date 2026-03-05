import { homedir } from "node:os";
import { join } from "node:path";

export const resolveCodesentinelCacheDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const explicit = env["CODESENTINEL_CACHE_DIR"]?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  if (process.platform === "win32") {
    const localAppData = env["LOCALAPPDATA"]?.trim();
    if (localAppData !== undefined && localAppData.length > 0) {
      return join(localAppData, "codesentinel", "Cache");
    }
    return join(homedir(), "AppData", "Local", "codesentinel", "Cache");
  }

  const xdgCacheHome = env["XDG_CACHE_HOME"]?.trim();
  if (xdgCacheHome !== undefined && xdgCacheHome.length > 0) {
    return join(xdgCacheHome, "codesentinel");
  }

  return join(homedir(), ".cache", "codesentinel");
};
