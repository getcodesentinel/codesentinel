import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalyzeCommand } from "./application/run-analyze-command.js";

const program = new Command();
const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

program
  .name("codesentinel")
  .description("Structural and evolutionary risk analysis for TypeScript/JavaScript codebases")
  .version(version);

program
  .command("analyze")
  .argument("[path]", "path to the project to analyze")
  .action((path?: string) => {
    const output = runAnalyzeCommand(path);
    process.stdout.write(`${output}\n`);
  });

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
