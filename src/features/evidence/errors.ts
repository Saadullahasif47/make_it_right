import type { ApiErrorCode } from "@/lib/http/api-error";

export type EvidenceFailureCode = Extract<
  ApiErrorCode,
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "RATE_LIMITED"
  | "VALIDATION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "EVIDENCE_REJECTED"
  | "SERVICE_UNAVAILABLE"
>;

export class EvidenceError extends Error {
  override readonly name = "EvidenceError";
  readonly code: EvidenceFailureCode;

  constructor(code: EvidenceFailureCode, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
  }
}

/** SQLSTATE codes raised by the evidence functions (A1 migration) → application codes. */
export function evidenceErrorFromDatabase(error: { readonly code?: string }): EvidenceError {
  switch (error.code) {
    case "42501":
      return new EvidenceError("UNAUTHENTICATED", { cause: error });
    case "MR403":
      return new EvidenceError("FORBIDDEN", { cause: error });
    case "MR404":
      return new EvidenceError("NOT_FOUND", { cause: error });
    case "MR422":
      return new EvidenceError("INVALID_TRANSITION", { cause: error });
    case "MR429":
      return new EvidenceError("RATE_LIMITED", { cause: error });
    case "MR413":
      return new EvidenceError("PAYLOAD_TOO_LARGE", { cause: error });
    case "MR400":
      return new EvidenceError("EVIDENCE_REJECTED", { cause: error });
    case "22023":
    case "23514":
    case "22P02":
      return new EvidenceError("VALIDATION_FAILED", { cause: error });
    case undefined: // network failure: no SQLSTATE at all
    default:
      return new EvidenceError("SERVICE_UNAVAILABLE", { cause: error });
  }
}
