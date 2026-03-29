import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cliPackageDirectory = resolve(scriptDirectory, "..");
const htmlAppDist = resolve(cliPackageDirectory, "../html-report-app/dist");
const cliTarget = resolve(cliPackageDirectory, "dist/html-report-app");

const appStats = await stat(htmlAppDist).catch(() => undefined);
if (appStats === undefined || !appStats.isDirectory()) {
  throw new Error(`missing built html report app at ${htmlAppDist}`);
}

await mkdir(resolve(cliPackageDirectory, "dist"), { recursive: true });
await rm(cliTarget, { recursive: true, force: true });
await cp(htmlAppDist, cliTarget, { recursive: true, force: true });
