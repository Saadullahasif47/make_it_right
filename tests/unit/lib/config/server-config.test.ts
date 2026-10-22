import { describe, expect, it } from "vitest";

import { ConfigError, parseServerConfig } from "@/lib/config/server-config";

import { REQUIRED_ENV, configWith, legacyJwtKey } from "../../../support/env";

function captureConfigError(source: Record<string, string | undefined>): ConfigError {
  try {
    parseServerConfig(source);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("parseServerConfig", () => {
  it("applies safe defaults for everything optional", () => {
    expect(configWith()).toEqual({
      nodeEnv: "development",
      appBaseUrl: undefined,
      logLevel: "info",
      supabase: {
        url: REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      },
      ai: { enabled: false, model: "gemini-3.1-flash-lite", apiKey: undefined },
      deployment: { environment: "development", commitSha: undefined },
    });
  });

  it("requires the Supabase URL and publishable key", () => {
    const error = captureConfigError({});
    expect(error.issues.join(" ")).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(error.issues.join(" ")).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("drops a trailing slash from the Supabase URL", () => {
    expect(configWith({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/" }).supabase.url).toBe(
      "http://127.0.0.1:54321",
    );
  });

  it("accepts a legacy anon JWT as the publishable key", () => {
    const key = legacyJwtKey("anon");
    expect(configWith({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).supabase.publishableKey).toBe(
      key,
    );
  });

  it.each([
    ["a new-style secret key", "sb_secret_TestOnlyKey0123456789"],
    ["a legacy service_role JWT", legacyJwtKey("service_role")],
    ["a malformed key", "not-a-key"],
    ["a JWT with an unreadable payload", "eyJhbGciOiJIUzI1NiJ9.%%%.sig"],
  ])("refuses %s as the publishable key, without echoing it", (_label, key) => {
    const error = captureConfigError({
      ...REQUIRED_ENV,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    });

    expect(error.issues.join(" ")).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(error.message).not.toContain(key);
  });

  it("keeps AI disabled when the flag is on but no key exists (tickets must not depend on AI)", () => {
    expect(configWith({ AI_ENABLED: "true" }).ai.enabled).toBe(false);
  });

  it("enables AI only when the flag is on and a key exists", () => {
    expect(configWith({ AI_ENABLED: "true", GEMINI_API_KEY: "k" }).ai.enabled).toBe(true);
    expect(configWith({ AI_ENABLED: "false", GEMINI_API_KEY: "k" }).ai.enabled).toBe(false);
  });

  it.each([
    ["1", true],
    ["yes", true],
    ["on", true],
    ["0", false],
    ["no", false],
    ["off", false],
  ])("parses AI_ENABLED=%s as %s", (raw, expected) => {
    expect(configWith({ AI_ENABLED: raw, GEMINI_API_KEY: "k" }).ai.enabled).toBe(expected);
  });

  it("rejects an ambiguous boolean instead of guessing", () => {
    expect(() => configWith({ AI_ENABLED: "maybe" })).toThrow(ConfigError);
  });

  it("treats empty and whitespace-only values as unset", () => {
    const config = configWith({
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
    expect(configWith({ APP_BASE_URL: "https://mir.vercel.app" }).appBaseUrl).toBe(
      "https://mir.vercel.app",
    );
    expect(() => configWith({ APP_BASE_URL: "ftp://example.com" })).toThrow(ConfigError);
    expect(() => configWith({ APP_BASE_URL: "not a url" })).toThrow(ConfigError);
  });

  it("maps Vercel system variables into deployment info", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const config = configWith({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: sha });

    expect(config.deployment).toEqual({ environment: "preview", commitSha: sha });
  });

  it("rejects a malformed commit SHA", () => {
    expect(() => configWith({ VERCEL_GIT_COMMIT_SHA: "not-a-sha" })).toThrow(ConfigError);
  });

  it("reports every invalid variable by name without echoing any value", () => {
    const secretLookingValue = "super-secret-value-123";
    const error = captureConfigError({
      ...REQUIRED_ENV,
      LOG_LEVEL: secretLookingValue,
      VERCEL_ENV: secretLookingValue,
    });

    expect(error.issues).toHaveLength(2);
    expect(error.message).toContain("LOG_LEVEL");
    expect(error.message).toContain("VERCEL_ENV");
    expect(error.message).not.toContain(secretLookingValue);
  });

  it("ignores unrelated environment variables", () => {
    expect(() => configWith({ PATH: "/usr/bin", HOME: "/home/x" })).not.toThrow();
  });
});
