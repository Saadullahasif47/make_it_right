import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { getServerConfig } from "@/lib/config";

import { authCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

export type AppSupabaseClient = SupabaseClient<Database>;

/**
 * Request-scoped client acting as the signed-in user, so every query is subject to RLS.
 * Create one per request: the client caches session state and must never be shared.
 *
 * `connection()` keeps all session work out of prerendered and prefetched App Shells:
 * authorisation is always evaluated against the live request (token expiry checks need the
 * real clock), trading prefetch speed for never showing a stale authorised view.
 */
export async function createSupabaseServerClient(): Promise<AppSupabaseClient> {
  await connection();
  const cookieStore = await cookies();
  const config = getServerConfig();

  return createServerClient<Database>(config.supabase.url, config.supabase.publishableKey, {
    cookieOptions: authCookieOptions(config),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. That is safe here because proxy.ts has
          // already refreshed the session for this request; actions and route handlers can.
        }
      },
    },
  });
}
