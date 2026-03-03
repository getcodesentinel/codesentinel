import type { LockfileExtraction } from "../domain/types.js";
import type { parsePackageJson } from "../parsing/package-json-loader.js";
import { parsePackageLock } from "../parsing/package-lock-parser.js";
import { parsePnpmLockfile } from "../parsing/pnpm-lock-parser.js";
import { parseYarnLock } from "../parsing/yarn-lock-parser.js";
import { parseBunLock } from "../parsing/bun-lock-parser.js";

type SupportedLockfileKind = "pnpm" | "npm" | "npm-shrinkwrap" | "yarn" | "bun";

export const parseLockfileExtraction = (
  lockfileKind: SupportedLockfileKind,
  lockfileRaw: string,
  directSpecs: ReturnType<typeof parsePackageJson>,
): LockfileExtraction => {
  switch (lockfileKind) {
    case "pnpm":
      return parsePnpmLockfile(lockfileRaw, directSpecs);
    case "npm":
    case "npm-shrinkwrap":
      return {
        ...parsePackageLock(lockfileRaw, directSpecs),
        kind: lockfileKind,
      };
    case "yarn":
      return parseYarnLock(lockfileRaw, directSpecs);
    case "bun":
      return parseBunLock(lockfileRaw, directSpecs);
    default:
      throw new Error("unsupported_lockfile_format");
  }
};
