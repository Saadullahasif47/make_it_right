/**
 * Shared vocabulary of the AI job worker (plan v2 §05). Plain TypeScript with no runtime
 * dependency, so the Edge Function (Deno) and the unit tests (Node) use the same code.
 */

export const AI_JOB_TYPES = [
  "visual_analysis",
  "embedding",
  "duplicate_match",
  "coordination",
  "repair_verify",
  "insights_refresh",
] as const;

export type AiJobType = (typeof AI_JOB_TYPES)[number];

export type AiJobStatus = "queued" | "running" | "succeeded" | "retry_wait" | "needs_review";

/** One delivery of a job, as `worker_claim_ai_jobs` hands it out. */
export interface ClaimedJob {
  readonly jobId: string;
  readonly msgId: number;
  readonly jobType: AiJobType;
  readonly targetId: string;
  /** 1 for the first attempt; the database stops at 3. */
  readonly attempt: number;
}

/**
 * A failure with a stable code (`last_error_code`) and a decision on whether trying again
 * could help. Codes never contain personal data.
 */
export class JobError extends Error {
  override readonly name = "JobError";
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
    this.retryable = retryable;
  }
}

export type JobHandler = (job: ClaimedJob, signal: AbortSignal) => Promise<void>;

export type JobHandlers = Readonly<Record<AiJobType, JobHandler>>;
