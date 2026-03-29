import { spawn } from "node:child_process";
import { platform } from "node:os";

const openCommandForPlatform = (
  targetPath: string,
): { command: string; args: string[] } | undefined => {
  switch (platform()) {
    case "darwin":
      return { command: "open", args: [targetPath] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", targetPath] };
    case "linux":
      return { command: "xdg-open", args: [targetPath] };
    default:
      return undefined;
  }
};

export const openPath = async (targetPath: string): Promise<boolean> => {
  const command = openCommandForPlatform(targetPath);
  if (command === undefined) {
    return false;
  }

  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
};
