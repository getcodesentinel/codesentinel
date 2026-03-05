import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalyzeSummary } from "@codesentinel/core";
import { collectHealthSignals } from "./collect-health-signals.js";

const tempDirs: string[] = [];

const logger = {
  warn: (): void => {
    // No-op logger for tests.
  },
};

const makeStructural = (files: readonly string[]): AnalyzeSummary["structural"] => ({
  targetPath: "/repo",
  nodes: files.map((file) => ({
    id: file,
    absolutePath: `/repo/${file}`,
    relativePath: file,
  })),
  edges: [],
  cycles: [],
  files: files.map((file) => ({
    id: file,
    relativePath: file,
    directDependencies: [],
    fanIn: 0,
    fanOut: 0,
    depth: 0,
  })),
  metrics: {
    nodeCount: files.length,
    edgeCount: 0,
    cycleCount: 0,
    graphDepth: 0,
    maxFanIn: 0,
    maxFanOut: 0,
  },
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("collectHealthSignals duplication", () => {
  it("detects duplicated blocks across files with token winnowing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codesentinel-health-"));
    tempDirs.push(directory);

    const duplicateBlock = `
      export function sameShape(input: number): number {
        const values = [1, 2, 3, 4, 5];
        const enriched = values.map((value) => value + input).filter((value) => value % 2 === 0);
        const total = enriched.reduce((sum, value) => sum + value, 0);
        if (total > 10) {
          return total - input;
        }
        return total + input;
      }
    `;

    await writeFile(join(directory, "a.ts"), duplicateBlock, "utf8");
    await writeFile(join(directory, "b.ts"), duplicateBlock, "utf8");

    const signals = await collectHealthSignals(directory, makeStructural(["a.ts", "b.ts"]), logger);

    expect(signals.duplication).toBeDefined();
    expect(signals.duplication?.mode).toBe("exact-token");
    expect(signals.duplication?.duplicatedBlockCount).toBeGreaterThan(0);
    expect(signals.duplication?.filesWithDuplication).toBe(2);
    expect(signals.duplication?.duplicatedLineRatio).toBeGreaterThan(0);
  });

  it("stays bounded with many files and returns a normalized ratio", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codesentinel-health-"));
    tempDirs.push(directory);

    const files: string[] = [];
    for (let index = 0; index < 80; index += 1) {
      const file = `file-${index}.ts`;
      files.push(file);
      await writeFile(
        join(directory, file),
        `export const v${index} = ${index};\nexport function f${index}(x: number) { return x + ${index}; }\n`,
        "utf8",
      );
    }

    const signals = await collectHealthSignals(directory, makeStructural(files), logger);

    if (signals.duplication !== undefined) {
      expect(signals.duplication.duplicatedLineRatio).toBeGreaterThanOrEqual(0);
      expect(signals.duplication.duplicatedLineRatio).toBeLessThanOrEqual(1);
    }
  });

  it("ignores test files when computing duplication", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codesentinel-health-"));
    tempDirs.push(directory);

    const duplicateBlock = `
      export function sameShape(input: number): number {
        const values = [1, 2, 3, 4, 5];
        const enriched = values.map((value) => value + input).filter((value) => value % 2 === 0);
        const total = enriched.reduce((sum, value) => sum + value, 0);
        if (total > 10) {
          return total - input;
        }
        return total + input;
      }
    `;

    await writeFile(join(directory, "a.test.ts"), duplicateBlock, "utf8");
    await writeFile(join(directory, "b.spec.ts"), duplicateBlock, "utf8");

    const signals = await collectHealthSignals(
      directory,
      makeStructural(["a.test.ts", "b.spec.ts"]),
      logger,
    );

    expect(signals.duplication).toBeUndefined();
  });

  it("does not overcount overlap and saturate ratio for a partial duplicate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codesentinel-health-"));
    tempDirs.push(directory);

    const duplicateBlock = `
      const values = [1, 2, 3, 4, 5];
      const enriched = values.map((value) => value + input).filter((value) => value % 2 === 0);
      const total = enriched.reduce((sum, value) => sum + value, 0);
      if (total > 10) {
        return total - input;
      }
      return total + input;
    `;

    const fileA = `
      export function alpha(input: number): number {
        ${duplicateBlock}
      }
      export function uniqueA(input: number): number {
        let acc = 0;
        for (let index = 0; index < 25; index += 1) {
          acc += input * index;
        }
        return acc;
      }
    `;

    const fileB = `
      export function beta(input: number): number {
        ${duplicateBlock}
      }
      export function uniqueB(input: number): number {
        const values = Array.from({ length: 30 }, (_, index) => index + input);
        return values.filter((value) => value % 3 === 0).reduce((sum, value) => sum + value, 0);
      }
    `;

    await writeFile(join(directory, "a.ts"), fileA, "utf8");
    await writeFile(join(directory, "b.ts"), fileB, "utf8");

    const signals = await collectHealthSignals(directory, makeStructural(["a.ts", "b.ts"]), logger);

    expect(signals.duplication).toBeDefined();
    expect(signals.duplication?.duplicatedLineRatio).toBeGreaterThan(0);
    expect(signals.duplication?.duplicatedLineRatio).toBeLessThan(1);
  });
});

describe("collectHealthSignals complexity", () => {
  it("computes cyclomatic complexity at function granularity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codesentinel-health-"));
    tempDirs.push(directory);

    await writeFile(
      join(directory, "complex.ts"),
      `
        export function dense(value: number): number {
          if (value > 10) return value;
          if (value > 9) return value;
          if (value > 8) return value;
          if (value > 7) return value;
          if (value > 6) return value;
          if (value > 5) return value;
          if (value > 4) return value;
          if (value > 3) return value;
          if (value > 2) return value;
          if (value > 1) return value;
          return value;
        }

        export function simple(value: number): number {
          return value + 1;
        }
      `,
      "utf8",
    );

    const signals = await collectHealthSignals(directory, makeStructural(["complex.ts"]), logger);

    expect(signals.complexity).toBeDefined();
    expect(signals.complexity?.averageCyclomatic).toBeLessThan(
      signals.complexity?.maxCyclomatic ?? 0,
    );
    expect(signals.complexity?.maxCyclomatic).toBeGreaterThanOrEqual(11);
    expect(signals.complexity?.highComplexityFileCount).toBe(0);
  });
});
