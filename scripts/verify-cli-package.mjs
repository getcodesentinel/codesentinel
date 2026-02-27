import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarballPath = process.argv[2];
if (tarballPath === undefined || tarballPath.length === 0) {
  throw new Error("Usage: node scripts/verify-cli-package.mjs <path-to-cli-tgz>");
}

const absoluteTarballPath = resolve(tarballPath);
const workdir = mkdtempSync(join(tmpdir(), "codesentinel-package-verify-"));
const unpackDir = join(workdir, "unpack");

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

try {
  mkdirSync(unpackDir, { recursive: true });
  run("tar", ["-xzf", absoluteTarballPath, "-C", unpackDir]);

  const packedPackagePath = join(unpackDir, "package", "package.json");
  const packedPackage = JSON.parse(readFileSync(packedPackagePath, "utf8"));
  assertNoWorkspaceProtocol(packedPackage);

  run("npm", ["install", "-g", absoluteTarballPath], { cwd: workdir });

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

  const npmGlobalPrefix = run("npm", ["prefix", "-g"]).trim();
  const codesentinelBinary = join(npmGlobalPrefix, "bin", "codesentinel");

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
