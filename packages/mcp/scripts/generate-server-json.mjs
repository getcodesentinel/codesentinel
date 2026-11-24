import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(packageDir, "package.json");
const outPath = join(packageDir, "server.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const field of ["name", "version", "description", "mcpName"]) {
  if (typeof manifest[field] !== "string" || manifest[field].trim().length === 0) {
    throw new Error(`Invalid ${field} in ${manifestPath}: expected a non-empty string`);
  }
}

if (!/^io\.github\.[a-z0-9-]+\/[a-z0-9._-]+$/i.test(manifest.mcpName)) {
  throw new Error(`Invalid mcpName in ${manifestPath}: "${manifest.mcpName}"`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error(`Invalid version in ${manifestPath}: "${manifest.version}"`);
}
if (manifest.description.length > 100) {
  throw new Error(
    `Invalid description in ${manifestPath}: length ${manifest.description.length} exceeds 100`,
  );
}

const document = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: manifest.mcpName,
  description: manifest.description,
  version: manifest.version,
  title: "CodeSentinel",
  websiteUrl: "https://github.com/getcodesentinel/codesentinel",
  repository: {
    url: "https://github.com/getcodesentinel/codesentinel",
    source: "github",
    subfolder: "packages/mcp",
  },
  packages: [
    {
      registryType: "npm",
      identifier: manifest.name,
      version: manifest.version,
      runtimeHint: "node",
      transport: {
        type: "stdio",
      },
    },
  ],
};

writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `Wrote ${relative(process.cwd(), outPath)} for ${manifest.mcpName}@${manifest.version}`,
);
