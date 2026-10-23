import "server-only";

import type { SessionUser } from "@/features/auth/session";
import { apiErrorResponse, apiJsonResponse } from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { decodeCursor } from "./cursor";
import { ComplaintError } from "./errors";
import { getComplaint, listComplaints } from "./repository";
import { complaintIdSchema, pageSizeSchema } from "./schemas";
import { submitComplaint } from "./service";
import { STATUS_FILTERS, isStatusFilter } from "./statuses";

export const MAX_BODY_BYTES = 16 * 1024;
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export interface ComplaintsApiDependencies {
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
}

/**
 * Cookie-authenticated endpoints must not be callable from other sites. Browsers always send
 * Origin (and Sec-Fetch-Site) on cross-site POSTs; non-browser clients may omit both.
 */
export function isCrossSiteRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return true;
  }
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

function isJson(request: Request): boolean {
  return /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
}

export function createComplaintsApi(deps: ComplaintsApiDependencies) {
  return {
    /** POST /api/complaints: idempotent ticket creation for students (plan §11). */
    async create(request: Request): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      const logger = deps.getLogger().child({ requestId, route: "POST /api/complaints" });

      if (isCrossSiteRequest(request)) {
        return apiErrorResponse("FORBIDDEN", requestId);
      }
      if (!isJson(request)) {
        return apiErrorResponse("UNSUPPORTED_MEDIA_TYPE", requestId);
      }
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
        return apiErrorResponse("PAYLOAD_TOO_LARGE", requestId);
      }

      const actor = await deps.getActor();
      if (actor === null) {
        return apiErrorResponse("UNAUTHENTICATED", requestId);
      }
      if (actor.role !== "student") {
        return apiErrorResponse("FORBIDDEN", requestId);
      }

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

      const result = await submitComplaint(
        { client: await deps.getClient(), logger },
        body,
        request.headers.get(IDEMPOTENCY_KEY_HEADER),
      );

      if (!result.ok) {
        return apiErrorResponse(result.code, requestId, result.fields);
      }
      const { ticket } = result;
      return apiJsonResponse(
        {
          id: ticket.id,
          reference: ticket.reference,
          status: ticket.status,
          created: ticket.created,
        },
        requestId,
        ticket.created ? 201 : 200,
      );
    },

    /** GET /api/complaints: the caller's visible tickets, newest first, keyset-paginated. */
    async list(request: Request): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      const actor = await deps.getActor();
      if (actor === null) {
        return apiErrorResponse("UNAUTHENTICATED", requestId);
      }

      const params = new URL(request.url).searchParams;
      const limit = pageSizeSchema.safeParse(params.get("limit") ?? undefined);
      const rawCursor = params.get("cursor");
      const cursor = decodeCursor(rawCursor);
      const status = params.get("status") ?? "all";

      const invalidCursor = rawCursor !== null && cursor === undefined;
      if (!limit.success || invalidCursor || !isStatusFilter(status)) {
        return apiErrorResponse("VALIDATION_FAILED", requestId, {
          ...(limit.success ? {} : { limit: "Use a whole number from 1 to 50." }),
          ...(invalidCursor ? { cursor: "This page link is invalid." } : {}),
          ...(isStatusFilter(status) ? {} : { status: "Unknown status filter." }),
        });
      }

      try {
        const page = await listComplaints(await deps.getClient(), {
          limit: limit.data,
          cursor,
          statuses: STATUS_FILTERS[status].states,
        });
        return apiJsonResponse(page, requestId);
      } catch (error) {
        return apiErrorResponse(
          error instanceof ComplaintError ? error.code : "SERVICE_UNAVAILABLE",
          requestId,
        );
      }
    },

    /** GET /api/complaints/[id]: a ticket and its timeline, or 404 (never 403: no probing). */
    async detail(request: Request, rawId: string): Promise<Response> {
      const requestId = resolveRequestId(request.headers);
      const actor = await deps.getActor();
      if (actor === null) {
        return apiErrorResponse("UNAUTHENTICATED", requestId);
      }
      const id = complaintIdSchema.safeParse(rawId);
      if (!id.success) {
        return apiErrorResponse("NOT_FOUND", requestId);
      }

      try {
        const complaint = await getComplaint(await deps.getClient(), id.data);
        return complaint === null
          ? apiErrorResponse("NOT_FOUND", requestId)
          : apiJsonResponse(complaint, requestId);
      } catch (error) {
        return apiErrorResponse(
          error instanceof ComplaintError ? error.code : "SERVICE_UNAVAILABLE",
          requestId,
        );
      }
    },
  };
}
