import "server-only";

import type { AppRole } from "@/features/auth/roles";
import type { SessionUser } from "@/features/auth/session";
import {
  apiErrorResponse,
  apiJsonResponse,
  type ApiErrorCode,
  type FieldErrors,
} from "@/lib/http/api-error";
import type { Logger } from "@/lib/logging/logger";
import { resolveRequestId } from "@/lib/logging/request-id";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import { decodeCursor } from "./cursor";
import { ComplaintError } from "./errors";
import { getComplaint, listComplaints } from "./repository";
import { complaintIdSchema, pageSizeSchema } from "./schemas";
import { submitComplaint, type SubmitDependencies } from "./service";
import { STATUS_FILTERS, isStatusFilter } from "./statuses";
import { assign, changeStatus } from "./workflow-service";

export const MAX_BODY_BYTES = 16 * 1024;
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export interface ComplaintsApiDependencies {
  readonly getActor: () => Promise<SessionUser | null>;
  readonly getClient: () => Promise<AppSupabaseClient>;
  readonly getLogger: () => Logger;
  /** The AI step for a new ticket, or undefined while AI is off (see submitComplaint). */
  readonly getTriage?: (actorId: string, logger: Logger) => SubmitDependencies["triage"];
  /** The admin's bounded AI retry (POST /api/complaints/[id]/retry-ai). */
  readonly retryAi?: (
    actor: SessionUser,
    ticketId: string,
    logger: Logger,
  ) => Promise<ApiResult<unknown>>;
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

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function isJson(request: Request): boolean {
  return /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
}

/** Any use-case result the endpoints turn into a response (WorkflowResult is one). */
type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ApiErrorCode; readonly fields?: FieldErrors };

type GuardedRequest =
  | {
      readonly ok: true;
      readonly requestId: string;
      readonly logger: Logger;
      readonly actor: SessionUser;
      readonly body: unknown;
    }
  | { readonly ok: false; readonly response: Response };

export function createComplaintsApi(deps: ComplaintsApiDependencies) {
  /**
   * The checks every mutating endpoint shares, in order: refuse cross-site calls, require JSON
   * (blocks HTML-form CSRF), cap the size, authenticate (and optionally restrict the role)
   * before reading the body, then parse it.
   */
  async function guardedJson(
    request: Request,
    route: string,
    allowedRoles?: readonly AppRole[],
  ): Promise<GuardedRequest> {
    const requestId = resolveRequestId(request.headers);
    const fail = (response: Response): GuardedRequest => ({ ok: false, response });

    if (isCrossSiteRequest(request)) {
      return fail(apiErrorResponse("FORBIDDEN", requestId));
    }
    if (!isJson(request)) {
      return fail(apiErrorResponse("UNSUPPORTED_MEDIA_TYPE", requestId));
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return fail(apiErrorResponse("PAYLOAD_TOO_LARGE", requestId));
    }

    const actor = await deps.getActor();
    if (actor === null) {
      return fail(apiErrorResponse("UNAUTHENTICATED", requestId));
    }
    if (allowedRoles !== undefined && !allowedRoles.includes(actor.role)) {
      return fail(apiErrorResponse("FORBIDDEN", requestId));
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
      actor,
      body,
    };
  }

  function workflowResponse<T>(result: ApiResult<T>, requestId: string): Response {
    return result.ok
      ? apiJsonResponse(result.value, requestId)
      : apiErrorResponse(result.code, requestId, result.fields);
  }

  return {
    /** POST /api/complaints: idempotent ticket creation for students (plan §11). */
    async create(request: Request): Promise<Response> {
      const guarded = await guardedJson(request, "POST /api/complaints", ["student"]);
      if (!guarded.ok) {
        return guarded.response;
      }
      const { requestId, logger, body, actor } = guarded;

      const result = await submitComplaint(
        { client: await deps.getClient(), logger, triage: deps.getTriage?.(actor.id, logger) },
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

    /** PATCH /api/complaints/[id]/status: start work, resolve, close, reopen (plan §11). */
    async changeStatus(request: Request, ticketId: string): Promise<Response> {
      const guarded = await guardedJson(request, "PATCH /api/complaints/[id]/status");
      if (!guarded.ok) {
        return guarded.response;
      }
      const result = await changeStatus(
        { client: await deps.getClient(), logger: guarded.logger },
        ticketId,
        guarded.body,
      );
      return workflowResponse(result, guarded.requestId);
    },

    /** POST /api/complaints/[id]/retry-ai: an admin's bounded retry of the AI step (plan §11). */
    async retryAi(request: Request, ticketId: string): Promise<Response> {
      const guarded = await guardedJson(request, "POST /api/complaints/[id]/retry-ai", ["admin"]);
      if (!guarded.ok) {
        return guarded.response;
      }
      if (!isEmptyObject(guarded.body)) {
        return apiErrorResponse("VALIDATION_FAILED", guarded.requestId, {
          form: "This endpoint takes an empty JSON object.",
        });
      }
      if (deps.retryAi === undefined) {
        return apiErrorResponse("AI_DISABLED", guarded.requestId);
      }
      return workflowResponse(
        await deps.retryAi(guarded.actor, ticketId, guarded.logger),
        guarded.requestId,
      );
    },

    /** POST /api/complaints/[id]/review: admin classification and (re)assignment. */
    async review(request: Request, ticketId: string): Promise<Response> {
      const guarded = await guardedJson(request, "POST /api/complaints/[id]/review", ["admin"]);
      if (!guarded.ok) {
        return guarded.response;
      }
      const result = await assign(
        { client: await deps.getClient(), logger: guarded.logger },
        ticketId,
        guarded.body,
      );
      return workflowResponse(result, guarded.requestId);
    },
  };
}
