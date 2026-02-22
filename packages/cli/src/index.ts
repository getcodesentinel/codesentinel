import { Command } from "commander";
import { runAnalyzeCommand } from "./application/run-analyze-command.js";

const program = new Command();

program
  .name("codesentinel")
  .description("Structural and evolutionary risk analysis for TypeScript/JavaScript codebases")
  .version("0.1.1");

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
