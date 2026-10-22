import { LOG_LEVELS, type LogLevel } from "@/lib/config/server-config";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Returns a logger that adds `bindings` (e.g. requestId) to every line. */
  child(bindings: LogFields): Logger;
}

export type LogSink = (level: LogLevel, line: string) => void;

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly bindings?: LogFields;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

export const REDACTED = "[REDACTED]";

/**
 * Field names whose values must never reach logs: credentials, and complaint or identity
 * content (master plan §8, §11). Matching is by key name, at any nesting depth.
 */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|description|email|phone|prompt/i;

const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 20;

function sanitize(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    // Messages from our own error classes are stable codes; stacks stay out of logs.
    return { name: value.name, message: value.message };
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(nested, depth + 1);
  }
  return result;
}

export function redact(fields: LogFields): Record<string, unknown> {
  const sanitized = sanitize(fields, 0);
  return typeof sanitized === "object" && sanitized !== null
    ? (sanitized as Record<string, unknown>)
    : {};
}

const defaultSink: LogSink = (level, line) => {
  switch (level) {
    case "debug":
    case "info":
      console.log(line);
      return;
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
  }
};

/** Structured JSON-lines logger; Vercel indexes stdout/stderr per function invocation. */
export function createLogger(options: LoggerOptions): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level);
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(level) < threshold) {
      return;
    }
    // Reserved keys are written last so caller fields can never spoof them.
    const line = { ...redact(bindings), ...redact(fields), ts: now().toISOString(), level, event };
    sink(level, JSON.stringify(line));
  };

  return {
    debug: (event, fields) => {
      write("debug", event, fields);
    },
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}
