import { parseServerConfig, type ServerConfig } from "@/lib/config/server-config";

/** Minimal valid environment for unit tests. Values are fake and never reach a network. */
export const REQUIRED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TestOnlyKey0123456789",
} as const;

export function configWith(overrides: Record<string, string | undefined> = {}): ServerConfig {
  return parseServerConfig({ ...REQUIRED_ENV, ...overrides });
}

/** Builds an unsigned legacy-style Supabase JWT key carrying the given role claim. */
export function legacyJwtKey(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: "supabase", role })}.c2lnbmF0dXJl`;
}
