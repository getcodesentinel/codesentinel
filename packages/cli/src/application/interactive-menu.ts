import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { stderr, stdin, stdout } from "node:process";
import { clearScreenDown, cursorTo, emitKeypressEvents, moveCursor } from "node:readline";
import type { Interface as ReadlineInterface } from "node:readline";
import { createInterface as createPromisesInterface } from "node:readline/promises";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
} as const;
const PROMPT_PADDING = "  ";

type MenuActionDefinition = {
  label: string;
  description: string;
  commandBuilder: () => MenuActionResult | Promise<MenuActionResult>;
};

type MenuActionResult =
  | {
      kind: "run";
      args: readonly string[];
    }
  | {
      kind: "cancel";
    };

const isWhitespace = (value: string): boolean => /\s/.test(value);

export const splitShellLikeArgs = (input: string): string[] => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const result: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const character of trimmed) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (isWhitespace(character)) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote !== null) {
    throw new Error("Unterminated quoted argument");
  }
  if (current.length > 0) {
    result.push(current);
  }

  return result;
};

const renderMenu = (
  currentVersion: string,
  actions: readonly MenuActionDefinition[],
  selectedIndex: number,
): void => {
  const optionLabels = actions.map((action, index) => `${index + 1}. ${action.label}`);
  const labelWidth = optionLabels.reduce((max, label) => Math.max(max, label.length), 0);
  const lines = [
    `  ${ANSI.bold}${ANSI.cyan}CodeSentinel${ANSI.reset} ${ANSI.dim}v${currentVersion}${ANSI.reset}`,
    "",
    "  Choose an action:",
    "",
    ...actions.map((action, index) => {
      const selected = index === selectedIndex;
      const prefix = selected ? `${ANSI.green}>${ANSI.reset}` : " ";
      const label = optionLabels[index]?.padEnd(labelWidth, " ") ?? "";
      const renderedLabel = selected ? `${ANSI.bold}${label}${ANSI.reset}` : label;
      return `${prefix} ${renderedLabel}  ${ANSI.dim}${action.description}${ANSI.reset}`;
    }),
    "",
    `  ${ANSI.dim}Use ↑/↓ to choose. Press enter to continue. Press q or Ctrl+C to exit.${ANSI.reset}`,
  ];

  stderr.write(lines.join("\n"));
};

const clearTerminal = (): void => {
  cursorTo(stderr, 0, 0);
  clearScreenDown(stderr);
};

const hideCursor = (): void => {
  stderr.write("\x1b[?25l");
};

const showCursor = (): void => {
  stderr.write("\x1b[?25h");
};

const pipeWithPadding = (
  stream: Readable | null,
  target: NodeJS.WriteStream,
  padding: string,
): void => {
  if (stream === null) {
    return;
  }

  stream.setEncoding("utf8");

  let buffer = "";
  let needsPrefix = true;

  const writeChunk = (chunk: string): void => {
    let start = 0;
    while (start < chunk.length) {
      if (needsPrefix) {
        target.write(padding);
        needsPrefix = false;
      }

      const newlineIndex = chunk.indexOf("\n", start);
      if (newlineIndex === -1) {
        target.write(chunk.slice(start));
        return;
      }

      target.write(chunk.slice(start, newlineIndex + 1));
      needsPrefix = true;
      start = newlineIndex + 1;
    }
  };

  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lastNewlineIndex = buffer.lastIndexOf("\n");

    if (lastNewlineIndex === -1) {
      return;
    }

    writeChunk(buffer.slice(0, lastNewlineIndex + 1));
    buffer = buffer.slice(lastNewlineIndex + 1);
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      writeChunk(buffer);
      buffer = "";
    }
  });
};

const promptSelection = async (
  currentVersion: string,
  actions: readonly MenuActionDefinition[],
): Promise<number | "exit"> => {
  if (!stdin.isTTY || !stderr.isTTY || typeof stdin.setRawMode !== "function") {
    return "exit";
  }

  return await new Promise<number | "exit">((resolve) => {
    emitKeypressEvents(stdin);

    let selectedIndex = 0;
    const previousRawMode = stdin.isRaw;

    const redraw = (): void => {
      clearTerminal();
      renderMenu(currentVersion, actions, selectedIndex);
      moveCursor(stderr, -1, 0);
    };

    const cleanup = (selection: number | "exit"): void => {
      stdin.off("keypress", onKeypress);
      stdin.pause();
      stdin.setRawMode(previousRawMode);
      clearTerminal();
      showCursor();
      resolve(selection);
    };

    const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl === true && key.name === "c") {
        cleanup("exit");
        return;
      }

      if (key.name === "q") {
        cleanup("exit");
        return;
      }

      if (key.name === "up") {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : actions.length - 1;
        redraw();
        return;
      }

      if (key.name === "down") {
        selectedIndex = selectedIndex < actions.length - 1 ? selectedIndex + 1 : 0;
        redraw();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup(selectedIndex);
      }
    };

    stdin.on("keypress", onKeypress);
    hideCursor();
    stdin.setRawMode(true);
    stdin.resume();
    redraw();
  });
};

const createPrompt = (): ReadlineInterface =>
  createPromisesInterface({
    input: stdin,
    output: stderr,
  }) as unknown as ReadlineInterface;

const promptText = async (
  prompt: ReadlineInterface,
  label: string,
  defaultValue?: string,
): Promise<string | null> => {
  const suffix =
    defaultValue === undefined || defaultValue.length === 0 ? "" : ` [${defaultValue}]`;
  let answer: string;

  try {
    answer = await (prompt as unknown as ReturnType<typeof createPromisesInterface>).question(
      `${PROMPT_PADDING}${label}${suffix}: `,
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ABORT_ERR") {
      stderr.write("\n");
      return null;
    }
    throw error;
  }

  const trimmed = answer.trim();
  return trimmed.length > 0 ? trimmed : (defaultValue ?? "");
};

const renderDependencyRiskPrompt = (errorMessage?: string): void => {
  clearTerminal();
  stderr.write(`${PROMPT_PADDING}${ANSI.bold}Scan dependency risk${ANSI.reset}\n`);
  if (errorMessage !== undefined) {
    stderr.write(`\n${PROMPT_PADDING}${errorMessage}\n`);
  }
  stderr.write("\n");
};

const buildDependencyRiskArgs = async (): Promise<MenuActionResult> => {
  const prompt = createPrompt();

  try {
    let errorMessage: string | undefined;

    while (true) {
      renderDependencyRiskPrompt(errorMessage);
      const dependency = await promptText(prompt, "Package name");
      if (dependency === null) {
        return { kind: "cancel" };
      }

      if (dependency.length === 0) {
        errorMessage = "A package name is required.";
        continue;
      }

      return {
        kind: "run",
        args: ["dependency-risk", dependency],
      };
    }
  } finally {
    prompt.close();
  }
};

const waitForReturnToMenu = async (): Promise<void> => {
  if (!stdin.isTTY || !stderr.isTTY || typeof stdin.setRawMode !== "function") {
    return;
  }

  stderr.write(`\n${PROMPT_PADDING}Press enter to return to the menu...`);

  await new Promise<void>((resolve) => {
    emitKeypressEvents(stdin);
    const previousRawMode = stdin.isRaw;

    const cleanup = (): void => {
      stdin.off("keypress", onKeypress);
      stdin.pause();
      stdin.setRawMode(previousRawMode);
      showCursor();
      stderr.write("\n");
      resolve();
    };

    const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl === true && key.name === "c") {
        cleanup();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
      }
    };

    hideCursor();
    stdin.on("keypress", onKeypress);
    stdin.setRawMode(true);
    stdin.resume();
  });
};

const runCliCommand = async (scriptPath: string, args: readonly string[]): Promise<number> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, scriptPath, ...args], {
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        CODESENTINEL_NO_UPDATE_NOTIFIER: "1",
      },
    });

    pipeWithPadding(child.stdout, stdout, PROMPT_PADDING);
    pipeWithPadding(child.stderr, stderr, PROMPT_PADDING);

    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
};

export const runInteractiveCliMenu = async (input: {
  currentVersion: string;
  scriptPath: string;
}): Promise<number> => {
  if (!stdin.isTTY || !stderr.isTTY || !stdout.isTTY) {
    stderr.write(`${PROMPT_PADDING}Interactive menu requires a TTY.\n`);
    return 1;
  }

  const actions: readonly MenuActionDefinition[] = [
    {
      label: "Run overview",
      description: "combined analyze + explain + report",
      commandBuilder: () => ({ kind: "run", args: ["run"] }),
    },
    {
      label: "Analyze repository",
      description: "structural and health scoring summary",
      commandBuilder: () => ({ kind: "run", args: ["analyze"] }),
    },
    {
      label: "Explain hotspots",
      description: "top findings in markdown by default",
      commandBuilder: () => ({ kind: "run", args: ["explain", "--format", "md"] }),
    },
    {
      label: "Generate report",
      description: "create a full report for a repository",
      commandBuilder: () => ({ kind: "run", args: ["report", "--format", "md"] }),
    },
    {
      label: "Run policy check",
      description: "execute governance gates",
      commandBuilder: () => ({ kind: "run", args: ["check"] }),
    },
    {
      label: "Scan dependency risk",
      description: "inspect a package from the registry",
      commandBuilder: buildDependencyRiskArgs,
    },
  ];

  while (true) {
    const selectedIndex = await promptSelection(input.currentVersion, actions);
    if (selectedIndex === "exit") {
      stderr.write("\n");
      return 0;
    }

    const selectedAction = actions[selectedIndex];
    if (selectedAction === undefined) {
      stderr.write(`\n${PROMPT_PADDING}`);
      return 1;
    }

    const actionResult = await selectedAction.commandBuilder();
    if (actionResult.kind === "cancel") {
      continue;
    }

    const exitCode = await runCliCommand(input.scriptPath, actionResult.args);
    if (exitCode !== 0) {
      stderr.write(`\n${PROMPT_PADDING}Command exited with code ${exitCode}.\n`);
    } else {
      stderr.write("\n");
    }
    await waitForReturnToMenu();
  }
};
