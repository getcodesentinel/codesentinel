// Runs from @semantic-release/exec prepareCmd, after the CLI's
// @semantic-release/npm prepare entry (which writes the released version into
// packages/cli/package.json) and before that entry publishes the tarball.
//
// The CLI devDependencies point at private, unpublished @codesentinel/*
// workspace packages. Inventing a registry range for them would publish a
// fabricated coordinate, so they are dropped instead. Runtime dependencies
// must never use the workspace protocol: the CLI bundles the workspace
// packages into dist.
//
// This change never reaches git history. semantic-release has no
// @semantic-release/git plugin or assets here, so it only tags the release
// commit; the version bump and these rewrites live only in the runner's
// working tree. workspace:* therefore stays in the repository for local
// development and is dropped only at publish time.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PACKAGE_NAME = "@getcodesentinel/codesentinel";
const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];
const DEPENDENCY_FIELDS = [...RUNTIME_DEPENDENCY_FIELDS, "devDependencies"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const usage = () =>
  "Usage: node scripts/rewrite-cli-publish-dependencies.mjs [--package-dir <dir>]";

const parseArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

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

const { packageDir: packageDirArgument } = parseArgs(process.argv.slice(2));

const packageDir =
  packageDirArgument === undefined ? join(repoRoot, "packages/cli") : resolve(packageDirArgument);
const packageJsonPath = join(packageDir, "package.json");
const packageLabel = relative(repoRoot, packageJsonPath);

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (packageJson.name !== CLI_PACKAGE_NAME) {
  throw new Error(
    `Expected ${packageJsonPath} to be ${CLI_PACKAGE_NAME}, found ${packageJson.name}`,
  );
}

for (const field of DEPENDENCY_FIELDS) {
  const entries = packageJson[field];

  if (entries === undefined) {
    continue;
  }

  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(`${field} in ${packageLabel} must be an object`);
  }
}

const dropped = [];

for (const [name, value] of Object.entries(packageJson.devDependencies ?? {})) {
  if (typeof value === "string" && value.includes("workspace:")) {
    dropped.push({ name, value });
    continue;
  }

  if (containsWorkspaceProtocol(value)) {
    throw new Error(
      `Refusing to drop devDependencies["${name}"] in ${packageLabel}: ` +
        "its value is not a plain workspace protocol string.",
    );
  }
}

for (const field of RUNTIME_DEPENDENCY_FIELDS) {
  const entries = packageJson[field] ?? {};

  for (const [name, value] of Object.entries(entries)) {
    if (containsWorkspaceProtocol(value)) {
      throw new Error(
        `Published runtime dependency ${field}["${name}"] in ${packageLabel} cannot use the ` +
          "workspace protocol; the CLI bundles the workspace packages into dist.",
      );
    }
  }
}

if (dropped.length === 0) {
  console.log(`${packageLabel} is already free of the workspace protocol.`);
  process.exit(0);
}

for (const { name, value } of dropped) {
  delete packageJson.devDependencies[name];
  console.log(`Dropped devDependencies["${name}"] (${value}) from ${packageLabel}.`);
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
