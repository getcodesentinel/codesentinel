import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import type { WorkspacePackage } from "@codesentinel/core";
import type { EdgeRecord, NodeRecord } from "../domain/graph-model.js";

type ParsedProject = {
  nodes: readonly NodeRecord[];
  edges: readonly EdgeRecord[];
};

type PackageJsonEntryFields = {
  main?: string;
  module?: string;
  source?: string;
  types?: string;
  typings?: string;
};

export type ParseTypescriptProjectProgressEvent =
  | { stage: "config_resolved"; tsconfigCount: number; usedFallbackScan: boolean }
  | { stage: "files_discovered"; totalSourceFiles: number }
  | { stage: "program_created"; totalSourceFiles: number }
  | { stage: "file_processed"; processed: number; total: number; filePath: string }
  | { stage: "edges_resolved"; totalEdges: number };

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SCAN_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/out/**",
];
const SCAN_INCLUDES = ["**/*"];
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "out",
]);

const normalizePath = (pathValue: string): string => pathValue.replaceAll("\\", "/");

const readPackageJson = (packageJsonPath: string): PackageJsonEntryFields | null => {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonEntryFields;
  } catch {
    return null;
  }
};

const isProjectSourceFile = (filePath: string, projectRoot: string): boolean => {
  const extension = extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }

  const relativePath = relative(projectRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }

  const normalizedRelativePath = normalizePath(relativePath);
  const segments = normalizedRelativePath.split("/");
  return !segments.some((segment) => IGNORED_SEGMENTS.has(segment));
};

const discoverSourceFilesByScan = (projectRoot: string): readonly string[] => {
  const files = ts.sys.readDirectory(
    projectRoot,
    [...SOURCE_EXTENSIONS],
    SCAN_EXCLUDES,
    SCAN_INCLUDES,
  );
  return files.map((filePath) => resolve(filePath));
};

const parseTsConfigFile = (configPath: string): ts.ParsedCommandLine => {
  const parsedCommandLine = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {
        throw new Error(`Failed to parse TypeScript configuration at ${configPath}`);
      },
    },
  );

  if (parsedCommandLine === undefined) {
    throw new Error(`Failed to parse TypeScript configuration at ${configPath}`);
  }

  return parsedCommandLine;
};

type CollectedTsConfigData = {
  fileNames: readonly string[];
  rootOptions: ts.CompilerOptions;
  visitedConfigCount: number;
};

const collectFilesFromTsConfigGraph = (projectRoot: string): CollectedTsConfigData | null => {
  const rootConfigPath = ts.findConfigFile(
    projectRoot,
    (filePath) => ts.sys.fileExists(filePath),
    "tsconfig.json",
  );
  if (rootConfigPath === undefined) {
    return null;
  }

  const visitedConfigPaths = new Set<string>();
  const collectedFiles = new Set<string>();
  let rootOptions: ts.CompilerOptions | null = null;

  const visitConfig = (configPath: string): void => {
    const absoluteConfigPath = resolve(configPath);
    if (visitedConfigPaths.has(absoluteConfigPath)) {
      return;
    }

    visitedConfigPaths.add(absoluteConfigPath);
    const parsed = parseTsConfigFile(absoluteConfigPath);
    if (rootOptions === null) {
      rootOptions = parsed.options;
    }

    for (const filePath of parsed.fileNames) {
      collectedFiles.add(resolve(filePath));
    }

    for (const reference of parsed.projectReferences ?? []) {
      const referencePath = resolve(reference.path);
      const referenceConfigPath = ts.sys.directoryExists(referencePath)
        ? ts.findConfigFile(
            referencePath,
            (filePath) => ts.sys.fileExists(filePath),
            "tsconfig.json",
          )
        : referencePath;

      if (referenceConfigPath !== undefined && ts.sys.fileExists(referenceConfigPath)) {
        visitConfig(referenceConfigPath);
      }
    }
  };

  visitConfig(rootConfigPath);

  return {
    fileNames: [...collectedFiles],
    rootOptions: rootOptions ?? {
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    visitedConfigCount: visitedConfigPaths.size,
  };
};

const createCompilerOptions = (base: ts.CompilerOptions | undefined): ts.CompilerOptions => ({
  ...base,
  allowJs: true,
  moduleResolution: base?.moduleResolution ?? ts.ModuleResolutionKind.NodeNext,
});

const parseTsConfig = (
  projectRoot: string,
): {
  fileNames: readonly string[];
  options: ts.CompilerOptions;
  tsconfigCount: number;
  usedFallbackScan: boolean;
} => {
  const collected = collectFilesFromTsConfigGraph(projectRoot);
  if (collected === null) {
    return {
      fileNames: discoverSourceFilesByScan(projectRoot),
      options: createCompilerOptions(undefined),
      tsconfigCount: 0,
      usedFallbackScan: true,
    };
  }

  if (collected.fileNames.length === 0) {
    return {
      fileNames: discoverSourceFilesByScan(projectRoot),
      options: createCompilerOptions(collected.rootOptions),
      tsconfigCount: collected.visitedConfigCount,
      usedFallbackScan: true,
    };
  }

  return {
    fileNames: collected.fileNames,
    options: createCompilerOptions(collected.rootOptions),
    tsconfigCount: collected.visitedConfigCount,
    usedFallbackScan: false,
  };
};

const getSpecifierFromExpression = (expression: ts.Expression): string | undefined => {
  if (ts.isStringLiteral(expression)) {
    return expression.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }

  return undefined;
};

const hasRuntimeImport = (importDeclaration: ts.ImportDeclaration): boolean => {
  const importClause = importDeclaration.importClause;
  if (importClause === undefined) {
    return true;
  }

  if (importClause.isTypeOnly) {
    return false;
  }

  if (importClause.name !== undefined) {
    return true;
  }

  const namedBindings = importClause.namedBindings;
  if (namedBindings === undefined) {
    return false;
  }

  if (ts.isNamespaceImport(namedBindings)) {
    return true;
  }

  if (namedBindings.elements.length === 0) {
    return true;
  }

  return namedBindings.elements.some((element) => !element.isTypeOnly);
};

const extractModuleSpecifiers = (sourceFile: ts.SourceFile): readonly string[] => {
  const specifiers = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (hasRuntimeImport(node) && node.moduleSpecifier !== undefined) {
        const specifier = getSpecifierFromExpression(node.moduleSpecifier);
        if (specifier !== undefined) {
          specifiers.add(specifier);
        }
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier !== undefined) {
        const specifier = getSpecifierFromExpression(node.moduleSpecifier);
        if (specifier !== undefined) {
          specifiers.add(specifier);
        }
      }
      return;
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
        const firstArgument = node.arguments[0];
        if (firstArgument !== undefined) {
          const specifier = getSpecifierFromExpression(firstArgument);
          if (specifier !== undefined) {
            specifiers.add(specifier);
          }
        }
      }

      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length > 0
      ) {
        const firstArgument = node.arguments[0];
        if (firstArgument !== undefined) {
          const specifier = getSpecifierFromExpression(firstArgument);
          if (specifier !== undefined) {
            specifiers.add(specifier);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...specifiers];
};

const parseWorkspaceSpecifier = (
  specifier: string,
  workspaceNames: ReadonlySet<string>,
): { packageName: string; subpath: string | null } | null => {
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");

  if (!workspaceNames.has(packageName)) {
    return null;
  }

  const subpath = specifier.slice(packageName.length).replace(/^\//, "");
  return {
    packageName,
    subpath: subpath.length === 0 ? null : subpath,
  };
};

const expandFileCandidates = (pathWithoutExtension: string): readonly string[] => [
  pathWithoutExtension,
  ...[...SOURCE_EXTENSIONS].map((extension) => `${pathWithoutExtension}${extension}`),
  ...[...SOURCE_EXTENSIONS].map((extension) => join(pathWithoutExtension, `index${extension}`)),
];

const createWorkspaceResolver = (
  projectRoot: string,
  workspaces: readonly WorkspacePackage[],
  sourceFilePathSet: ReadonlySet<string>,
): ((specifier: string) => string | undefined) => {
  const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const workspaceNames = new Set(workspaceByName.keys());

  return (specifier) => {
    const parsed = parseWorkspaceSpecifier(specifier, workspaceNames);
    if (parsed === null) {
      return undefined;
    }

    const workspace = workspaceByName.get(parsed.packageName);
    if (workspace === undefined) {
      return undefined;
    }

    const workspaceRoot = resolve(projectRoot, workspace.path);
    const packageJson = readPackageJson(join(workspaceRoot, "package.json"));
    const candidates =
      parsed.subpath === null
        ? [
            packageJson?.source,
            packageJson?.types,
            packageJson?.typings,
            packageJson?.module,
            packageJson?.main,
            "src/index",
            "index",
          ].filter((candidate): candidate is string => candidate !== undefined)
        : [parsed.subpath, join("src", parsed.subpath)];

    for (const candidate of candidates) {
      for (const expanded of expandFileCandidates(resolve(workspaceRoot, candidate))) {
        const normalized = normalizePath(expanded);
        if (sourceFilePathSet.has(normalized) && existsSync(normalized)) {
          return normalized;
        }
      }
    }

    return undefined;
  };
};

export const parseTypescriptProject = (
  projectPath: string,
  onProgress?: (event: ParseTypescriptProjectProgressEvent) => void,
  workspaces: readonly WorkspacePackage[] = [],
): ParsedProject => {
  const projectRoot = isAbsolute(projectPath) ? projectPath : resolve(projectPath);
  const { fileNames, options, tsconfigCount, usedFallbackScan } = parseTsConfig(projectRoot);
  onProgress?.({ stage: "config_resolved", tsconfigCount, usedFallbackScan });

  const sourceFilePaths = fileNames
    .filter((filePath) => isProjectSourceFile(filePath, projectRoot))
    .map((filePath) => normalizePath(resolve(filePath)));

  const uniqueSourceFilePaths = [...new Set(sourceFilePaths)].sort((a, b) => a.localeCompare(b));
  const sourceFilePathSet = new Set(uniqueSourceFilePaths);
  onProgress?.({ stage: "files_discovered", totalSourceFiles: uniqueSourceFilePaths.length });

  const program = ts.createProgram({
    rootNames: uniqueSourceFilePaths,
    options,
  });
  onProgress?.({ stage: "program_created", totalSourceFiles: uniqueSourceFilePaths.length });

  const nodeByAbsolutePath = new Map<string, NodeRecord>();
  for (const sourcePath of uniqueSourceFilePaths) {
    const relativePath = normalizePath(relative(projectRoot, sourcePath));
    const nodeId = relativePath;
    nodeByAbsolutePath.set(sourcePath, {
      id: nodeId,
      absolutePath: sourcePath,
      relativePath,
    });
  }

  const resolverCache = new Map<string, string | undefined>();
  const resolveWorkspaceSpecifier = createWorkspaceResolver(
    projectRoot,
    workspaces,
    sourceFilePathSet,
  );
  const edges: EdgeRecord[] = [];

  for (const [index, sourcePath] of uniqueSourceFilePaths.entries()) {
    const sourceFile = program.getSourceFile(sourcePath);
    if (sourceFile === undefined) {
      continue;
    }

    const fromNode = nodeByAbsolutePath.get(sourcePath);
    if (fromNode === undefined) {
      continue;
    }

    const moduleSpecifiers = extractModuleSpecifiers(sourceFile);
    for (const specifier of moduleSpecifiers) {
      const cacheKey = `${sourcePath}\u0000${specifier}`;
      let resolvedPath = resolverCache.get(cacheKey);

      if (resolvedPath === undefined && !resolverCache.has(cacheKey)) {
        const resolved = ts.resolveModuleName(
          specifier,
          sourcePath,
          options,
          ts.sys,
        ).resolvedModule;
        if (resolved !== undefined) {
          resolvedPath = normalizePath(resolve(resolved.resolvedFileName));
        }
        if (resolvedPath === undefined || !sourceFilePathSet.has(resolvedPath)) {
          resolvedPath = resolveWorkspaceSpecifier(specifier);
        }
        resolverCache.set(cacheKey, resolvedPath);
      }

      if (resolvedPath === undefined || !sourceFilePathSet.has(resolvedPath)) {
        continue;
      }

      const toNode = nodeByAbsolutePath.get(resolvedPath);
      if (toNode === undefined) {
        continue;
      }

      edges.push({ from: fromNode.id, to: toNode.id });
    }

    const processed = index + 1;
    if (processed === 1 || processed === uniqueSourceFilePaths.length || processed % 50 === 0) {
      onProgress?.({
        stage: "file_processed",
        processed,
        total: uniqueSourceFilePaths.length,
        filePath: fromNode.id,
      });
    }
  }
  onProgress?.({ stage: "edges_resolved", totalEdges: edges.length });

  return {
    nodes: [...nodeByAbsolutePath.values()],
    edges,
  };
};
