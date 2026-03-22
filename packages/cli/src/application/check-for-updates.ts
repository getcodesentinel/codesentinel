import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdin } from "node:process";
import { clearScreenDown, cursorTo, emitKeypressEvents } from "node:readline";

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CACHE_PATH = join(homedir(), ".cache", "codesentinel", "update-check.json");
const SEMVER_PATTERN =
  /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (number | string)[];
};

type UpdateCheckCache = {
  lastCheckedAt: string;
};

const parsePrereleaseIdentifier = (identifier: string): number | string => {
  if (/^\d+$/.test(identifier)) {
    return Number.parseInt(identifier, 10);
  }
  return identifier;
};

const parseSemver = (value: string): Semver | null => {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (match === null) {
    return null;
  }

  const groups = match.groups;
  if (groups === undefined) {
    return null;
  }

  const majorRaw = groups["major"];
  const minorRaw = groups["minor"];
  const patchRaw = groups["patch"];
  const prereleaseRaw = groups["prerelease"];
  if (majorRaw === undefined || minorRaw === undefined || patchRaw === undefined) {
    return null;
  }

  const prerelease =
    prereleaseRaw === undefined || prereleaseRaw.length === 0
      ? []
      : prereleaseRaw.split(".").map(parsePrereleaseIdentifier);

  return {
    major: Number.parseInt(majorRaw, 10),
    minor: Number.parseInt(minorRaw, 10),
    patch: Number.parseInt(patchRaw, 10),
    prerelease,
  };
};

const comparePrerelease = (
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): number => {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined) {
      return -1;
    }
    if (rightValue === undefined) {
      return 1;
    }

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      if (leftValue !== rightValue) {
        return leftValue > rightValue ? 1 : -1;
      }
      continue;
    }

    if (typeof leftValue === "number" && typeof rightValue === "string") {
      return -1;
    }
    if (typeof leftValue === "string" && typeof rightValue === "number") {
      return 1;
    }

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  return 0;
};

export const compareVersions = (left: string, right: string): number | null => {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  if (leftParsed === null || rightParsed === null) {
    return null;
  }

  if (leftParsed.major !== rightParsed.major) {
    return leftParsed.major > rightParsed.major ? 1 : -1;
  }
  if (leftParsed.minor !== rightParsed.minor) {
    return leftParsed.minor > rightParsed.minor ? 1 : -1;
  }
  if (leftParsed.patch !== rightParsed.patch) {
    return leftParsed.patch > rightParsed.patch ? 1 : -1;
  }

  return comparePrerelease(leftParsed.prerelease, rightParsed.prerelease);
};

const isTruthy = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const parseNpmViewVersionOutput = (output: string): string | null => {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string" && parsed.trim().length > 0) {
      return parsed.trim();
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const latest = (parsed as unknown[]).at(-1);
      if (typeof latest === "string" && latest.trim().length > 0) {
        return latest.trim();
      }
    }
  } catch {
    return trimmed;
  }

  return null;
};

export const renderUpdateInProgressMessage = (packageName: string): string =>
  `Updating CodeSentinel via \`npm install -g ${packageName}\`...\n`;

export const renderUpdateSuccessMessage = (): string =>
  "🎉 Update ran successfully! Please restart CodeSentinel.\n";

export const renderAlreadyUpToDateMessage = (currentVersion: string): string =>
  `CodeSentinel is already up to date (${currentVersion}).\n`;

export const renderUpdateCheckFailedMessage = (): string =>
  "CodeSentinel could not check for updates right now. Please try again later.\n";

const readCache = async (): Promise<UpdateCheckCache | null> => {
  try {
    const raw = await readFile(UPDATE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { lastCheckedAt?: unknown }).lastCheckedAt === "string"
    ) {
      return { lastCheckedAt: (parsed as { lastCheckedAt: string }).lastCheckedAt };
    }
  } catch {
    return null;
  }

  return null;
};

const writeCache = async (cache: UpdateCheckCache): Promise<void> => {
  await mkdir(dirname(UPDATE_CACHE_PATH), { recursive: true });
  await writeFile(UPDATE_CACHE_PATH, JSON.stringify(cache), "utf8");
};

export const shouldRunUpdateCheck = (input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  isInteractive: boolean;
  nowMs: number;
  lastCheckedAt: string | null;
}): boolean => {
  if (!input.isInteractive) {
    return false;
  }
  if (isTruthy(input.env["CI"])) {
    return false;
  }
  if (isTruthy(input.env["CODESENTINEL_NO_UPDATE_NOTIFIER"])) {
    return false;
  }
  if (input.argv.some((argument) => argument === "--help" || argument === "-h")) {
    return false;
  }
  if (input.argv.some((argument) => argument === "--version" || argument === "-V")) {
    return false;
  }

  if (input.lastCheckedAt === null) {
    return true;
  }

  const lastCheckedMs = Date.parse(input.lastCheckedAt);
  if (!Number.isFinite(lastCheckedMs)) {
    return true;
  }

  return input.nowMs - lastCheckedMs >= UPDATE_CHECK_INTERVAL_MS;
};

const runCommand = async (
  command: string,
  args: readonly string[],
  mode: "capture" | "inherit",
): Promise<{ code: number; stdout: string }> => {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      stdio: mode === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdoutRaw = "";
    if (mode === "capture" && child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutRaw += chunk;
      });
    }

    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout: stdoutRaw });
    });
  });
};

const fetchLatestVersion = async (packageName: string): Promise<string | null> => {
  const result = await runCommand("npm", ["view", packageName, "version", "--json"], "capture");
  if (result.code !== 0) {
    return null;
  }
  return parseNpmViewVersionOutput(result.stdout);
};

type UpdatePromptChoice = "install" | "skip" | "interrupt";

const renderUpdatePrompt = (
  packageName: string,
  latestVersion: string,
  currentVersion: string,
  selectedIndex: number,
): number => {
  const options: readonly string[] = [
    `1. Update now (runs \`npm install -g ${packageName}\`)`,
    "2. Skip",
  ];

  const lines = [
    `  ${ANSI.bold}${ANSI.cyan}✨ Update available! ${currentVersion} -> ${latestVersion}${ANSI.reset}`,
    "",
    `  ${ANSI.dim}Release notes: https://github.com/getcodesentinel/codesentinel/releases/latest${ANSI.reset}`,
    "",
    ...options.map((option, index) => {
      const selected = index === selectedIndex;
      const prefix = selected ? `${ANSI.green}>${ANSI.reset}` : " ";
      const text = selected ? `${ANSI.bold}${option}${ANSI.reset}` : option;
      return `${prefix} ${text}`;
    }),
    "",
    `  ${ANSI.dim}Use ↑/↓ to choose. Press enter to continue${ANSI.reset}`,
  ];

  stderr.write(lines.join("\n"));
  return lines.length;
};

const promptInstall = async (
  packageName: string,
  latestVersion: string,
  currentVersion: string,
): Promise<UpdatePromptChoice> => {
  if (!stdin.isTTY || !stderr.isTTY || typeof stdin.setRawMode !== "function") {
    stderr.write(
      `New version ${latestVersion} is available (current ${currentVersion}). Run: npm install -g @getcodesentinel/codesentinel@latest\n`,
    );
    return "skip";
  }

  return await new Promise<UpdatePromptChoice>((resolve) => {
    emitKeypressEvents(stdin);

    let selectedIndex = 0;
    const previousRawMode = stdin.isRaw;

    const clearPromptArea = (): void => {
      cursorTo(stderr, 0, 0);
      clearScreenDown(stderr);
    };

    const redraw = (): void => {
      clearPromptArea();
      renderUpdatePrompt(packageName, latestVersion, currentVersion, selectedIndex);
    };

    const cleanup = (choice: UpdatePromptChoice): void => {
      stdin.off("keypress", onKeypress);
      stdin.pause();
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(previousRawMode);
      }
      clearPromptArea();
      if (choice === "install") {
        stderr.write(`${ANSI.yellow}${renderUpdateInProgressMessage(packageName)}${ANSI.reset}`);
      } else {
        stderr.write("\n");
      }
      resolve(choice);
    };

    const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl === true && key.name === "c") {
        cleanup("interrupt");
        return;
      }

      if (key.name === "up") {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : 1;
        redraw();
        return;
      }
      if (key.name === "down") {
        selectedIndex = selectedIndex < 1 ? selectedIndex + 1 : 0;
        redraw();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup(selectedIndex === 0 ? "install" : "skip");
      }
    };

    stdin.on("keypress", onKeypress);
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.resume();
    redraw();
  });
};

const installLatestVersion = async (packageName: string): Promise<boolean> => {
  const result = await runCommand("npm", ["install", "-g", `${packageName}@latest`], "inherit");
  return result.code === 0;
};

export const runManualCliUpdate = async (input: {
  packageName: string;
  currentVersion: string;
}): Promise<number> => {
  const latestVersion = await fetchLatestVersion(input.packageName);
  if (latestVersion === null) {
    stderr.write(renderUpdateCheckFailedMessage());
    return 1;
  }

  const comparison = compareVersions(latestVersion, input.currentVersion);
  if (comparison === null) {
    stderr.write(renderUpdateCheckFailedMessage());
    return 1;
  }

  if (comparison <= 0) {
    stderr.write(renderAlreadyUpToDateMessage(input.currentVersion));
    return 0;
  }

  const choice = await promptInstall(input.packageName, latestVersion, input.currentVersion);
  if (choice === "interrupt") {
    return 130;
  }
  if (choice !== "install") {
    return 0;
  }

  const installed = await installLatestVersion(input.packageName);
  if (installed) {
    stderr.write(renderUpdateSuccessMessage());
    return 0;
  }

  stderr.write(
    "CodeSentinel update failed. You can retry with: npm install -g @getcodesentinel/codesentinel@latest\n",
  );
  return 1;
};

export const checkForCliUpdates = async (input: {
  packageName: string;
  currentVersion: string;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}): Promise<void> => {
  try {
    const nowMs = Date.now();
    const cache = await readCache();
    const shouldCheck = shouldRunUpdateCheck({
      argv: input.argv,
      env: input.env,
      isInteractive: Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY),
      nowMs,
      lastCheckedAt: cache?.lastCheckedAt ?? null,
    });
    if (!shouldCheck) {
      return;
    }

    await writeCache({ lastCheckedAt: new Date(nowMs).toISOString() });

    const latestVersion = await fetchLatestVersion(input.packageName);
    if (latestVersion === null) {
      return;
    }

    const comparison = compareVersions(latestVersion, input.currentVersion);
    if (comparison === null || comparison <= 0) {
      return;
    }

    const choice = await promptInstall(input.packageName, latestVersion, input.currentVersion);
    if (choice === "interrupt") {
      process.exit(130);
    }
    if (choice !== "install") {
      return;
    }

    const installed = await installLatestVersion(input.packageName);
    if (installed) {
      stderr.write(renderUpdateSuccessMessage());
      process.exit(0);
    } else {
      stderr.write(
        "CodeSentinel update failed. You can retry with: npm install -g @getcodesentinel/codesentinel@latest\n",
      );
    }
  } catch {
    // Update checks are best-effort and must never block the CLI command.
  }
};
