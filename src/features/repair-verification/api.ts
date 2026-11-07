import "server-only";

import { z } from "zod";

import type { AppRole } from "@/features/auth/roles";
import type { SessionUser } from "@/features/auth/session";
import { isCrossSiteRequest } from "@/features/complaints/api";
import { firstIssuePerField } from "@/features/complaints/service";
import { EvidenceError } from "@/features/evidence/errors";
import { finalizeRequestSchema } from "@/features/evidence/schemas";
import { apiErrorResponse, apiJsonResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { repairUploadRequestSchema, verificationDecisionSchema } from "./schemas";
import {
  DecisionError,
  decideVerification,
  finalizeRepairUpload,
  requestRepairUpload,
} from "./service";

const MAX_BODY_BYTES = 2048;
const caseIdSchema = z.uuid();

export interface RepairApiDependencies {
  readonly enabled: () => boolean;
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

type Guarded =
  | {
      readonly ok: true;
      readonly requestId: string;
      readonly logger: Logger;
      readonly caseId: string;
      readonly body: unknown;
    }
  | { readonly ok: false; readonly response: Response };

export function createRepairApi(deps: RepairApiDependencies) {
  /**
   * The evidence API's order: a switched-off feature is invisible (404); no cross-site calls,
   * JSON only, a signed-in caller of an allowed role, a size cap, then parse. The database
   * re-checks the role and the case on every call.
   */
  async function guard(
    request: Request,
    route: string,
    rawId: string,
    roles: readonly AppRole[],
  ): Promise<Guarded> {
    const requestId = resolveRequestId(request.headers);
    const fail = (response: Response): Guarded => ({ ok: false, response });
    if (!deps.enabled()) return fail(apiErrorResponse("NOT_FOUND", requestId));
    if (isCrossSiteRequest(request)) return fail(apiErrorResponse("FORBIDDEN", requestId));
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return fail(apiErrorResponse("UNSUPPORTED_MEDIA_TYPE", requestId));
    }
    const actor = await deps.getActor();
    if (actor === null) return fail(apiErrorResponse("UNAUTHENTICATED", requestId));
    if (!roles.includes(actor.role)) return fail(apiErrorResponse("FORBIDDEN", requestId));
    const caseId = caseIdSchema.safeParse(rawId);
    if (!caseId.success) return fail(apiErrorResponse("NOT_FOUND", requestId));

    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return fail(apiErrorResponse("PAYLOAD_TOO_LARGE", requestId));
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(
        apiErrorResponse("VALIDATION_FAILED", requestId, { form: "The body must be valid JSON." }),
      );
    }
    return {
      ok: true,
      requestId,
      logger: deps.getLogger().child({ requestId, route }),
      caseId: caseId.data,
      body,
    };
  }

  function failure(error: unknown, requestId: string, logger: Logger): Response {
    if (error instanceof EvidenceError || error instanceof DecisionError) {
      if (error.code === "SERVICE_UNAVAILABLE") logger.error("repair.request_failed", { error });
      return apiErrorResponse(error.code, requestId);
    }
    logger.error("repair.request_failed", { error });
    return apiErrorResponse("SERVICE_UNAVAILABLE", requestId);
  }

  return {
    /** POST /api/cases/[id]/repair-evidence: reserve a before or after photo (staff only). */
    async requestUpload(request: Request, rawId: string): Promise<Response> {
      const guarded = await guard(request, "POST /api/cases/[id]/repair-evidence", rawId, [
        "department",
        "admin",
      ]);
      if (!guarded.ok) return guarded.response;
      const input = repairUploadRequestSchema.safeParse(guarded.body);
      if (!input.success) {
        return apiErrorResponse(
          "VALIDATION_FAILED",
          guarded.requestId,
          firstIssuePerField(input.error.issues),
        );
      }
      try {
        const slot = await requestRepairUpload(
          await deps.getClient(),
          guarded.logger,
          guarded.caseId,
          input.data,
        );
        return apiJsonResponse(slot, guarded.requestId, 201);
      } catch (error) {
        return failure(error, guarded.requestId, guarded.logger);
      }
    },

    /**
     * POST /api/cases/[id]/repair-evidence/finalize: check the bytes, store the photo, and for an
     * after photo open the verification and queue the comparison (plan v2 §12).
     */
    async finalize(request: Request, rawId: string): Promise<Response> {
      const guarded = await guard(request, "POST /api/cases/[id]/repair-evidence/finalize", rawId, [
        "department",
        "admin",
      ]);
      if (!guarded.ok) return guarded.response;
      const input = finalizeRequestSchema.safeParse(guarded.body);
      if (!input.success) {
        return apiErrorResponse(
          "VALIDATION_FAILED",
          guarded.requestId,
          firstIssuePerField(input.error.issues),
        );
      }
      try {
        const finalized = await finalizeRepairUpload(
          await deps.getClient(),
          guarded.logger,
          guarded.caseId,
          input.data.attachmentId,
        );
        return apiJsonResponse(finalized, guarded.requestId);
      } catch (error) {
        return failure(error, guarded.requestId, guarded.logger);
      }
    },

    /**
     * POST /api/cases/[id]/verification-decision: a reporter confirms or disputes their own
     * report; an administrator closes or reopens the case (plan v2 §12, F4.04).
     */
    async decide(request: Request, rawId: string): Promise<Response> {
      const guarded = await guard(request, "POST /api/cases/[id]/verification-decision", rawId, [
        "student",
        "admin",
      ]);
      if (!guarded.ok) return guarded.response;
      const input = verificationDecisionSchema.safeParse(guarded.body);
      if (!input.success) {
        return apiErrorResponse(
          "VALIDATION_FAILED",
          guarded.requestId,
          firstIssuePerField(input.error.issues),
        );
      }
      try {
        const caseStatus = await decideVerification(
          await deps.getClient(),
          guarded.caseId,
          input.data,
        );
        guarded.logger.info("repair.decided", {
          reviewId: input.data.reviewId,
          confirm: input.data.confirm,
          caseStatus,
        });
        return apiJsonResponse({ caseId: guarded.caseId, caseStatus }, guarded.requestId);
      } catch (error) {
        return failure(error, guarded.requestId, guarded.logger);
      }
    },
  };
}
