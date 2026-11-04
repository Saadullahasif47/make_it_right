import {
  AI_JOB_TYPES,
  JobError,
  type AiJobType,
  type JobHandler,
  type JobHandlers,
} from "./types.ts";

/**
 * A job type whose feature has not been built yet. It goes straight to admin review with a
 * clear code instead of retrying work that cannot succeed. Each feature phase (A2-A6) replaces
 * its entry.
 */
const unavailable: JobHandler = () => Promise.reject(new JobError("HANDLER_UNAVAILABLE", false));

export function createJobHandlers(
  overrides: Partial<Record<AiJobType, JobHandler>> = {},
): JobHandlers {
  const handlers = {} as Record<AiJobType, JobHandler>;
  for (const type of AI_JOB_TYPES) {
    handlers[type] = overrides[type] ?? unavailable;
  }
  return handlers;
}
