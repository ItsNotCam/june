import type { LogLevel } from "@june/shared";
import winston from "winston";

/**
 * Typed logger surface every module imports. Per I7 ([§26.2](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#262-the-type-level-content-block-per-i7)) the permitted
 * field set is closed — there is no `content`, `text`, `body`, `chunk`, or
 * `markdown` key. Adding a field requires editing `LogFields` (and passing PR
 * review on whether the new field could hold raw document content).
 *
 * Raw chunk/section/document markdown cannot reach the logger by construction.
 */
export type LogFields = {
  doc_id?: string;
  chunk_id?: string;
  section_id?: string;
  run_id?: string;
  stage?: string;
  count?: number;
  duration_ms?: number;
  error_type?: string;
  error_message?: string;
  field_names?: ReadonlyArray<string>;
  whitelist?: ReadonlyArray<string>;
  signal?: string;
  event?: string;
  status?: string;
  source_uri?: string;
  model_name?: string;
  model_version?: string;
  heartbeat_age_s?: number;
  attempt?: number;
  size_chars?: number;
  reason?: string;
  batch_size?: number;
  raw_preview?: string;
};

export type Logger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
};

const ANSI_RESET = "\x1b[0m";

type LevelStyle = { color: string; emoji: string };

const LEVEL_STYLES: Readonly<Record<string, LevelStyle>> = {
  debug: { color: "\x1b[36m", emoji: "🐛" },
  info:  { color: "\x1b[32m", emoji: "💬" },
  warn:  { color: "\x1b[33m", emoji: "⚠️ " },
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
  winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  );

const DEFAULT_LEVEL: LogLevel = "info";

let _winston: winston.Logger | null = null;
let _levelOverride: LogLevel | null = null;
let _prettyMode = false;

/**
 * Set the runtime log level. Called by startup code after env/config have
 * loaded; no-op otherwise. Tests can override directly without booting env.
 */
export const setLogLevel = (level: LogLevel): void => {
  _levelOverride = level;
  if (_winston) _winston.level = level;
};

/**
 * Toggle pretty console output. When true, each line is colored and prefixed
 * with an emoji based on level. When false, standard JSON is emitted.
 * Must be called before the first log call, or will recreate the transport.
 */
export const setPrettyMode = (enabled: boolean): void => {
  if (_prettyMode === enabled) return;
  _prettyMode = enabled;
  _winston = null; // force recreation with the new format
};

const getWinston = (): winston.Logger => {
  if (_winston) return _winston;
  _winston = winston.createLogger({
    level: _levelOverride ?? DEFAULT_LEVEL,
    format: _prettyMode ? makePrettyFormat() : makeJsonFormat(),
    transports: [new winston.transports.Console()],
  });
  return _winston;
};

const emit = (level: "debug" | "info" | "warn" | "error") =>
  (event: string, fields?: LogFields): void => {
    getWinston()[level](event, fields ?? {});
  };

/**
 * Shared logger. Import this — not `winston` — everywhere in `src/`, `cli/`,
 * and `benchmark/`. The `Logger` type forbids raw-content fields at the type
 * layer ([§26.2](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#262-the-type-level-content-block-per-i7) / I7).
 */
export const logger: Logger = {
  debug: emit("debug"),
  info: emit("info"),
  warn: emit("warn"),
  error: emit("error"),
};
