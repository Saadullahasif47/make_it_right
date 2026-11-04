import "server-only";

import type { SessionUser } from "@/features/auth/session";
import { isCrossSiteRequest } from "@/features/complaints/api";
import { complaintIdSchema } from "@/features/complaints/schemas";
import { firstIssuePerField } from "@/features/complaints/service";
import { apiErrorResponse, apiJsonResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { EvidenceError } from "./errors";
import { finalizeRequestSchema, uploadRequestSchema } from "./schemas";
import { finalizeUpload, requestUpload } from "./service";

const MAX_BODY_BYTES = 1024;

export interface EvidenceApiDependencies {
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
      readonly complaintId: string;
      readonly body: unknown;
    }
  | { readonly ok: false; readonly response: Response };

export function createEvidenceApi(deps: EvidenceApiDependencies) {
  /**
   * The order matters: a switched-off feature is invisible (404); then the complaints API's
   * checks: no cross-site calls, JSON only, a size cap, students only, then parse.
   */
  async function guard(request: Request, route: string, rawId: string): Promise<Guarded> {
    const requestId = resolveRequestId(request.headers);
    const fail = (response: Response): Guarded => ({ ok: false, response });

    if (!deps.enabled()) {
      return fail(apiErrorResponse("NOT_FOUND", requestId));
    }
    if (isCrossSiteRequest(request)) {
      return fail(apiErrorResponse("FORBIDDEN", requestId));
    }
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return fail(apiErrorResponse("UNSUPPORTED_MEDIA_TYPE", requestId));
    }
    const actor = await deps.getActor();
    if (actor === null) {
      return fail(apiErrorResponse("UNAUTHENTICATED", requestId));
    }
    if (actor.role !== "student") {
      return fail(apiErrorResponse("FORBIDDEN", requestId));
    }
    const complaintId = complaintIdSchema.safeParse(rawId);
    if (!complaintId.success) {
      return fail(apiErrorResponse("NOT_FOUND", requestId));
    }

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
      complaintId: complaintId.data,
      body,
    };
  }

  function failure(error: unknown, requestId: string, logger: Logger): Response {
    if (error instanceof EvidenceError) {
      if (error.code === "SERVICE_UNAVAILABLE") {
        logger.error("evidence.request_failed", { error });
      }
      return apiErrorResponse(error.code, requestId);
    }
    logger.error("evidence.request_failed", { error });
    return apiErrorResponse("SERVICE_UNAVAILABLE", requestId);
  }

  return {
    /** POST /api/complaints/[id]/photos: reserve a photo and get a signed upload URL. */
    async requestUpload(request: Request, rawId: string): Promise<Response> {
      const guarded = await guard(request, "POST /api/complaints/[id]/photos", rawId);
      if (!guarded.ok) return guarded.response;
      const input = uploadRequestSchema.safeParse(guarded.body);
      if (!input.success) {
        return apiErrorResponse(
          "VALIDATION_FAILED",
          guarded.requestId,
          firstIssuePerField(input.error.issues),
        );
      }
      try {
        const slot = await requestUpload(
          await deps.getClient(),
          guarded.logger,
          guarded.complaintId,
          input.data,
        );
        return apiJsonResponse(slot, guarded.requestId, 201);
      } catch (error) {
        return failure(error, guarded.requestId, guarded.logger);
      }
    },

    /** POST /api/complaints/[id]/photos/finalize: check the upload, store it, queue analysis. */
    async finalize(request: Request, rawId: string): Promise<Response> {
      const guarded = await guard(request, "POST /api/complaints/[id]/photos/finalize", rawId);
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
        const finalized = await finalizeUpload(
          await deps.getClient(),
          guarded.logger,
          guarded.complaintId,
          input.data.attachmentId,
        );
        return apiJsonResponse(finalized, guarded.requestId);
      } catch (error) {
        return failure(error, guarded.requestId, guarded.logger);
      }
    },
  };
}
