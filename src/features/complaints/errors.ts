import type { ApiErrorCode } from "@/lib/http/api-error";

export type ComplaintFailureCode = Extract<
  ApiErrorCode,
  | "UNAUTHENTICATED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "VALIDATION_FAILED"
  | "SERVICE_UNAVAILABLE"
>;

/** A failure the caller can act on, with a stable code and no database detail attached. */
export class ComplaintError extends Error {
  override readonly name = "ComplaintError";
  readonly code: ComplaintFailureCode;

  constructor(code: ComplaintFailureCode, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
  }
}

/**
 * Maps SQLSTATE codes raised by the ticket functions (see the complaints migration) to
 * application codes. Anything unexpected is treated as the service being unavailable, so
 * no internal message ever reaches a user.
 */
export function complaintErrorFromDatabase(error: { readonly code?: string }): ComplaintError {
  switch (error.code) {
    case "42501":
      return new ComplaintError("UNAUTHENTICATED", { cause: error });
    case "MR429":
      return new ComplaintError("RATE_LIMITED", { cause: error });
    case "MR409":
      return new ComplaintError("IDEMPOTENCY_CONFLICT", { cause: error });
    case "23514":
    case "22004":
    case "22P02":
      return new ComplaintError("VALIDATION_FAILED", { cause: error });
    case undefined: // network failure: no SQLSTATE at all
    default:
      return new ComplaintError("SERVICE_UNAVAILABLE", { cause: error });
  }
}
