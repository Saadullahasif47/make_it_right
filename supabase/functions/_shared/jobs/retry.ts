import { JobError } from "./types.ts";

/** Exponential backoff with jitter (plan §05): about 30 s, 60 s, then 120 s, never over 300 s. */
export function retryDelaySeconds(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(300, 30 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(random() * 10);
  return Math.min(600, base + jitter);
}

/**
 * Turns anything a handler threw into a stable code. Only a JobError carries its own decision;
 * an unexpected exception is retried, because it may be a transient fault in this worker.
 */
export function classifyFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
} {
  if (error instanceof JobError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return { code: "TIMEOUT", retryable: true };
  }
  return { code: "HANDLER_FAILED", retryable: true };
}
