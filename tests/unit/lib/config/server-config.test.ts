import { describe, expect, it } from "vitest";

import { ConfigError, parseServerConfig } from "@/lib/config/server-config";

describe("parseServerConfig", () => {
  it("applies safe defaults when nothing is set", () => {
    const config = parseServerConfig({});

    expect(config).toEqual({
      nodeEnv: "development",
      appBaseUrl: undefined,
      logLevel: "info",
      ai: { enabled: false, model: "gemini-3.1-flash-lite", apiKey: undefined },
      deployment: { environment: "development", commitSha: undefined },
    });
  });

  it("keeps AI disabled when the flag is on but no key exists (tickets must not depend on AI)", () => {
    const config = parseServerConfig({ AI_ENABLED: "true" });
    expect(config.ai.enabled).toBe(false);
  });

  it("enables AI only when the flag is on and a key exists", () => {
    expect(parseServerConfig({ AI_ENABLED: "true", GEMINI_API_KEY: "k" }).ai.enabled).toBe(true);
    expect(parseServerConfig({ AI_ENABLED: "false", GEMINI_API_KEY: "k" }).ai.enabled).toBe(false);
  });

  it.each([
    ["1", true],
    ["yes", true],
    ["on", true],
    ["0", false],
    ["no", false],
    ["off", false],
  ])("parses AI_ENABLED=%s as %s", (raw, expected) => {
    const config = parseServerConfig({ AI_ENABLED: raw, GEMINI_API_KEY: "k" });
    expect(config.ai.enabled).toBe(expected);
  });

  it("rejects an ambiguous boolean instead of guessing", () => {
    expect(() => parseServerConfig({ AI_ENABLED: "maybe" })).toThrow(ConfigError);
  });

  it("treats empty and whitespace-only values as unset", () => {
    const config = parseServerConfig({
      LOG_LEVEL: "",
      APP_BASE_URL: "   ",
      GEMINI_API_KEY: "",
      AI_ENABLED: "true",
    });

    expect(config.logLevel).toBe("info");
    expect(config.appBaseUrl).toBeUndefined();
    expect(config.ai.apiKey).toBeUndefined();
    expect(config.ai.enabled).toBe(false);
  });

  it("accepts http(s) base URLs and rejects other schemes", () => {
    expect(parseServerConfig({ APP_BASE_URL: "https://mir.vercel.app" }).appBaseUrl).toBe(
      "https://mir.vercel.app",
    );
    expect(() => parseServerConfig({ APP_BASE_URL: "ftp://example.com" })).toThrow(ConfigError);
    expect(() => parseServerConfig({ APP_BASE_URL: "not a url" })).toThrow(ConfigError);
  });

  it("maps Vercel system variables into deployment info", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const config = parseServerConfig({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: sha });

    expect(config.deployment).toEqual({ environment: "preview", commitSha: sha });
  });

  it("rejects a malformed commit SHA", () => {
    expect(() => parseServerConfig({ VERCEL_GIT_COMMIT_SHA: "not-a-sha" })).toThrow(ConfigError);
  });

  it("reports every invalid variable by name without echoing any value", () => {
    const secretLookingValue = "super-secret-value-123";

    let caught: unknown;
    try {
      parseServerConfig({ LOG_LEVEL: secretLookingValue, VERCEL_ENV: secretLookingValue });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof ConfigError)) {
      throw new Error("expected a ConfigError");
    }
    expect(caught.issues).toHaveLength(2);
    expect(caught.message).toContain("LOG_LEVEL");
    expect(caught.message).toContain("VERCEL_ENV");
    expect(caught.message).not.toContain(secretLookingValue);
  });

  it("ignores unrelated environment variables", () => {
    expect(() => parseServerConfig({ PATH: "/usr/bin", HOME: "/home/x" })).not.toThrow();
  });
});
