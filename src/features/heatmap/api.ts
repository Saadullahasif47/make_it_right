import "server-only";

import type { SessionUser } from "@/features/auth/session";
import { getInsights, InsightsError } from "@/features/insights/queries";
import { apiErrorResponse, apiJsonResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { HeatmapError, getHeatmap } from "./queries";
import { heatmapFiltersSchema } from "./schemas";

export interface AnalyticsApiDependencies {
  readonly heatmapEnabled: () => boolean;
  readonly insightsEnabled: () => boolean;
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

/**
 * The admin analytics APIs (plan v2 §12): aggregated counts only, no report text or names.
 * A switched-off feature is invisible (404); anyone but an administrator is refused.
 */
export function createAnalyticsApi(deps: AnalyticsApiDependencies) {
  async function guard(request: Request, enabled: boolean) {
    const requestId = resolveRequestId(request.headers);
    if (!enabled) return { requestId, refused: apiErrorResponse("NOT_FOUND", requestId) };
    const actor = await deps.getActor();
    if (actor === null)
      return { requestId, refused: apiErrorResponse("UNAUTHENTICATED", requestId) };
    if (actor.role !== "admin")
      return { requestId, refused: apiErrorResponse("FORBIDDEN", requestId) };
    return { requestId, refused: null };
  }

  return {
    /** GET /api/admin/heatmap?days=&building=&floor=&category=&department=&status=&synthetic= */
    async heatmap(request: Request): Promise<Response> {
      const { requestId, refused } = await guard(request, deps.heatmapEnabled());
      if (refused !== null) return refused;
      const filters = heatmapFiltersSchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      try {
        return apiJsonResponse(await getHeatmap(await deps.getClient(), filters), requestId);
      } catch (error) {
        const code = error instanceof HeatmapError ? error.code : "SERVICE_UNAVAILABLE";
        deps
          .getLogger()
          .child({ requestId, route: "GET /api/admin/heatmap" })
          .warn("heatmap.failed", { code, error });
        return apiErrorResponse(code, requestId);
      }
    },

    /** GET /api/admin/maintenance-insights?weeks=4..26 */
    async insights(request: Request): Promise<Response> {
      const { requestId, refused } = await guard(request, deps.insightsEnabled());
      if (refused !== null) return refused;
      const raw = new URL(request.url).searchParams.get("weeks");
      const weeks = raw === null ? 12 : Number(raw);
      if (!Number.isInteger(weeks) || weeks < 4 || weeks > 26) {
        return apiErrorResponse("VALIDATION_FAILED", requestId, {
          weeks: "Use a whole number from 4 to 26.",
        });
      }
      try {
        return apiJsonResponse(await getInsights(await deps.getClient(), weeks), requestId);
      } catch (error) {
        const code = error instanceof InsightsError ? error.code : "SERVICE_UNAVAILABLE";
        deps
          .getLogger()
          .child({ requestId, route: "GET /api/admin/maintenance-insights" })
          .warn("insights.failed", { code, error });
        return apiErrorResponse(code, requestId);
      }
    },
  };
}
