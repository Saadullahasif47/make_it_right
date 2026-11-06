import "server-only";

import { z } from "zod";

import type { SessionUser } from "@/features/auth/session";
import { isCrossSiteRequest } from "@/features/complaints/api";
import { apiErrorResponse, apiJsonResponse, type ApiErrorCode } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

const caseIdSchema = z.uuid();

export interface CoordinationApiDependencies {
  readonly enabled: () => boolean;
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

function requestErrorCode(sqlState: string | undefined): ApiErrorCode {
  switch (sqlState) {
    case "MR403":
      return "FORBIDDEN";
    case "MR404":
      return "NOT_FOUND";
    case "MR422":
      return "INVALID_TRANSITION";
    case "MR429":
      return "RATE_LIMITED";
    case undefined:
    default:
      return "SERVICE_UNAVAILABLE";
  }
}

export function createCoordinationApi(deps: CoordinationApiDependencies) {
  return {
    /**
     * POST /api/cases/[id]/coordinate (plan v2 §12, department or admin): queues one bounded
     * coordinator job and answers at once (202). A department may ask only about its own case;
     * the database enforces that.
     */
    async coordinate(request: Request, rawId: string): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      if (!deps.enabled()) return apiErrorResponse("NOT_FOUND", requestId);
      if (isCrossSiteRequest(request)) return apiErrorResponse("FORBIDDEN", requestId);
      const actor = await deps.getActor();
      if (actor === null) return apiErrorResponse("UNAUTHENTICATED", requestId);
      if (actor.role === "student") return apiErrorResponse("NOT_FOUND", requestId);
      const caseId = caseIdSchema.safeParse(rawId);
      if (!caseId.success) return apiErrorResponse("NOT_FOUND", requestId);

      const client = await deps.getClient();
      const { data: jobId, error } = await client.rpc("request_case_coordination", {
        p_case_id: caseId.data,
      });
      const logger = deps
        .getLogger()
        .child({ requestId, route: "POST /api/cases/[id]/coordinate" });
      if (error !== null) {
        logger.warn("coordination.request_refused", { code: error.code });
        return apiErrorResponse(requestErrorCode(error.code), requestId);
      }
      logger.info("coordination.requested", { caseId: caseId.data, jobId });
      return apiJsonResponse({ caseId: caseId.data, jobId }, requestId, 202);
    },

    /**
     * GET /api/cases/[id]/work-orders (plan v2 §12): the case's work orders, newest first, for
     * admins and the department that holds the case. RLS decides visibility; a case the caller
     * cannot see is a 404, never a 403, so its existence does not leak.
     */
    async workOrders(request: Request, rawId: string): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      if (!deps.enabled()) return apiErrorResponse("NOT_FOUND", requestId);
      const actor = await deps.getActor();
      if (actor === null) return apiErrorResponse("UNAUTHENTICATED", requestId);
      if (actor.role === "student") return apiErrorResponse("NOT_FOUND", requestId);
      const caseId = caseIdSchema.safeParse(rawId);
      if (!caseId.success) return apiErrorResponse("NOT_FOUND", requestId);

      try {
        const client = await deps.getClient();
        const { data: visible, error: caseError } = await client
          .from("maintenance_cases")
          .select("id, version, status")
          .eq("id", caseId.data)
          .maybeSingle();
        if (caseError !== null) throw new Error(`case lookup failed: ${caseError.code}`);
        if (visible === null) return apiErrorResponse("NOT_FOUND", requestId);
        const { data, error } = await client
          .from("case_work_orders")
          .select(
            "id, status, source, assigned_at, completed_at, cancelled_at, department:departments(id, name)",
          )
          .eq("case_id", caseId.data)
          .order("assigned_at", { ascending: false })
          .limit(50);
        if (error !== null) throw new Error(`work order lookup failed: ${error.code}`);
        return apiJsonResponse(
          {
            case: { id: visible.id, version: visible.version, status: visible.status },
            workOrders: data.map((row) => ({
              id: row.id,
              status: row.status,
              source: row.source,
              department: row.department,
              assignedAt: row.assigned_at,
              completedAt: row.completed_at,
              cancelledAt: row.cancelled_at,
            })),
          },
          requestId,
        );
      } catch (error) {
        deps
          .getLogger()
          .child({ requestId, route: "GET /api/cases/[id]/work-orders" })
          .error("coordination.read_failed", { error });
        return apiErrorResponse("SERVICE_UNAVAILABLE", requestId);
      }
    },
  };
}
