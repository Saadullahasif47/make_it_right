import type { Database } from "@/lib/supabase/database.types";

export type AiJobStatus = Database["public"]["Enums"]["ai_job_status"];
export type AiJobType = Database["public"]["Enums"]["ai_job_type"];

export const JOB_STATUSES = [
  "queued",
  "running",
  "retry_wait",
  "needs_review",
  "succeeded",
] as const satisfies readonly AiJobStatus[];

export const JOB_STATUS_LABELS: Readonly<Record<AiJobStatus, string>> = {
  queued: "Queued",
  running: "Running",
  retry_wait: "Waiting to retry",
  needs_review: "Needs review",
  succeeded: "Done",
};

export const JOB_TYPE_LABELS: Readonly<Record<AiJobType, string>> = {
  visual_analysis: "Photo analysis",
  embedding: "Text embedding",
  duplicate_match: "Duplicate check",
  coordination: "Work-order proposal",
  repair_verify: "Repair check",
  insights_refresh: "Insights refresh",
};

/** Plain explanations of the stable failure codes; unknown codes are shown as they are. */
const ERROR_LABELS: Readonly<Record<string, string>> = {
  RATE_LIMITED: "The AI provider's rate limit was reached.",
  PROVIDER_UNAVAILABLE: "The AI provider was unavailable.",
  TIMEOUT: "The attempt ran out of time.",
  WORKER_TIMEOUT: "The worker stopped before reporting back.",
  ATTEMPTS_EXHAUSTED: "Every allowed attempt was used.",
  HANDLER_FAILED: "The worker hit an unexpected error.",
  HANDLER_UNAVAILABLE: "This kind of job is not switched on yet.",
};

export function errorLabel(code: string | null): string | null {
  if (code === null) return null;
  return ERROR_LABELS[code] ?? code;
}
