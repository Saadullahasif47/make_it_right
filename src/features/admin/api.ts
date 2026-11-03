import "server-only";

import type { SessionUser } from "@/features/auth/session";
import { ComplaintError } from "@/features/complaints/errors";
import { apiErrorResponse, apiJsonResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { METRIC_WINDOWS, getAdminMetrics, parseWindow } from "./metrics";

export interface AdminApiDependencies {
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

export function createAdminApi(deps: AdminApiDependencies) {
  return {
    /** GET /api/admin/metrics?window=7|30|90: an admin summary of the current state (plan §11). */
    async metrics(request: Request): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      const actor = await deps.getActor();
      if (actor === null) {
        return apiErrorResponse("UNAUTHENTICATED", requestId);
      }
      if (actor.role !== "admin") {
        return apiErrorResponse("FORBIDDEN", requestId);
      }

      const window = parseWindow(new URL(request.url).searchParams.get("window"));
      if (window === undefined) {
        return apiErrorResponse("VALIDATION_FAILED", requestId, {
          window: `Use one of: ${METRIC_WINDOWS.join(", ")} (days).`,
        });
      }

      try {
        return apiJsonResponse(await getAdminMetrics(await deps.getClient(), window), requestId);
      } catch (error) {
        const code = error instanceof ComplaintError ? error.code : "SERVICE_UNAVAILABLE";
        deps
          .getLogger()
          .child({ requestId, route: "GET /api/admin/metrics" })
          .warn("admin.metrics_failed", {
            code,
            error,
          });
        return apiErrorResponse(code, requestId);
      }
    },
  };
}
