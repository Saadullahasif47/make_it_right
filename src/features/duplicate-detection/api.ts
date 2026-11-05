import "server-only";

import { z } from "zod";

import type { SessionUser } from "@/features/auth/session";
import { isCrossSiteRequest } from "@/features/complaints/api";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { firstIssuePerField } from "@/features/complaints/service";
import { apiErrorResponse, apiJsonResponse, type ApiErrorCode } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { getSharedCase, listMatchCandidates } from "./repository";

const MAX_BODY_BYTES = 1024;

const reviewBodySchema = z.strictObject({
  candidateId: z.uuid(),
  decision: z.enum(["accepted", "rejected"]),
  expectedVersion: z.number().int().positive(),
});

export interface DuplicatesApiDependencies {
  readonly enabled: () => boolean;
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

function reviewErrorCode(sqlState: string | undefined): ApiErrorCode {
  switch (sqlState) {
    case "MR403":
      return "FORBIDDEN";
    case "MR404":
      return "NOT_FOUND";
    case "MR412":
      return "STALE_VERSION";
    case "MR422":
      return "INVALID_TRANSITION";
    case "22023":
      return "VALIDATION_FAILED";
    case undefined:
    default:
      return "SERVICE_UNAVAILABLE";
  }
}

export function createDuplicatesApi(deps: DuplicatesApiDependencies) {
  return {
    /**
     * GET /api/complaints/[id]/match-candidates (plan v2 §12): ranked candidate cases and the
     * shared case, for admins and the assigned department. Students never see candidates.
     */
    async candidates(request: Request, rawId: string): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      if (!deps.enabled()) return apiErrorResponse("NOT_FOUND", requestId);
      const actor = await deps.getActor();
      if (actor === null) return apiErrorResponse("UNAUTHENTICATED", requestId);
      if (actor.role === "student") return apiErrorResponse("NOT_FOUND", requestId);
      const complaintId = complaintIdSchema.safeParse(rawId);
      if (!complaintId.success) return apiErrorResponse("NOT_FOUND", requestId);

      try {
        const client = await deps.getClient();
        const { data: visible } = await client
          .from("complaints")
          .select("id")
          .eq("id", complaintId.data)
          .maybeSingle();
        if (visible === null) return apiErrorResponse("NOT_FOUND", requestId);
        const [candidates, sharedCase] = await Promise.all([
          listMatchCandidates(client, complaintId.data),
          getSharedCase(client, complaintId.data),
        ]);
        return apiJsonResponse({ candidates, sharedCase }, requestId);
      } catch (error) {
        deps
          .getLogger()
          .child({ requestId, route: "GET /api/complaints/[id]/match-candidates" })
          .error("duplicates.read_failed", { error });
        return apiErrorResponse("SERVICE_UNAVAILABLE", requestId);
      }
    },

    /**
     * POST /api/complaints/[id]/match-review (plan v2 §12): an admin accepts or rejects one
     * candidate, with the case version they saw. Accepting links atomically; a stale version is
     * a 409.
     */
    async review(request: Request, rawId: string): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      if (!deps.enabled()) return apiErrorResponse("NOT_FOUND", requestId);
      if (isCrossSiteRequest(request)) return apiErrorResponse("FORBIDDEN", requestId);
      if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
        return apiErrorResponse("UNSUPPORTED_MEDIA_TYPE", requestId);
      }
      const actor = await deps.getActor();
      if (actor === null) return apiErrorResponse("UNAUTHENTICATED", requestId);
      if (actor.role !== "admin") return apiErrorResponse("FORBIDDEN", requestId);
      const complaintId = complaintIdSchema.safeParse(rawId);
      if (!complaintId.success) return apiErrorResponse("NOT_FOUND", requestId);

      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
        return apiErrorResponse("PAYLOAD_TOO_LARGE", requestId);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return apiErrorResponse("VALIDATION_FAILED", requestId, {
          form: "The body must be valid JSON.",
        });
      }
      const input = reviewBodySchema.safeParse(body);
      if (!input.success) {
        return apiErrorResponse(
          "VALIDATION_FAILED",
          requestId,
          firstIssuePerField(input.error.issues),
        );
      }

      const client = await deps.getClient();
      const { data: candidate } = await client
        .from("match_candidates")
        .select("complaint_id")
        .eq("id", input.data.candidateId)
        .maybeSingle();
      if (candidate?.complaint_id !== complaintId.data) {
        return apiErrorResponse("NOT_FOUND", requestId);
      }
      const { data, error } = await client
        .rpc("review_match_candidate", {
          p_candidate_id: input.data.candidateId,
          p_decision: input.data.decision,
          p_expected_case_version: input.data.expectedVersion,
        })
        .single();
      const logger = deps
        .getLogger()
        .child({ requestId, route: "POST /api/complaints/[id]/match-review" });
      if (error !== null) {
        logger.warn("duplicates.review_refused", { code: error.code });
        return apiErrorResponse(reviewErrorCode(error.code), requestId);
      }
      logger.info("duplicates.reviewed", {
        candidateId: data.candidate_id,
        decision: data.decision,
      });
      return apiJsonResponse(
        { candidateId: data.candidate_id, decision: data.decision, caseId: data.case_id },
        requestId,
      );
    },
  };
}
