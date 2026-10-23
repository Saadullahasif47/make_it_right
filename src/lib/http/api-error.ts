import { REQUEST_ID_HEADER } from "@/lib/logging/request-id";

/**
 * Stable public error catalog (master plan §11). Clients branch on `code`; `message` is
 * safe to show to a user. Internal details never appear in a response.
 */
export const API_ERRORS = {
  VALIDATION_FAILED: { status: 400, message: "Some fields are missing or invalid." },
  UNAUTHENTICATED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You do not have permission to do that." },
  NOT_FOUND: { status: 404, message: "We could not find what you were looking for." },
  STALE_VERSION: { status: 409, message: "This ticket changed. Refresh and try again." },
  INVALID_TRANSITION: {
    status: 409,
    message:
      "This ticket cannot make that change in its current status. Refresh to see where it is now.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message:
      "This submission was already used for a different report. Reload the form and try again.",
  },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request is too large." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Send the request as JSON." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please wait a moment and try again." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong on our side. Please try again." },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "The service is temporarily unavailable. Please try again shortly.",
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ApiErrorCode = keyof typeof API_ERRORS;

/** Field name → user-facing message. Only ever derived from our own validation schemas. */
export type FieldErrors = Readonly<Record<string, string>>;

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly fields?: FieldErrors;
  };
}

/** Responses from route handlers are per-request and must never be cached by a CDN. */
export const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export function apiErrorResponse(
  code: ApiErrorCode,
  requestId: string,
  fields?: FieldErrors,
): Response {
  const { status, message } = API_ERRORS[code];
  const body: ApiErrorBody = {
    error: { code, message, requestId, ...(fields === undefined ? {} : { fields }) },
  };

  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, [REQUEST_ID_HEADER]: requestId },
  });
}

export function apiJsonResponse(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, [REQUEST_ID_HEADER]: requestId },
  });
}
