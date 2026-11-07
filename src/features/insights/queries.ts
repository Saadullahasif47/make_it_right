import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import { insightsSchema, type Insights } from "./schemas";

export class InsightsError extends Error {
  override readonly name = "InsightsError";
  readonly code: "FORBIDDEN" | "VALIDATION_FAILED" | "SERVICE_UNAVAILABLE";

  constructor(sqlState: string | undefined, options?: ErrorOptions) {
    const code =
      sqlState === "MR403"
        ? "FORBIDDEN"
        : sqlState === "22023"
          ? "VALIDATION_FAILED"
          : "SERVICE_UNAVAILABLE";
    super(code, options);
    this.code = code;
  }
}

/** Alerts, ranked equipment, the weekly trend and the targets, all computed in SQL (F6.02-F6.04). */
export async function getInsights(client: AppSupabaseClient, weeks = 12): Promise<Insights> {
  const { data, error } = await client.rpc("admin_maintenance_insights", { p_weeks: weeks });
  if (error !== null) throw new InsightsError(error.code, { cause: error });
  return insightsSchema.parse(data);
}
