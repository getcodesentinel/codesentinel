import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PACKAGE_NAME = "@getcodesentinel/codesentinel";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rewriteScript = join(repoRoot, "scripts/rewrite-cli-publish-dependencies.mjs");

const usage = () =>
  [
    "Usage: node scripts/verify-cli-package.mjs [--package-dir <dir>] [--skip-rewrite]",
    "",
    "--skip-rewrite verifies the manifest without rewriting it; use it to confirm the guard rejects the workspace:* state.",
  ].join("\n");

const parseArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--skip-rewrite") {
      options.skipRewrite = true;
      continue;
    }

    if (argument === "--package-dir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}\n${usage()}`);
      }

      options.packageDir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}\n${usage()}`);
  }

  return options;
};

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

const hasWorkspaceProtocol = (value) => {
  if (typeof value === "string") {
    return value.includes("workspace:");
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
  for (const field of DEPENDENCY_FIELDS) {
    if (hasWorkspaceProtocol(pkg[field] ?? {})) {
      throw new Error(`Published CLI package still contains workspace protocol in ${field}`);
    }
  }
};

const { packageDir: packageDirArgument, skipRewrite = false } = parseArgs(process.argv.slice(2));

const packageDir =
  packageDirArgument === undefined ? join(repoRoot, "packages/cli") : resolve(packageDirArgument);

const workdir = mkdtempSync(join(tmpdir(), "codesentinel-package-verify-"));
const copiedDir = join(workdir, "package");
const packDir = join(workdir, "pack");
const unpackDir = join(workdir, "unpack");

try {
  console.log("Packing packages/cli with npm pack, the packer the release publishes with.");

  cpSync(packageDir, copiedDir, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return name !== "node_modules" && name !== ".git";
    },
  });

  if (!existsSync(join(copiedDir, "dist", "index.js"))) {
    throw new Error(
      "packages/cli/dist/index.js is missing; run pnpm build before verifying the CLI package.",
    );
  }

  if (!skipRewrite) {
    run(process.execPath, [rewriteScript, "--package-dir", copiedDir]);
  }

  const manifestPath = join(copiedDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  mkdirSync(packDir, { recursive: true });
  // The real prepack rebuilds every workspace package and copies the root
  // README/LICENSE, which needs the monorepo root. Lifecycle scripts are
  // skipped here because the packed manifest is identical and the tarball's
  // dist is the one pnpm build produced.
  run("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], { cwd: copiedDir });

  const tarballs = readdirSync(packDir).filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one packed tarball, found ${tarballs.length}`);
  }

  const tarballPath = join(packDir, tarballs[0]);
  mkdirSync(unpackDir, { recursive: true });
  run("tar", ["-xzf", tarballPath, "-C", unpackDir]);

  const packedPackage = JSON.parse(
    readFileSync(join(unpackDir, "package", "package.json"), "utf8"),
  );

  if (packedPackage.name !== CLI_PACKAGE_NAME) {
    throw new Error(
      `Packed package name is "${packedPackage.name}", expected "${CLI_PACKAGE_NAME}"`,
    );
  }

  assertNoWorkspaceProtocol(packedPackage);

  if (
    JSON.stringify(packedPackage.dependencies ?? {}) !== JSON.stringify(manifest.dependencies ?? {})
  ) {
    throw new Error("Packed dependencies do not match the manifest that was packed");
  }

  run("npm", ["install", "-g", tarballPath], { cwd: workdir });

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
  if (typeof parsed?.risk?.riskScore !== "number") {
    throw new Error("Smoke test output missing risk.riskScore");
  }
  if ((parsed?.structural?.nodeCount ?? 0) < 2) {
    throw new Error("Smoke test output structural.nodeCount is lower than expected");
  }

  console.log("CLI package verification passed.");
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
