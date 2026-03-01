import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workdir = mkdtempSync(join(tmpdir(), "codesentinel-package-verify-"));
const unpackDir = join(workdir, "unpack");
const npmPrefix = join(workdir, "npm-global");
const npmCache = join(workdir, "npm-cache");

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

const hasWorkspaceProtocol = (value) => {
  if (typeof value === "string") {
    return value.startsWith("workspace:");
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasWorkspaceProtocol(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).some((entry) => hasWorkspaceProtocol(entry));
  }

  return false;
};

const assertNoWorkspaceProtocol = (pkg) => {
  if (hasWorkspaceProtocol(pkg.dependencies ?? {})) {
    throw new Error("Published CLI package still contains workspace protocol in dependencies");
  }

  if (hasWorkspaceProtocol(pkg.devDependencies ?? {})) {
    throw new Error("Published CLI package still contains workspace protocol in devDependencies");
  }
};

const collectTarballs = (root, maxDepth) => {
  const results = [];

  const visit = (currentPath, depth) => {
    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      if (entry.isFile()) {
        if (entry.name.endsWith(".tgz")) {
          results.push(entryPath);
        }
        continue;
      }

      if (entry.isDirectory() && depth < maxDepth) {
        visit(entryPath, depth + 1);
      }
    }
  };

  if (!existsSync(root)) {
    return results;
  }

  try {
    const isDir = statSync(root).isDirectory();
    if (!isDir) {
      return results;
    }
  } catch {
    return results;
  }

  visit(root, 0);
  return results;
};

const resolveTarballPath = (inputPath) => {
  if (typeof inputPath === "string" && inputPath.trim().length > 0) {
    const candidate = resolve(inputPath.trim());
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const roots = [process.cwd(), "/tmp", "/private/tmp"];
  for (const root of roots) {
    const matches = collectTarballs(root, 2).filter((entry) => entry.includes("codesentinel"));
    if (matches.length === 0) {
      continue;
    }

    matches.sort((a, b) => a.localeCompare(b));
    return matches[matches.length - 1];
  }

  const provided = inputPath === undefined ? "(none)" : inputPath;
  throw new Error(`Tarball not found. Provided value: ${provided}`);
};

const absoluteTarballPath = resolveTarballPath(process.argv[2]);

try {
  mkdirSync(unpackDir, { recursive: true });
  mkdirSync(npmPrefix, { recursive: true });
  mkdirSync(npmCache, { recursive: true });

  run("tar", ["-xzf", absoluteTarballPath, "-C", unpackDir]);

  const packedPackagePath = join(unpackDir, "package", "package.json");
  const packedPackage = JSON.parse(readFileSync(packedPackagePath, "utf8"));
  assertNoWorkspaceProtocol(packedPackage);

  run("npm", ["install", "--prefix", npmPrefix, absoluteTarballPath], {
    cwd: workdir,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
  });

  const fixtureRepo = join(workdir, "fixture");
  mkdirSync(join(fixtureRepo, "src"), { recursive: true });
  writeFileSync(
    join(fixtureRepo, "package.json"),
    JSON.stringify(
      {
        name: "codesentinel-fixture",
        private: true,
        version: "0.0.0",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(fixtureRepo, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          allowImportingTsExtensions: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(fixtureRepo, "src/a.ts"), 'import "./b.ts";\nexport const a = 1;\n', "utf8");
  writeFileSync(join(fixtureRepo, "src/b.ts"), "export const b = 1;\n", "utf8");

  const candidateBinaries = [
    join(npmPrefix, "bin", "codesentinel"),
    join(npmPrefix, "node_modules", ".bin", "codesentinel"),
  ];
  const codesentinelBinary = candidateBinaries.find((candidate) => existsSync(candidate));
  if (codesentinelBinary === undefined) {
    throw new Error(
      `codesentinel binary not found after install. Checked: ${candidateBinaries.join(", ")}`,
    );
  }

  run(codesentinelBinary, ["--help"], { cwd: workdir });
  const output = run(
    codesentinelBinary,
    ["analyze", fixtureRepo, "--output", "summary", "--log-level", "silent"],
    { cwd: workdir },
  );

  const parsed = JSON.parse(output);
  if (typeof parsed?.risk?.repositoryScore !== "number") {
    throw new Error("Smoke test output missing risk.repositoryScore");
  }
  if ((parsed?.structural?.nodeCount ?? 0) < 2) {
    throw new Error("Smoke test output structural.nodeCount is lower than expected");
  }

  console.log("CLI package verification passed.");
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
