import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stderr, stdin } from "node:process";

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CACHE_PATH = join(homedir(), ".cache", "codesentinel", "update-check.json");

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
  const match = value
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (match === null) {
    return null;
  }

  const prereleaseRaw = match[4];
  const prerelease =
    prereleaseRaw === undefined || prereleaseRaw.length === 0
      ? []
      : prereleaseRaw.split(".").map(parsePrereleaseIdentifier);

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
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
      const latest = parsed[parsed.length - 1];
      if (typeof latest === "string" && latest.trim().length > 0) {
        return latest.trim();
      }
    }
  } catch {
    return trimmed;
  }

  return null;
};

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

const promptInstall = async (latestVersion: string, currentVersion: string): Promise<boolean> => {
  const interfaceHandle = createInterface({ input: stdin, output: stderr });
  try {
    const answer = await interfaceHandle.question(
      `New version ${latestVersion} is available (current ${currentVersion}). Install now? [Y/n] `,
    );
    const normalized = answer.trim().toLowerCase();
    return normalized.length === 0 || normalized === "y" || normalized === "yes";
  } finally {
    interfaceHandle.close();
  }
};

const installLatestVersion = async (packageName: string): Promise<boolean> => {
  const result = await runCommand("npm", ["install", "-g", `${packageName}@latest`], "inherit");
  return result.code === 0;
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

    const accepted = await promptInstall(latestVersion, input.currentVersion);
    if (!accepted) {
      return;
    }

    const installed = await installLatestVersion(input.packageName);
    if (installed) {
      stderr.write("CodeSentinel updated to latest version.\n");
    } else {
      stderr.write(
        "CodeSentinel update failed. You can retry with: npm install -g @getcodesentinel/codesentinel@latest\n",
      );
    }
  } catch {
    // Update checks are best-effort and must never block the CLI command.
  }
};
