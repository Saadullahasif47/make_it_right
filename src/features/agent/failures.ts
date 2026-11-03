import { ApiError } from "@google/genai";

/**
 * Why a triage attempt ended in human review instead of an automatic route. These codes are
 * stored on agent_runs (admin-only) and logged; they are stable, so never rename one.
 */
export const AGENT_FAILURE_CODES = [
  // The provider could not be used.
  "PROVIDER_NOT_CONFIGURED",
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "ROUTING_DATA_UNAVAILABLE",
  // The model answered, but not usefully.
  "INVALID_OUTPUT",
  "STEP_LIMIT",
  // The server policy decided a human must look (BR-08).
  "POLICY_REJECTED",
  "NO_APPROVED_ROUTE",
  "SAFETY_REVIEW",
  "HIGH_PRIORITY_REVIEW",
  "MODEL_REQUESTED_REVIEW",
] as const;

export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number];

/** Codes the database itself records on a run (agent_finish_run, agent_begin_run). */
export type RunRecordCode = AgentFailureCode | "TICKET_CHANGED" | "ABANDONED";

export const FAILURE_LABELS: Readonly<Record<RunRecordCode, string>> = {
  PROVIDER_NOT_CONFIGURED: "AI is switched on but no API key is configured",
  TIMEOUT: "The AI provider did not answer in time",
  RATE_LIMITED: "The AI provider's rate limit was reached",
  PROVIDER_UNAVAILABLE: "The AI provider was unavailable",
  PROVIDER_REJECTED: "The AI provider refused the request (key or model setting)",
  ROUTING_DATA_UNAVAILABLE: "Routing rules could not be loaded",
  INVALID_OUTPUT: "The model did not call a tool",
  STEP_LIMIT: "The model did not decide within three tool exchanges",
  POLICY_REJECTED: "The database refused the proposed route",
  NO_APPROVED_ROUTE: "This category has no enabled default department",
  SAFETY_REVIEW: "The report mentions a possible safety risk",
  HIGH_PRIORITY_REVIEW: "High priority reports always get a human check",
  MODEL_REQUESTED_REVIEW: "The model asked for a human decision",
  TICKET_CHANGED: "Someone changed the ticket while the AI was working",
  ABANDONED: "The attempt stopped before finishing and was taken over",
};

export function isRunRecordCode(value: string): value is RunRecordCode {
  return Object.hasOwn(FAILURE_LABELS, value);
}

/**
 * Maps whatever the provider call threw to a stable code. An aborted deadline is a timeout
 * whatever the error looks like, because the SDK surfaces aborts in several shapes.
 */
export function classifyProviderError(error: unknown, deadline: AbortSignal): AgentFailureCode {
  if (deadline.aborted) {
    return "TIMEOUT";
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "RATE_LIMITED";
    }
    if (error.status === 408 || error.status >= 500) {
      return "PROVIDER_UNAVAILABLE";
    }
    return "PROVIDER_REJECTED";
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "TIMEOUT";
  }
  return "PROVIDER_UNAVAILABLE";
}
