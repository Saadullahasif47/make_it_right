import { describe, expect, it } from "vitest";

import type { LogLevel } from "@/lib/config/server-config";
import { REDACTED, createLogger, redact, type LoggerOptions } from "@/lib/logging/logger";

const FIXED_NOW = new Date("2026-10-22T08:00:00.000Z");

function captureLogger(options: Omit<LoggerOptions, "sink" | "now">) {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger({
    ...options,
    now: () => FIXED_NOW,
    sink: (level, line) => {
      lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> });
    },
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes one JSON object per line with timestamp, level and event", () => {
    const { logger, lines } = captureLogger({ level: "info" });

    logger.info("ticket.created", { requestId: "req_abc", durationMs: 12 });

    expect(lines).toEqual([
      {
        level: "info",
        entry: {
          ts: "2026-10-22T08:00:00.000Z",
          level: "info",
          event: "ticket.created",
          requestId: "req_abc",
          durationMs: 12,
        },
      },
    ]);
  });

  it("drops entries below the configured level", () => {
    const { logger, lines } = captureLogger({ level: "warn" });

    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");

    expect(lines.map((line) => line.entry.event)).toEqual(["c", "d"]);
  });

  it("does not let caller fields overwrite reserved keys", () => {
    const { logger, lines } = captureLogger({ level: "debug" });

    logger.warn("real.event", { level: "debug", event: "spoofed", ts: "yesterday" });

    expect(lines[0]?.entry).toMatchObject({
      level: "warn",
      event: "real.event",
      ts: FIXED_NOW.toISOString(),
    });
  });

  it("adds child bindings to every line and lets nested children extend them", () => {
    const { logger, lines } = captureLogger({ level: "info" });

    const child = logger.child({ requestId: "req_1" }).child({ route: "/api/health" });
    child.info("health.ok");

    expect(lines[0]?.entry).toMatchObject({ requestId: "req_1", route: "/api/health" });
  });

  it("never writes stack traces", () => {
    const { logger, lines } = captureLogger({ level: "error" });

    logger.error("boom", { error: new TypeError("bad input") });

    expect(lines[0]?.entry.error).toEqual({ name: "TypeError", message: "bad input" });
    expect(JSON.stringify(lines[0]?.entry)).not.toContain("at ");
  });
});

describe("redact", () => {
  it.each([
    "password",
    "apiKey",
    "api_key",
    "GEMINI_API_KEY",
    "accessToken",
    "authorization",
    "cookie",
    "sessionId",
    "secret",
    "description",
    "email",
    "phone",
    "prompt",
  ])("redacts the sensitive key %s", (key) => {
    expect(redact({ [key]: "sensitive" })).toEqual({ [key]: REDACTED });
  });

  it("redacts at any nesting depth, including inside arrays", () => {
    const result = redact({
      ticket: { id: "t1", description: "Fan broken in my room", owner: { email: "a@b.c" } },
      attempts: [{ token: "x" }, { ok: true }],
    });

    expect(result).toEqual({
      ticket: { id: "t1", description: REDACTED, owner: { email: REDACTED } },
      attempts: [{ token: REDACTED }, { ok: true }],
    });
  });

  it("keeps non-sensitive primitives and serialises dates and bigints", () => {
    expect(
      redact({ count: 3, ok: false, none: null, at: new Date(FIXED_NOW), big: BigInt(7) }),
    ).toEqual({ count: 3, ok: false, none: null, at: FIXED_NOW.toISOString(), big: "7" });
  });

  it("truncates deeply nested structures instead of walking them forever", () => {
    const deep = { a: { b: { c: { d: { e: { f: "too deep" } } } } } };
    expect(JSON.stringify(redact(deep))).toContain("[Truncated]");
  });

  it("caps very long arrays", () => {
    const result = redact({ items: Array.from({ length: 100 }, (_, i) => i) });
    expect(result.items).toHaveLength(20);
  });
});
