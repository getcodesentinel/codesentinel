import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalyzeCommand, type AuthorIdentityCliMode } from "./application/run-analyze-command.js";

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
  .addOption(
    new Option(
      "--author-identity <mode>",
      "author identity mode: likely_merge (heuristic) or strict_email (deterministic)",
    )
      .choices(["likely_merge", "strict_email"])
      .default("likely_merge"),
  )
  .action((path: string | undefined, options: { authorIdentity: AuthorIdentityCliMode }) => {
    const output = runAnalyzeCommand(path, options.authorIdentity);
    process.stdout.write(`${output}\n`);
  });

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
