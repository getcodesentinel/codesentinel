import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AnalyzeSummary, HealthRuleCount, HealthSignalInputs } from "@codesentinel/core";
import { ESLint } from "eslint";
import * as ts from "typescript";
import { countTodoFixmeInComments } from "./todo-fixme-counter.js";

export type HealthSignalLogger = {
  warn: (message: string) => void;
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const normalizePath = (value: string): string => value.replaceAll("\\", "/");
const isTestPath = (path: string): boolean => {
  const normalized = normalizePath(path);
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("\\__tests__\\") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.")
  );
};

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
  logger: HealthSignalLogger,
): Promise<HealthSignalInputs["eslint"] | undefined> => {
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
    const ruleCounts = new Map<string, HealthRuleCount>();

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
      `health signals: eslint collection unavailable (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  }
};

const collectTypeScriptSignals = (
  targetPath: string,
  logger: HealthSignalLogger,
): HealthSignalInputs["typescript"] | undefined => {
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
      `health signals: typescript diagnostic collection unavailable (${error instanceof Error ? error.message : "unknown error"})`,
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

const computeCyclomaticComplexity = (node: ts.Node): number => {
  let complexity = 1;

  const visit = (current: ts.Node): void => {
    complexity += cyclomaticIncrement(current);

    if (
      current !== node &&
      (ts.isFunctionLike(current) ||
        ts.isArrowFunction(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isConstructorDeclaration(current))
    ) {
      return;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return complexity;
};

const collectFunctionComplexities = (content: string, fileName: string): readonly number[] => {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const complexities: number[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      complexities.push(computeCyclomaticComplexity(node));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (complexities.length === 0) {
    return [computeCyclomaticComplexity(sourceFile)];
  }

  return complexities;
};

const collectComplexitySignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
): Promise<HealthSignalInputs["complexity"] | undefined> => {
  const complexities: number[] = [];

  for (const file of structural.files) {
    const extension = file.relativePath.slice(file.relativePath.lastIndexOf("."));
    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }

    try {
      const content = await readFile(join(targetPath, file.relativePath), "utf8");
      complexities.push(...collectFunctionComplexities(content, file.relativePath));
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

const DUPLICATION_MIN_BLOCK_TOKENS = 40;
const DUPLICATION_KGRAM_TOKENS = 25;
const DUPLICATION_WINDOW_SIZE = 4;
const DUPLICATION_MAX_FILES = 5000;
const DUPLICATION_MAX_TOKENS_PER_FILE = 12000;
const DUPLICATION_MAX_FINGERPRINTS_PER_FILE = 1200;
const DUPLICATION_EXACT_MAX_WINDOWS = 250000;
const HASH_BASE = 16777619;

type DuplicationFingerprint = {
  hash: number;
  start: number;
};

type DuplicationFileData = {
  file: string;
  tokens: readonly string[];
};

type TokenRange = {
  start: number;
  end: number;
};

const hashString32 = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

const computeRollingBasePower = (kgramSize: number): number => {
  let value = 1;
  for (let index = 1; index < kgramSize; index += 1) {
    value = Math.imul(value, HASH_BASE) >>> 0;
  }
  return value;
};

const tokenizeForDuplication = (content: string, filePath: string): readonly string[] => {
  const languageVariant =
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, languageVariant, content);

  const tokens: string[] = [];
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token !== ts.SyntaxKind.WhitespaceTrivia &&
      token !== ts.SyntaxKind.NewLineTrivia &&
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      if (token === ts.SyntaxKind.Identifier || token === ts.SyntaxKind.PrivateIdentifier) {
        tokens.push("id");
      } else if (
        token === ts.SyntaxKind.StringLiteral ||
        token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        token === ts.SyntaxKind.TemplateHead ||
        token === ts.SyntaxKind.TemplateMiddle ||
        token === ts.SyntaxKind.TemplateTail ||
        token === ts.SyntaxKind.NumericLiteral ||
        token === ts.SyntaxKind.BigIntLiteral ||
        token === ts.SyntaxKind.RegularExpressionLiteral
      ) {
        tokens.push("lit");
      } else {
        const stable = ts.tokenToString(token) ?? ts.SyntaxKind[token] ?? `${token}`;
        tokens.push(stable);
      }
    }

    token = scanner.scan();
  }

  return tokens;
};

const buildKgramHashes = (
  tokenValues: readonly number[],
  kgramSize: number,
): readonly DuplicationFingerprint[] => {
  if (tokenValues.length < kgramSize) {
    return [];
  }

  const fingerprints: DuplicationFingerprint[] = [];
  const removePower = computeRollingBasePower(kgramSize);

  let hash = 0;
  for (let index = 0; index < kgramSize; index += 1) {
    hash = (Math.imul(hash, HASH_BASE) + (tokenValues[index] ?? 0)) >>> 0;
  }
  fingerprints.push({ hash, start: 0 });

  for (let start = 1; start <= tokenValues.length - kgramSize; start += 1) {
    const removed = tokenValues[start - 1] ?? 0;
    const added = tokenValues[start + kgramSize - 1] ?? 0;
    const removedContribution = Math.imul(removed, removePower) >>> 0;
    const shifted = Math.imul((hash - removedContribution) >>> 0, HASH_BASE) >>> 0;
    hash = (shifted + added) >>> 0;
    fingerprints.push({ hash, start });
  }

  return fingerprints;
};

const winnowFingerprints = (
  kgrams: readonly DuplicationFingerprint[],
  windowSize: number,
): readonly DuplicationFingerprint[] => {
  if (kgrams.length === 0) {
    return [];
  }

  if (kgrams.length <= windowSize) {
    const minimum = [...kgrams].sort(
      (left, right) => left.hash - right.hash || right.start - left.start,
    )[0];
    return minimum === undefined ? [] : [minimum];
  }

  const selected = new Map<string, DuplicationFingerprint>();
  for (let start = 0; start <= kgrams.length - windowSize; start += 1) {
    let best = kgrams[start];
    if (best === undefined) {
      continue;
    }

    for (let offset = 1; offset < windowSize; offset += 1) {
      const candidate = kgrams[start + offset];
      if (candidate === undefined) {
        continue;
      }

      if (
        candidate.hash < best.hash ||
        (candidate.hash === best.hash && candidate.start > best.start)
      ) {
        best = candidate;
      }
    }

    selected.set(`${best.hash}:${best.start}`, best);
  }

  return [...selected.values()].sort((left, right) => left.start - right.start);
};

const capFingerprints = (
  fingerprints: readonly DuplicationFingerprint[],
  maxFingerprints: number,
): readonly DuplicationFingerprint[] => {
  if (fingerprints.length <= maxFingerprints) {
    return fingerprints;
  }

  const step = fingerprints.length / maxFingerprints;
  const capped: DuplicationFingerprint[] = [];
  for (let index = 0; index < maxFingerprints; index += 1) {
    const selected = fingerprints[Math.floor(index * step)];
    if (selected !== undefined) {
      capped.push(selected);
    }
  }

  return capped;
};

const tokenBlockSignature = (
  tokens: readonly string[],
  start: number,
  blockLength: number,
): string | undefined => {
  if (start < 0 || start + blockLength > tokens.length) {
    return undefined;
  }

  return tokens.slice(start, start + blockLength).join(" ");
};

const mergeTokenRanges = (ranges: readonly TokenRange[]): readonly TokenRange[] => {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: TokenRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
};

const aggregateDuplicationFromSignatures = (
  signatures: ReadonlyMap<string, ReadonlyArray<{ file: string; start: number }>>,
  fileByPath: ReadonlyMap<string, DuplicationFileData>,
): {
  duplicatedBlockCount: number;
  duplicatedTokenCount: number;
  filesWithDuplication: number;
} => {
  let duplicatedBlockCount = 0;
  const duplicatedRanges = new Map<string, TokenRange[]>();

  for (const entries of signatures.values()) {
    if (entries.length <= 1) {
      continue;
    }

    const uniqueEntries = new Map<string, { file: string; start: number }>();
    for (const entry of entries) {
      uniqueEntries.set(`${entry.file}:${entry.start}`, entry);
    }

    if (uniqueEntries.size <= 1) {
      continue;
    }

    duplicatedBlockCount += uniqueEntries.size - 1;
    for (const entry of uniqueEntries.values()) {
      const source = fileByPath.get(entry.file);
      if (source === undefined) {
        continue;
      }

      const signature = tokenBlockSignature(
        source.tokens,
        entry.start,
        DUPLICATION_MIN_BLOCK_TOKENS,
      );
      if (signature === undefined) {
        continue;
      }

      const ranges = duplicatedRanges.get(entry.file) ?? [];
      ranges.push({
        start: entry.start,
        end: Math.min(source.tokens.length, entry.start + DUPLICATION_MIN_BLOCK_TOKENS),
      });
      duplicatedRanges.set(entry.file, ranges);
    }
  }

  let duplicatedTokenCount = 0;
  for (const ranges of duplicatedRanges.values()) {
    const mergedRanges = mergeTokenRanges(ranges);
    duplicatedTokenCount += mergedRanges.reduce((sum, range) => sum + (range.end - range.start), 0);
  }

  return {
    duplicatedBlockCount,
    duplicatedTokenCount,
    filesWithDuplication: duplicatedRanges.size,
  };
};

const collectExactTokenDuplication = (
  analyzedFiles: readonly DuplicationFileData[],
): {
  duplicatedBlockCount: number;
  duplicatedTokenCount: number;
  filesWithDuplication: number;
} => {
  const signatures = new Map<string, Array<{ file: string; start: number }>>();
  for (const file of analyzedFiles) {
    const tokenValues = file.tokens.map((token) => hashString32(token));
    const windows = buildKgramHashes(tokenValues, DUPLICATION_MIN_BLOCK_TOKENS);
    for (const window of windows) {
      const signature = tokenBlockSignature(
        file.tokens,
        window.start,
        DUPLICATION_MIN_BLOCK_TOKENS,
      );
      if (signature === undefined) {
        continue;
      }

      const entries = signatures.get(signature) ?? [];
      entries.push({ file: file.file, start: window.start });
      signatures.set(signature, entries);
    }
  }

  const fileByPath = new Map(analyzedFiles.map((file) => [file.file, file]));
  return aggregateDuplicationFromSignatures(signatures, fileByPath);
};

const collectWinnowingDuplication = (
  analyzedFiles: readonly DuplicationFileData[],
): {
  duplicatedBlockCount: number;
  duplicatedTokenCount: number;
  filesWithDuplication: number;
} => {
  const signatures = new Map<string, Array<{ file: string; start: number }>>();
  for (const file of analyzedFiles) {
    const tokenValues = file.tokens.map((token) => hashString32(token));
    const kgrams = buildKgramHashes(tokenValues, DUPLICATION_KGRAM_TOKENS);
    const fingerprints = capFingerprints(
      winnowFingerprints(kgrams, DUPLICATION_WINDOW_SIZE),
      DUPLICATION_MAX_FINGERPRINTS_PER_FILE,
    );

    for (const fingerprint of fingerprints) {
      const signature = tokenBlockSignature(
        file.tokens,
        fingerprint.start,
        DUPLICATION_MIN_BLOCK_TOKENS,
      );
      if (signature === undefined) {
        continue;
      }

      const entries = signatures.get(signature) ?? [];
      entries.push({ file: file.file, start: fingerprint.start });
      signatures.set(signature, entries);
    }
  }

  const fileByPath = new Map(analyzedFiles.map((file) => [file.file, file]));
  return aggregateDuplicationFromSignatures(signatures, fileByPath);
};

const collectDuplicationSignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
): Promise<HealthSignalInputs["duplication"] | undefined> => {
  const files = [...structural.files]
    .map((file) => file.relativePath)
    .sort((left, right) => left.localeCompare(right))
    .filter((filePath) => SOURCE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf("."))))
    .filter((filePath) => isTestPath(filePath) === false)
    .slice(0, DUPLICATION_MAX_FILES);

  const analyzedFiles: DuplicationFileData[] = [];
  let significantTokenCount = 0;
  let exactWindowCount = 0;

  for (const relativePath of files) {
    try {
      const content = await readFile(join(targetPath, relativePath), "utf8");
      const tokens = tokenizeForDuplication(content, relativePath).slice(
        0,
        DUPLICATION_MAX_TOKENS_PER_FILE,
      );
      significantTokenCount += tokens.length;

      if (tokens.length < DUPLICATION_MIN_BLOCK_TOKENS) {
        continue;
      }

      exactWindowCount += tokens.length - DUPLICATION_MIN_BLOCK_TOKENS + 1;

      analyzedFiles.push({
        file: relativePath,
        tokens,
      });
    } catch {
      // Best-effort only.
    }
  }

  if (analyzedFiles.length === 0) {
    return undefined;
  }

  const mode = exactWindowCount <= DUPLICATION_EXACT_MAX_WINDOWS ? "exact-token" : "winnowing";
  const aggregated =
    mode === "exact-token"
      ? collectExactTokenDuplication(analyzedFiles)
      : collectWinnowingDuplication(analyzedFiles);

  const duplicatedLineRatio =
    significantTokenCount === 0
      ? 0
      : Math.min(1, aggregated.duplicatedTokenCount / significantTokenCount);

  return {
    mode,
    duplicatedLineRatio,
    duplicatedBlockCount: aggregated.duplicatedBlockCount,
    filesWithDuplication: aggregated.filesWithDuplication,
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
  logger: HealthSignalLogger,
): Promise<HealthSignalInputs["coverage"] | undefined> => {
  const configuredPath = process.env["CODESENTINEL_HEALTH_COVERAGE_SUMMARY"];
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
      `health signals: coverage summary parse failed at ${summaryPath} (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  }
};

export const collectHealthSignals = async (
  targetPath: string,
  structural: AnalyzeSummary["structural"],
  logger: HealthSignalLogger,
): Promise<HealthSignalInputs> => {
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
