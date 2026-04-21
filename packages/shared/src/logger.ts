// author: Claude
import winston from "winston";
import type { LogLevel } from "./types.ts";

/**
 * Shared Winston-backed logger factory.
 *
 * Each package calls `createLogger<FieldSchema>()` to get its own typed
 * `logger`, `setLogLevel`, and `setPrettyMode` trio. The factory owns the
 * lazy winston construction, pretty/JSON format toggle, and runtime level
 * override — the consumer only provides the `LogFields` shape.
 *
 * The generic `F` is the package's closed set of allowed log fields. In mcp
 * it's `LogFields` (an I7 type-level guarantee that raw content can't leak
 * into logs); in bench it's a broader shape for bench-specific telemetry.
 */

export type LogFieldsBase = Record<string, unknown>;

export type Logger<F extends LogFieldsBase = LogFieldsBase> = {
  debug: (event: string, fields?: F) => void;
  info: (event: string, fields?: F) => void;
  warn: (event: string, fields?: F) => void;
  error: (event: string, fields?: F) => void;
};

export type LoggerHandle<F extends LogFieldsBase = LogFieldsBase> = {
  logger: Logger<F>;
  setLogLevel: (level: LogLevel) => void;
  setPrettyMode: (enabled: boolean) => void;
};

export type LoggerOptions = {
  level?: LogLevel;
  pretty?: boolean;
};

const ANSI_RESET = "\x1b[0m";

type LevelStyle = { color: string; emoji: string };

const LEVEL_STYLES: Readonly<Record<string, LevelStyle>> = {
  debug: { color: "\x1b[36m", emoji: "🐛" },
  info: { color: "\x1b[32m", emoji: "💬" },
  warn: { color: "\x1b[33m", emoji: "⚠️ " },
  error: { color: "\x1b[31m", emoji: "❌" },
};

const FALLBACK_STYLE: LevelStyle = { color: "", emoji: "  " };

const makePrettyFormat = (): winston.Logform.Format =>
  winston.format.combine(
    winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
    winston.format.printf(({ level, message, timestamp, ...rest }) => {
      const style = LEVEL_STYLES[level] ?? FALLBACK_STYLE;
      const entries = Object.entries(rest).filter(([, v]) => v !== undefined);
      const meta =
        entries.length > 0
          ? `  ${entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`
          : "";
      return `${style.color}${String(timestamp)} | ${style.emoji} ${level.padEnd(5)} | ${String(message)}${meta}${ANSI_RESET}`;
    }),
  );

const makeJsonFormat = (): winston.Logform.Format =>
  winston.format.combine(winston.format.timestamp(), winston.format.json());

const DEFAULT_LEVEL: LogLevel = "info";

/**
 * Creates a typed logger bundle. Each invocation returns an independent
 * instance — state (level override, pretty mode, lazy winston instance) is
 * closed over per call, so multiple packages don't collide.
 */
export const createLogger = <F extends LogFieldsBase = LogFieldsBase>(
  opts?: LoggerOptions,
): LoggerHandle<F> => {
  let _winston: winston.Logger | null = null;
  let _levelOverride: LogLevel = opts?.level ?? DEFAULT_LEVEL;
  let _prettyMode = opts?.pretty ?? false;

  const getWinston = (): winston.Logger => {
    if (_winston) return _winston;
    _winston = winston.createLogger({
      level: _levelOverride,
      format: _prettyMode ? makePrettyFormat() : makeJsonFormat(),
      transports: [new winston.transports.Console()],
    });
    return _winston;
  };

  const emit =
    (level: "debug" | "info" | "warn" | "error") =>
    (event: string, fields?: F): void => {
      getWinston()[level](event, fields ?? {});
    };

  const logger: Logger<F> = {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };

  /**
   * Set the runtime log level. Called by startup code after env/config have
   * loaded; no-op otherwise. Tests can override directly without booting env.
   */
  const setLogLevel = (level: LogLevel): void => {
    _levelOverride = level;
    if (_winston) _winston.level = level;
  };

  /**
   * Toggle pretty console output. When true, each line is colored and
   * prefixed with an emoji based on level. When false, standard JSON is
   * emitted. Forces transport recreation if the mode actually changed.
   */
  const setPrettyMode = (enabled: boolean): void => {
    if (_prettyMode === enabled) return;
    _prettyMode = enabled;
    _winston = null;
  };

  return { logger, setLogLevel, setPrettyMode };
};
