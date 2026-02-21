import { resolve } from "node:path";

export type AnalyzeTarget = {
  absolutePath: string;
};

export const resolveTargetPath = (
  inputPath: string | undefined,
  cwd: string = process.cwd(),
): AnalyzeTarget => {
  const absolutePath = resolve(cwd, inputPath ?? ".");
  return { absolutePath };
};
