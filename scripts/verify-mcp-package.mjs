import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PACKAGE_NAME = "@getcodesentinel/codesentinel";
const PACKAGE_NAME = "@getcodesentinel/mcp";
const PLACEHOLDER_VERSION = "0.0.0-development";
const FIXTURE_VERSION = "1.0.0";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rewriteScript = join(repoRoot, "scripts/rewrite-mcp-publish-dependency.mjs");

const usage = () =>
  [
    "Usage: node scripts/verify-mcp-package.mjs [--package-dir <dir>] [--version <semver>] [--skip-rewrite]",
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

    if (argument === "--package-dir" || argument === "--version") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}\n${usage()}`);
      }

      options[argument === "--package-dir" ? "packageDir" : "version"] = value;
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

const containsWorkspaceProtocol = (value) => {
  if (typeof value === "string") {
    return value.includes("workspace:");
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsWorkspaceProtocol(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).some((entry) => containsWorkspaceProtocol(entry));
  }

  return false;
};

const assertNoWorkspaceProtocol = (pkg) => {
  for (const field of DEPENDENCY_FIELDS) {
    if (containsWorkspaceProtocol(pkg[field] ?? {})) {
      throw new Error(`Published MCP package still contains workspace protocol in ${field}`);
    }
  }
};

const {
  packageDir: packageDirArgument,
  version: versionArgument,
  skipRewrite = false,
} = parseArgs(process.argv.slice(2));

const packageDir =
  packageDirArgument === undefined ? join(repoRoot, "packages/mcp") : resolve(packageDirArgument);
const cliPackageJsonPath = join(repoRoot, "packages/cli/package.json");
const cliVersion = JSON.parse(readFileSync(cliPackageJsonPath, "utf8")).version;

const workdir = mkdtempSync(join(tmpdir(), "codesentinel-mcp-package-verify-"));
const copiedDir = join(workdir, "package");
const packDir = join(workdir, "pack");
const unpackDir = join(workdir, "unpack");

let effectiveVersion;

try {
  cpSync(packageDir, copiedDir, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return name !== "node_modules" && name !== ".git";
    },
  });

  if (!skipRewrite) {
    const rewriteArgs = [rewriteScript, "--package-dir", copiedDir];

    if (versionArgument !== undefined) {
      effectiveVersion = versionArgument;
      rewriteArgs.push("--version", versionArgument);
    } else if (cliVersion === PLACEHOLDER_VERSION) {
      effectiveVersion = FIXTURE_VERSION;
      rewriteArgs.push("--version", FIXTURE_VERSION);
      console.log(
        `packages/cli/package.json still has the ${PLACEHOLDER_VERSION} placeholder; using fixture version ${FIXTURE_VERSION}.`,
      );
    } else {
      effectiveVersion = cliVersion;
    }

    run(process.execPath, rewriteArgs);
  }

  mkdirSync(packDir, { recursive: true });
  run("npm", ["pack", "--pack-destination", packDir], { cwd: copiedDir });

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

  if (packedPackage.name !== PACKAGE_NAME) {
    throw new Error(`Packed package name is "${packedPackage.name}", expected "${PACKAGE_NAME}"`);
  }

  assertNoWorkspaceProtocol(packedPackage);

  const cliRange = packedPackage.dependencies?.[CLI_PACKAGE_NAME];
  if (typeof cliRange !== "string") {
    throw new Error(`Packed dependencies are missing ${CLI_PACKAGE_NAME}`);
  }
  if (!/^\^\d+\.\d+\.\d+/.test(cliRange)) {
    throw new Error(`Packed ${CLI_PACKAGE_NAME} range is not a caret semver range: "${cliRange}"`);
  }
  if (cliRange === `^${PLACEHOLDER_VERSION}`) {
    throw new Error(
      `Packed ${CLI_PACKAGE_NAME} range is the development placeholder: "${cliRange}"`,
    );
  }
  if (!skipRewrite && effectiveVersion !== undefined && cliRange !== `^${effectiveVersion}`) {
    throw new Error(
      `Packed ${CLI_PACKAGE_NAME} range is "${cliRange}", expected "^${effectiveVersion}"`,
    );
  }

  console.log("MCP package verification passed.");
  console.log("Packed dependencies:", JSON.stringify(packedPackage.dependencies ?? {}, null, 2));
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
