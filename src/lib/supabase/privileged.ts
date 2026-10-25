import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerConfig } from "@/lib/config";

import type { Database } from "./database.types";

/** A service-role client: it bypasses RLS. */
export type PrivilegedSupabaseClient = SupabaseClient<Database>;

let cached: PrivilegedSupabaseClient | null | undefined;

/**
 * The service-role client for the agent's privileged adapter (plan §9, ADR 0005), or null when
 * no secret key is configured. Lint restricts imports of this module to src/features/agent.
 *
 * It holds no user session, so one instance per server process is safe to share. It is used
 * only to call agent_begin_run / agent_finish_run and to read the routing reference data.
 */
export function getPrivilegedSupabaseClient(): PrivilegedSupabaseClient | null {
  if (cached !== undefined) {
    return cached;
  }
  const { supabase } = getServerConfig();
  cached =
    supabase.secretKey === undefined
      ? null
      : createClient<Database>(supabase.url, supabase.secretKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
  return cached;
}
