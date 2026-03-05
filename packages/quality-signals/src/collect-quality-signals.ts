import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AnalyzeSummary, QualityRuleCount, QualitySignalInputs } from "@codesentinel/core";
import { ESLint } from "eslint";
import * as ts from "typescript";
import { countTodoFixmeInComments } from "./todo-fixme-counter.js";

export type QualitySignalLogger = {
  warn: (message: string) => void;
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const normalizePath = (value: string): string => value.replaceAll("\\", "/");

const collectTodoFixmeCommentCount = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
): Promise<number> => {
  const filePaths = [...structural.files]
    .map((file) => file.relativePath)
    .sort((a, b) => a.localeCompare(b));

  let total = 0;
  for (const relativePath of filePaths) {
    try {
      const content = await readFile(join(targetPath, relativePath), "utf8");
      total += countTodoFixmeInComments(content);
    } catch {
      // Best-effort only: missing/unreadable files should not fail analyze.
    }
  }

  return total;
};

const collectEslintSignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
  logger: QualitySignalLogger,
): Promise<QualitySignalInputs["eslint"] | undefined> => {
  const absoluteFiles = structural.files.map((file) => join(targetPath, file.relativePath));
  if (absoluteFiles.length === 0) {
    return {
      errorCount: 0,
      warningCount: 0,
      filesWithIssues: 0,
      ruleCounts: [],
    };
  }

  try {
    const eslint = new ESLint({ cwd: targetPath, errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles(absoluteFiles);

    let errorCount = 0;
    let warningCount = 0;
    let filesWithIssues = 0;
    const ruleCounts = new Map<string, QualityRuleCount>();

    for (const result of results) {
      if (result.errorCount + result.warningCount > 0) {
        filesWithIssues += 1;
      }
      errorCount += result.errorCount;
      warningCount += result.warningCount;

      for (const message of result.messages) {
        if (message.ruleId === null) {
          continue;
        }

        const severity = message.severity >= 2 ? "error" : "warn";
        const current = ruleCounts.get(message.ruleId);
        if (current === undefined) {
          ruleCounts.set(message.ruleId, {
            ruleId: message.ruleId,
            severity,
            count: 1,
          });
        } else {
          ruleCounts.set(message.ruleId, {
            ruleId: current.ruleId,
            severity: current.severity === "error" || severity === "error" ? "error" : "warn",
            count: current.count + 1,
          });
        }
      }
    }

    return {
      errorCount,
      warningCount,
      filesWithIssues,
      ruleCounts: [...ruleCounts.values()].sort(
        (a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId),
      ),
    };
  } catch (error) {
    logger.warn(
      `quality signals: eslint collection unavailable (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  }
};

const collectTypeScriptSignals = (
  targetPath: string,
  logger: QualitySignalLogger,
): QualitySignalInputs["typescript"] | undefined => {
  const tsconfigPath = ts.findConfigFile(targetPath, ts.sys.fileExists, "tsconfig.json");
  if (tsconfigPath === undefined) {
    return undefined;
  }

  try {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      tsconfigPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {
          throw new Error(`failed to parse ${tsconfigPath}`);
        },
      },
    );

    if (parsed === undefined) {
      return undefined;
    }

    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

    const diagnostics = [
      ...program.getOptionsDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ];

    let errorCount = 0;
    let warningCount = 0;
    const fileSet = new Set<string>();

    for (const diagnostic of diagnostics) {
      if (diagnostic.category === ts.DiagnosticCategory.Error) {
        errorCount += 1;
      } else if (diagnostic.category === ts.DiagnosticCategory.Warning) {
        warningCount += 1;
      }

      if (diagnostic.file !== undefined) {
        const path = normalizePath(relative(targetPath, diagnostic.file.fileName));
        fileSet.add(path);
      }
    }

    return {
      errorCount,
      warningCount,
      filesWithDiagnostics: fileSet.size,
    };
  } catch (error) {
    logger.warn(
      `quality signals: typescript diagnostic collection unavailable (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  }
};

const cyclomaticIncrement = (node: ts.Node): number => {
  if (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node)
  ) {
    return 1;
  }

  if (ts.isCaseClause(node)) {
    return 1;
  }

  if (ts.isBinaryExpression(node)) {
    if (
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return 1;
    }
  }

  return 0;
};

const computeCyclomaticComplexity = (content: string, fileName: string): number => {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  let complexity = 1;

  const visit = (node: ts.Node): void => {
    complexity += cyclomaticIncrement(node);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return complexity;
};

const collectComplexitySignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
): Promise<QualitySignalInputs["complexity"] | undefined> => {
  const complexities: number[] = [];

  for (const file of structural.files) {
    const extension = file.relativePath.slice(file.relativePath.lastIndexOf("."));
    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }

    try {
      const content = await readFile(join(targetPath, file.relativePath), "utf8");
      complexities.push(computeCyclomaticComplexity(content, file.relativePath));
    } catch {
      // Best-effort only.
    }
  }

  if (complexities.length === 0) {
    return undefined;
  }

  const averageCyclomatic =
    complexities.reduce((sum, value) => sum + value, 0) / complexities.length;
  const maxCyclomatic = Math.max(...complexities);
  const highComplexityFileCount = complexities.filter((value) => value >= 15).length;

  return {
    averageCyclomatic,
    maxCyclomatic,
    highComplexityFileCount,
    analyzedFileCount: complexities.length,
  };
};

const normalizeDuplicationLine = (line: string): string => {
  const withoutLineComments = line.replace(/\/\/.*$/u, "");
  return withoutLineComments.trim().replace(/\s+/gu, " ");
};

const collectDuplicationSignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
): Promise<QualitySignalInputs["duplication"] | undefined> => {
  const windowSize = 6;
  const windows = new Map<string, Array<{ file: string; index: number }>>();
  let significantLineCount = 0;

  for (const file of structural.files) {
    try {
      const content = await readFile(join(targetPath, file.relativePath), "utf8");
      const normalizedLines = content
        .split(/\r?\n/u)
        .map((line) => normalizeDuplicationLine(line))
        .filter((line) => line.length > 0);

      significantLineCount += normalizedLines.length;

      for (let index = 0; index <= normalizedLines.length - windowSize; index += 1) {
        const signature = normalizedLines.slice(index, index + windowSize).join("\n");
        const entries = windows.get(signature) ?? [];
        entries.push({ file: file.relativePath, index });
        windows.set(signature, entries);
      }
    } catch {
      // Best-effort only.
    }
  }

  let duplicatedBlockCount = 0;
  const filesWithDuplication = new Set<string>();
  for (const entries of windows.values()) {
    if (entries.length <= 1) {
      continue;
    }

    duplicatedBlockCount += entries.length - 1;
    for (const entry of entries) {
      filesWithDuplication.add(entry.file);
    }
  }

  const duplicatedLineRatio =
    significantLineCount === 0
      ? 0
      : Math.min(1, (duplicatedBlockCount * windowSize) / significantLineCount);

  return {
    duplicatedLineRatio,
    duplicatedBlockCount,
    filesWithDuplication: filesWithDuplication.size,
  };
};

const toRatio = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return null;
  }
  return Math.min(1, Math.max(0, value / 100));
};

const collectCoverageSignals = async (
  targetPath: string,
  logger: QualitySignalLogger,
): Promise<QualitySignalInputs["coverage"] | undefined> => {
  const configuredPath = process.env["CODESENTINEL_QUALITY_COVERAGE_SUMMARY"];
  const summaryPath =
    configuredPath === undefined || configuredPath.trim().length === 0
      ? join(targetPath, "coverage", "coverage-summary.json")
      : resolve(targetPath, configuredPath);

  if (!existsSync(summaryPath)) {
    return undefined;
  }

  try {
    const raw = await readFile(summaryPath, "utf8");
    const parsed = JSON.parse(raw) as {
      total?: {
        lines?: { pct?: number };
        branches?: { pct?: number };
        functions?: { pct?: number };
        statements?: { pct?: number };
      };
    };

    return {
      lineCoverage: toRatio(parsed.total?.lines?.pct),
      branchCoverage: toRatio(parsed.total?.branches?.pct),
      functionCoverage: toRatio(parsed.total?.functions?.pct),
      statementCoverage: toRatio(parsed.total?.statements?.pct),
    };
  } catch (error) {
    logger.warn(
      `quality signals: coverage summary parse failed at ${summaryPath} (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  }
};

export const collectQualitySignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
  logger: QualitySignalLogger,
): Promise<QualitySignalInputs> => {
  const [todoFixmeCommentCount, eslint, complexity, duplication, coverage] = await Promise.all([
    collectTodoFixmeCommentCount(targetPath, structural),
    collectEslintSignals(targetPath, structural, logger),
    collectComplexitySignals(targetPath, structural),
    collectDuplicationSignals(targetPath, structural),
    collectCoverageSignals(targetPath, logger),
  ]);

  const typescript = collectTypeScriptSignals(targetPath, logger);

  return {
    todoFixmeCommentCount,
    ...(eslint === undefined ? {} : { eslint }),
    ...(typescript === undefined ? {} : { typescript }),
    ...(complexity === undefined ? {} : { complexity }),
    ...(duplication === undefined ? {} : { duplication }),
    ...(coverage === undefined ? {} : { coverage }),
  };
};
