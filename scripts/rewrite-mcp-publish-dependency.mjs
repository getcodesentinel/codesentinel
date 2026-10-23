// Runs from @semantic-release/exec prepareCmd. Keep it after the CLI
// @semantic-release/npm entry (which writes the released version into
// packages/cli/package.json) and before the wrapper's npm entry, which packs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PACKAGE_NAME = "@getcodesentinel/codesentinel";
const PLACEHOLDER_VERSION = "0.0.0-development";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const usage = () =>
  "Usage: node scripts/rewrite-mcp-publish-dependency.mjs [--package-dir <dir>] [--version <semver>]";

const parseArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

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

const assertUsableVersion = (version) => {
  if (
    typeof version !== "string" ||
    version === PLACEHOLDER_VERSION ||
    !VERSION_PATTERN.test(version)
  ) {
    throw new Error(
      `Cannot rewrite ${CLI_PACKAGE_NAME} with unusable version "${version}". ` +
        "@semantic-release/npm has already bumped packages/cli/package.json by the time this runs; " +
        "use --version <semver> to simulate a release.",
    );
  }
};

const { packageDir: packageDirArgument, version: versionArgument } = parseArgs(
  process.argv.slice(2),
);

const packageDir =
  packageDirArgument === undefined ? join(repoRoot, "packages/mcp") : resolve(packageDirArgument);
const packageJsonPath = join(packageDir, "package.json");
const packageLabel = relative(repoRoot, packageJsonPath);

const version =
  versionArgument ??
  JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")).version;

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const rewrites = [];

for (const field of DEPENDENCY_FIELDS) {
  const entries = packageJson[field];

  if (entries === undefined) {
    continue;
  }

  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(`${field} in ${packageLabel} must be an object`);
  }

  for (const [name, value] of Object.entries(entries)) {
    if (typeof value !== "string" || !value.includes("workspace:")) {
      continue;
    }

    if (name !== CLI_PACKAGE_NAME) {
      throw new Error(
        `Refusing to rewrite ${field}["${name}"] in ${packageLabel}: only ` +
          `${CLI_PACKAGE_NAME} may use the workspace protocol in the published MCP wrapper.`,
      );
    }

    assertUsableVersion(version);
    entries[name] = `^${version}`;
    rewrites.push({ name, from: value, to: entries[name] });
  }
}

const hasCliDependency = DEPENDENCY_FIELDS.some((field) => {
  const entries = packageJson[field];
  return (
    entries !== null &&
    typeof entries === "object" &&
    !Array.isArray(entries) &&
    Object.hasOwn(entries, CLI_PACKAGE_NAME)
  );
});

if (!hasCliDependency) {
  throw new Error(`${CLI_PACKAGE_NAME} is missing from ${packageLabel}`);
}

if (rewrites.length === 0) {
  console.log(`${CLI_PACKAGE_NAME} is already resolved in ${packageLabel}.`);
  process.exit(0);
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const summary = rewrites.map(({ name, from, to }) => `Rewrote ${name} from ${from} to ${to}`);
console.log(`${summary.join("; ")} in ${packageLabel}.`);
