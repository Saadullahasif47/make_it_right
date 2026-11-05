import { expect } from "@playwright/test";

import { LOCAL_WORKER_SECRET } from "../../../supabase/functions/_shared/jobs/worker";

/**
 * One run of the AI job worker, as Supabase Cron would trigger it in a deployment. Local stack
 * only: the worker accepts this secret nowhere else.
 */
export async function runWorker(): Promise<void> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/makeitright-ai-worker`,
    { method: "POST", headers: { "x-worker-secret": LOCAL_WORKER_SECRET } },
  );
  expect(response.status).toBe(200);
}
