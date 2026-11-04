import { classifyFailure, retryDelaySeconds } from "./retry.ts";
import { JobError, type ClaimedJob, type JobHandlers } from "./types.ts";
import { WorkerDatabaseError, type WorkerDatabase } from "./worker-db.ts";

export type JobOutcome =
  "succeeded" | "retry_wait" | "needs_review" | "superseded" | "report_failed";

export interface JobReport {
  readonly jobId: string;
  readonly jobType: ClaimedJob["jobType"];
  readonly attempt: number;
  readonly outcome: JobOutcome;
  readonly code?: string;
  readonly durationMs: number;
}

export interface BatchOptions {
  readonly db: WorkerDatabase;
  readonly handlers: JobHandlers;
  /** Most jobs one invocation runs. */
  readonly maxJobs: number;
  /** Time budget for the whole invocation, below the Edge Function's 150 s wall-clock limit. */
  readonly budgetMs: number;
  /** Time limit for one job's handler. */
  readonly jobTimeoutMs: number;
  /**
   * How long a claimed message stays hidden. Must exceed jobTimeoutMs, so a running job is
   * never handed to a second worker; a worker that dies mid-job is retried after it.
   */
  readonly visibilitySeconds: number;
  /** Replaces the backoff, for local drills only. */
  readonly retryDelayOverride?: number | undefined;
  readonly now?: () => number;
  readonly random?: () => number;
}

export const DEFAULT_BATCH = {
  maxJobs: 5,
  budgetMs: 110_000,
  jobTimeoutMs: 45_000,
  visibilitySeconds: 90,
} as const;

/**
 * One worker invocation. Jobs are claimed one at a time, and only while a whole job still fits
 * in the budget, so a claimed job always gets its full time. Each result is reported back; a
 * report refused with MR412 means a newer delivery owns the job, so this result is dropped.
 */
export async function runBatch(options: BatchOptions): Promise<readonly JobReport[]> {
  if (options.visibilitySeconds * 1000 <= options.jobTimeoutMs) {
    throw new RangeError("visibilitySeconds must exceed jobTimeoutMs");
  }
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const reports: JobReport[] = [];

  while (reports.length < options.maxJobs && deadline - now() >= options.jobTimeoutMs) {
    const [job] = await options.db.claim(1, options.visibilitySeconds);
    if (job === undefined) {
      break;
    }
    reports.push(await runOne(options, job, now));
  }
  return reports;
}

async function runOne(
  options: BatchOptions,
  job: ClaimedJob,
  now: () => number,
): Promise<JobReport> {
  const started = now();
  const report = (outcome: JobOutcome, code: string | undefined): JobReport => ({
    jobId: job.jobId,
    jobType: job.jobType,
    attempt: job.attempt,
    outcome,
    ...(code === undefined ? {} : { code }),
    durationMs: now() - started,
  });

  let failure: { readonly code: string; readonly retryable: boolean } | undefined;
  try {
    // The signal asks the handler to stop; the race guarantees the worker moves on even if
    // the handler ignores it.
    const signal = AbortSignal.timeout(options.jobTimeoutMs);
    const timedOut = new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new JobError("TIMEOUT", true));
      });
    });
    // Once the handler has finished, the timer firing later must not become an unhandled rejection.
    timedOut.catch(() => undefined);
    await Promise.race([options.handlers[job.jobType](job, signal), timedOut]);
  } catch (error) {
    failure = classifyFailure(error);
  }

  try {
    if (failure === undefined) {
      return report(await options.db.complete(job), undefined);
    }
    const delay = options.retryDelayOverride ?? retryDelaySeconds(job.attempt, options.random);
    return report(await options.db.fail(job, failure.code, failure.retryable, delay), failure.code);
  } catch (error) {
    if (error instanceof WorkerDatabaseError && error.sqlState === "MR412") {
      return report("superseded", failure?.code);
    }
    // The message reappears after its visibility timeout and the next claim counts this
    // attempt, so nothing is lost; the job is simply not reported as done.
    return report("report_failed", failure?.code);
  }
}
