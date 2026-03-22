import { spawn } from "node:child_process";
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

type MenuActionDefinition = {
  label: string;
  description: string;
  commandBuilder: () => readonly string[] | null | Promise<readonly string[] | null>;
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
): Promise<string> => {
  const suffix = defaultValue === undefined ? "" : ` [${defaultValue}]`;
  const answer = await (prompt as unknown as ReturnType<typeof createPromisesInterface>).question(
    `${label}${suffix}: `,
  );
  const trimmed = answer.trim();
  return trimmed.length > 0 ? trimmed : (defaultValue ?? "");
};

const buildDependencyRiskArgs = async (): Promise<readonly string[] | null> => {
  const prompt = createPrompt();

  try {
    const dependency = await promptText(prompt, "Dependency spec", "");
    if (dependency.length === 0) {
      stderr.write("A dependency spec is required.\n");
      return null;
    }

    return ["dependency-risk", dependency];
  } finally {
    prompt.close();
  }
};

const waitForReturnToMenu = async (): Promise<void> => {
  const prompt = createPromisesInterface({
    input: stdin,
    output: stderr,
  });

  try {
    await prompt.question("Press enter to return to the menu...");
  } finally {
    prompt.close();
  }
};

const runCliCommand = async (scriptPath: string, args: readonly string[]): Promise<number> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, scriptPath, ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        CODESENTINEL_NO_UPDATE_NOTIFIER: "1",
      },
    });

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
    stderr.write("Interactive menu requires a TTY.\n");
    return 1;
  }

  const actions: readonly MenuActionDefinition[] = [
    {
      label: "Run overview",
      description: "combined analyze + explain + report",
      commandBuilder: () => ["run"],
    },
    {
      label: "Analyze repository",
      description: "structural and health scoring summary",
      commandBuilder: () => ["analyze"],
    },
    {
      label: "Explain hotspots",
      description: "top findings in markdown by default",
      commandBuilder: () => ["explain", "--format", "md"],
    },
    {
      label: "Generate report",
      description: "create a full report for a repository",
      commandBuilder: () => ["report", "--format", "md"],
    },
    {
      label: "Run policy check",
      description: "execute governance gates",
      commandBuilder: () => ["check"],
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
      stderr.write("\n");
      return 1;
    }

    const args = await selectedAction.commandBuilder();
    if (args === null) {
      await waitForReturnToMenu();
      continue;
    }

    const exitCode = await runCliCommand(input.scriptPath, args);
    if (exitCode !== 0) {
      stderr.write(`\nCommand exited with code ${exitCode}.\n`);
    } else {
      stderr.write("\n");
    }
    await waitForReturnToMenu();
  }
};
