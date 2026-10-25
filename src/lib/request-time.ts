import "server-only";

import { connection } from "next/server";

/**
 * The current time for a request-time decision (for example "has this AI attempt stalled?").
 * `connection()` marks the caller dynamic, so the value is never baked into a prerender.
 */
export async function requestTime(): Promise<number> {
  await connection();
  return Date.now();
}
