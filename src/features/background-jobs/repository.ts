import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import type { AiJobStatus, AiJobType } from "./labels";

export interface AiJobRow {
  readonly id: string;
  readonly jobType: AiJobType;
  readonly status: AiJobStatus;
  readonly attempts: number;
  readonly adminRetries: number;
  readonly lastErrorCode: string | null;
  readonly nextRetryAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const JOB_LIST_LIMIT = 50;

/** Recent AI jobs, newest first. RLS limits ai_jobs to administrators. */
export async function listAiJobs(
  client: AppSupabaseClient,
  status: AiJobStatus | undefined,
): Promise<readonly AiJobRow[]> {
  let query = client
    .from("ai_jobs")
    .select(
      "id, job_type, status, attempts, admin_retries, last_error_code, next_retry_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(JOB_LIST_LIMIT);
  if (status !== undefined) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error !== null) {
    throw new Error(`ai_jobs query failed: ${error.code}`);
  }
  return data.map((row) => ({
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    attempts: row.attempts,
    adminRetries: row.admin_retries,
    lastErrorCode: row.last_error_code,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Counts per status for the filter tabs. */
export async function countAiJobsByStatus(
  client: AppSupabaseClient,
): Promise<Readonly<Record<AiJobStatus, number>>> {
  const statuses: readonly AiJobStatus[] = [
    "queued",
    "running",
    "retry_wait",
    "needs_review",
    "succeeded",
  ];
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await client
        .from("ai_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error !== null) {
        throw new Error(`ai_jobs count failed: ${error.code}`);
      }
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<AiJobStatus, number>;
}
