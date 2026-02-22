import { extname, isAbsolute, relative, resolve } from "node:path";
import * as ts from "typescript";
import type { EdgeRecord, NodeRecord } from "../domain/graph-model.ts";

type ParsedProject = {
  nodes: readonly NodeRecord[];
  edges: readonly EdgeRecord[];
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const normalizePath = (pathValue: string): string => pathValue.replaceAll("\\", "/");

const isProjectSourceFile = (filePath: string, projectRoot: string): boolean => {
  const extension = extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }

  const relativePath = relative(projectRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }

  return !relativePath.includes("node_modules");
};

const findProjectFiles = (projectRoot: string): readonly string[] => {
  const files = ts.sys.readDirectory(projectRoot, [...SOURCE_EXTENSIONS], undefined, undefined);
  return files.map((filePath) => resolve(filePath));
};

const parseTsConfig = (projectRoot: string): { fileNames: readonly string[]; options: ts.CompilerOptions } => {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) {
    return {
      fileNames: findProjectFiles(projectRoot),
      options: {
        allowJs: true,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    };
  }

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

  const fileNames = parsedCommandLine.fileNames.map((filePath) => resolve(filePath));
  if (fileNames.length === 0) {
    return {
      fileNames: findProjectFiles(projectRoot),
      options: parsedCommandLine.options,
    };
  }

  return {
    fileNames,
    options: parsedCommandLine.options,
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

      if (ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length > 0) {
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

export const parseTypescriptProject = (projectPath: string): ParsedProject => {
  const projectRoot = isAbsolute(projectPath) ? projectPath : resolve(projectPath);
  const { fileNames, options } = parseTsConfig(projectRoot);

  const sourceFilePaths = fileNames
    .filter((filePath) => isProjectSourceFile(filePath, projectRoot))
    .map((filePath) => normalizePath(resolve(filePath)));

  const uniqueSourceFilePaths = [...new Set(sourceFilePaths)].sort((a, b) => a.localeCompare(b));
  const sourceFilePathSet = new Set(uniqueSourceFilePaths);

  const program = ts.createProgram({
    rootNames: uniqueSourceFilePaths,
    options,
  });

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
  const edges: EdgeRecord[] = [];

  for (const sourcePath of uniqueSourceFilePaths) {
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
        const resolved = ts.resolveModuleName(specifier, sourcePath, options, ts.sys).resolvedModule;
        if (resolved !== undefined) {
          resolvedPath = normalizePath(resolve(resolved.resolvedFileName));
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
  }

  return {
    nodes: [...nodeByAbsolutePath.values()],
    edges,
  };
};
