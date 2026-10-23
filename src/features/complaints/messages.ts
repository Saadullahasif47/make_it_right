import type { ComplaintFailureCode } from "./errors";

/** What a person sees when a complaint action fails. Plain language, no internal detail. */
export const FAILURE_MESSAGES: Readonly<Record<ComplaintFailureCode, string>> = {
  VALIDATION_FAILED: "Some details need fixing before we can save this.",
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "Your role cannot make this change.",
  NOT_FOUND: "This ticket no longer exists or is no longer assigned to you.",
  STALE_VERSION: "This ticket changed while you were looking at it. Refresh and try again.",
  INVALID_TRANSITION:
    "This ticket cannot make that change in its current status. Refresh to see where it is now.",
  RATE_LIMITED:
    "You have submitted several reports in a short time. Please wait a few minutes and try again.",
  IDEMPOTENCY_CONFLICT:
    "This form was already used for a different report. Reload the page to start a new one.",
  SERVICE_UNAVAILABLE:
    "We could not save this right now. Nothing was lost: please try again in a moment.",
};
