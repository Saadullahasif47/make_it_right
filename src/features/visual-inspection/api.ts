import "server-only";

import type { SessionUser } from "@/features/auth/session";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { apiErrorResponse, apiJsonResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { ComplaintNotVisibleError, loadPhotoAnalyses } from "./repository";

export interface VisualAnalysisApiDependencies {
  readonly enabled: () => boolean;
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

export function createVisualAnalysisApi(deps: VisualAnalysisApiDependencies) {
  return {
    /**
     * GET /api/complaints/[id]/visual-analysis (plan v2 §12): each photo's analysis state and
     * validated result, for the reporter, the assigned department and admins. A ticket the caller
     * cannot see is a 404, never a 403.
     */
    async get(request: Request, rawId: string): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      if (!deps.enabled()) {
        return apiErrorResponse("NOT_FOUND", requestId);
      }
      const actor = await deps.getActor();
      if (actor === null) {
        return apiErrorResponse("UNAUTHENTICATED", requestId);
      }
      const complaintId = complaintIdSchema.safeParse(rawId);
      if (!complaintId.success) {
        return apiErrorResponse("NOT_FOUND", requestId);
      }
      try {
        const photos = await loadPhotoAnalyses(await deps.getClient(), complaintId.data);
        return apiJsonResponse({ photos }, requestId);
      } catch (error) {
        if (error instanceof ComplaintNotVisibleError) {
          return apiErrorResponse("NOT_FOUND", requestId);
        }
        deps
          .getLogger()
          .child({ requestId, route: "GET /api/complaints/[id]/visual-analysis" })
          .error("visual_analysis.read_failed", { error });
        return apiErrorResponse("SERVICE_UNAVAILABLE", requestId);
      }
    },
  };
}
