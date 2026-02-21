import { Command } from "commander";
import { resolveTargetPath } from "@codesentinel/core";

const program = new Command();

program
  .name("codesentinel")
  .description("Structural and evolutionary risk analysis for TypeScript/JavaScript codebases")
  .version("0.1.0");

program
  .command("analyze")
  .argument("[path]", "path to the project to analyze")
  .action((path?: string) => {
    const target = resolveTargetPath(path);
    console.log(`Analyzing project at ${target.absolutePath}`);
  });

program.parse(process.argv);
