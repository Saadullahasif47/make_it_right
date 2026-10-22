import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type DeploymentEnvironment = "development" | "preview" | "production";

/** Reads the `role` claim of a legacy Supabase JWT key without verifying it. */
function legacyJwtRole(key: string): string | undefined {
  const payload = key.split(".")[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && "role" in claims
      ? String(claims.role)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The publishable key is shipped to browsers, so a secret key in its place would be a leak.
 * Accepts the current `sb_publishable_` format and the legacy `anon` JWT only.
 */
const publishableKeySchema = z
  .string()
  .trim()
  .refine((key) => !key.startsWith("sb_secret_"), "must be the publishable key, not a secret key")
  .refine(
    (key) =>
      /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key) ||
      (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key) && legacyJwtRole(key) === "anon"),
    "must be a Supabase publishable (or legacy anon) key",
  );

/**
 * Server-side environment contract (master plan §14).
 *
 * The schema grows phase by phase: a variable is added here in the same change that
 * first reads it, so a missing value fails loudly instead of at first use.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKeySchema,
  AI_ENABLED: z.stringbool().default(false),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.1-flash-lite"),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  // System variables injected by Vercel; absent locally.
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  VERCEL_GIT_COMMIT_SHA: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i)
    .optional(),
});

export interface ServerConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly appBaseUrl: string | undefined;
  readonly logLevel: LogLevel;
  readonly supabase: {
    readonly url: string;
    readonly publishableKey: string;
  };
  readonly ai: {
    /** True only when the flag is on AND a key exists; tickets never depend on this. */
    readonly enabled: boolean;
    readonly model: string;
    readonly apiKey: string | undefined;
  };
  readonly deployment: {
    readonly environment: DeploymentEnvironment;
    readonly commitSha: string | undefined;
  };
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";

  /** Variable names with the reason they failed. Never contains values. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid server configuration: ${issues.join("; ")}`);
    this.issues = issues;
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

/** Dashboards often store unset variables as empty strings; treat them as absent. */
function withoutEmptyValues(source: EnvSource): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") {
      result[key] = value;
    }
  }
  return result;
}

export function parseServerConfig(source: EnvSource): ServerConfig {
  const parsed = serverEnvSchema.safeParse(withoutEmptyValues(source));

  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    appBaseUrl: env.APP_BASE_URL,
    logLevel: env.LOG_LEVEL,
    supabase: {
      url: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""),
      publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    ai: {
      enabled: env.AI_ENABLED && env.GEMINI_API_KEY !== undefined,
      model: env.GEMINI_MODEL,
      apiKey: env.GEMINI_API_KEY,
    },
    deployment: {
      environment: env.VERCEL_ENV ?? "development",
      commitSha: env.VERCEL_GIT_COMMIT_SHA,
    },
  };
}
