import type { DirectDependencySpec, LockfileExtraction } from "../domain/types.js";

export const parseBunLock = (_raw: string, _directSpecs: readonly DirectDependencySpec[]): LockfileExtraction => {
  throw new Error("unsupported_lockfile_format");
};
