import { describe, expect, it, vi } from "vitest";

import { createHealthHandler } from "@/features/health/health-handler";
import { ConfigError, parseServerConfig, type ServerConfig } from "@/lib/config/server-config";
import { createLogger } from "@/lib/logging/logger";
import { createRequestId } from "@/lib/logging/request-id";

function silentLogger() {
  const sink = vi.fn<(level: string, line: string) => void>();
  return { logger: createLogger({ level: "debug", sink }), sink };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/health", { headers });
}

describe("health handler", () => {
  it("returns ok with the local version outside Vercel", async () => {
    const { logger } = silentLogger();
    const handle = createHealthHandler({ loadConfig: () => parseServerConfig({}), logger });

    const response = handle(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      version: "local",
      environment: "development",
    });
  });

  it("reports the short commit SHA and environment of a Vercel deployment", async () => {
    const { logger } = silentLogger();
    const config: ServerConfig = parseServerConfig({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "abcdef0123456789abcdef0123456789abcdef01",
    });
    const handle = createHealthHandler({ loadConfig: () => config, logger });

    expect(await handle(request()).json()).toEqual({
      status: "ok",
      version: "abcdef0",
      environment: "preview",
    });
  });

  it("never exposes secrets, even when they are configured", async () => {
    const { logger } = silentLogger();
    const config = parseServerConfig({ GEMINI_API_KEY: "gem-secret-key", AI_ENABLED: "true" });
    const handle = createHealthHandler({ loadConfig: () => config, logger });

    const text = await handle(request()).text();
    expect(text).not.toContain("gem-secret-key");
    expect(text).not.toContain("gemini");
  });

  it("echoes a valid inbound request ID", () => {
    const { logger } = silentLogger();
    const handle = createHealthHandler({ loadConfig: () => parseServerConfig({}), logger });
    const id = createRequestId();

    expect(handle(request({ "x-request-id": id })).headers.get("x-request-id")).toBe(id);
  });

  it("answers a safe 503 and logs the reason when configuration is invalid", async () => {
    const { logger, sink } = silentLogger();
    const handle = createHealthHandler({
      loadConfig: () => {
        throw new ConfigError(["LOG_LEVEL: Invalid option"]);
      },
      logger,
    });

    const response = handle(request());
    const body = (await response.json()) as { error: { code: string; requestId: string } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("LOG_LEVEL");
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);

    expect(sink).toHaveBeenCalledTimes(1);
    const [level, line] = sink.mock.calls[0] ?? [];
    expect(level).toBe("error");
    expect(line).toContain("health.config_invalid");
    expect(line).toContain(body.error.requestId);
  });
});
