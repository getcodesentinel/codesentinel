export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const logLevelRank: Readonly<Record<Exclude<LogLevel, "silent">, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export type Logger = {
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
  debug: (message: string) => void;
};

const noop = (): void => {};

export const createSilentLogger = (): Logger => ({
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
});

const shouldLog = (configuredLevel: LogLevel, messageLevel: Exclude<LogLevel, "silent">): boolean => {
  if (configuredLevel === "silent") {
    return false;
  }

  return logLevelRank[messageLevel] <= logLevelRank[configuredLevel];
};

const write = (messageLevel: Exclude<LogLevel, "silent">, message: string): void => {
  process.stderr.write(`[codesentinel] ${messageLevel.toUpperCase()} ${message}\n`);
};

export const createStderrLogger = (level: LogLevel): Logger => {
  if (level === "silent") {
    return createSilentLogger();
  }

  return {
    error: (message) => {
      if (shouldLog(level, "error")) {
        write("error", message);
      }
    },
    warn: (message) => {
      if (shouldLog(level, "warn")) {
        write("warn", message);
      }
    },
    info: (message) => {
      if (shouldLog(level, "info")) {
        write("info", message);
      }
    },
    debug: (message) => {
      if (shouldLog(level, "debug")) {
        write("debug", message);
      }
    },
  };
};

export const parseLogLevel = (value: string | undefined): LogLevel => {
  switch (value) {
    case "silent":
    case "error":
    case "warn":
    case "info":
    case "debug":
      return value;
    default:
      return "info";
  }
};
