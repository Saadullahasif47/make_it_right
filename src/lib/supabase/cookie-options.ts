import type { CookieOptionsWithName } from "@supabase/ssr";

import type { ServerConfig } from "@/lib/config/server-config";

/**
 * Session cookies are only ever read on the server (there is no browser Supabase client), so
 * they are HttpOnly: injected script cannot read the tokens. SameSite=Lax blocks cross-site
 * form posts from carrying the session.
 */
export function authCookieOptions(config: ServerConfig): CookieOptionsWithName {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.nodeEnv === "production",
  };
}
