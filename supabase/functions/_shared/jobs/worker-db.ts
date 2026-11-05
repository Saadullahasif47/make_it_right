import { z } from "zod";

import { AI_JOB_TYPES, type ClaimedJob } from "./types.ts";

/** The worker's only access to the database: three service-role functions (see A1 migration). */
export interface WorkerDatabase {
  claim(batch: number, visibilitySeconds: number): Promise<readonly ClaimedJob[]>;
  complete(job: ClaimedJob): Promise<"succeeded">;
  fail(
    job: ClaimedJob,
    code: string,
    retryable: boolean,
    retryDelaySeconds: number,
  ): Promise<"retry_wait" | "needs_review">;
}

/** A database call failed; `sqlState` is the Postgres code when the function raised one. */
export class WorkerDatabaseError extends Error {
  override readonly name = "WorkerDatabaseError";
  readonly sqlState: string | undefined;

  constructor(message: string, sqlState: string | undefined) {
    super(message);
    this.sqlState = sqlState;
  }
}

const claimedRowSchema = z.strictObject({
  job_id: z.uuid(),
  msg_id: z.number().int().positive(),
  job_type: z.enum(AI_JOB_TYPES),
  target_id: z.uuid(),
  attempt: z.number().int().min(1).max(10),
});

const completedSchema = z.literal("succeeded");
const failedSchema = z.enum(["retry_wait", "needs_review"]);
const errorBodySchema = z.object({ code: z.string().optional() }).loose();

export interface RestWorkerDatabaseOptions {
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

export type Rpc = (name: string, args: Readonly<Record<string, unknown>>) => Promise<unknown>;

/** Calls a service-role database function through PostgREST; failures carry the SQLSTATE. */
export function createRestRpc(options: RestWorkerDatabaseOptions): Rpc {
  const endpoint = `${options.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/`;

  return async function rpc(name, args) {
    const response = await options.fetch(endpoint + name, {
      method: "POST",
      headers: {
        apikey: options.serviceKey,
        authorization: `Bearer ${options.serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorBodySchema.safeParse(body);
      throw new WorkerDatabaseError(
        `${name} failed with HTTP ${String(response.status)}`,
        parsed.data?.code,
      );
    }
    return body;
  };
}

/** Calls the worker functions through PostgREST with the service-role key. */
export function createRestWorkerDatabase(options: RestWorkerDatabaseOptions): WorkerDatabase {
  const rpc = createRestRpc(options);

  return {
    async claim(batch, visibilitySeconds) {
      const rows = z.array(claimedRowSchema).parse(
        await rpc("worker_claim_ai_jobs", {
          p_batch: batch,
          p_visibility_seconds: visibilitySeconds,
        }),
      );
      return rows.map((row) => ({
        jobId: row.job_id,
        msgId: row.msg_id,
        jobType: row.job_type,
        targetId: row.target_id,
        attempt: row.attempt,
      }));
    },
    async complete(job) {
      return completedSchema.parse(
        await rpc("worker_complete_ai_job", {
          p_job_id: job.jobId,
          p_msg_id: job.msgId,
          p_attempt: job.attempt,
        }),
      );
    },
    async fail(job, code, retryable, retryDelaySeconds) {
      return failedSchema.parse(
        await rpc("worker_fail_ai_job", {
          p_job_id: job.jobId,
          p_msg_id: job.msgId,
          p_attempt: job.attempt,
          p_error_code: code,
          p_retryable: retryable,
          p_retry_delay_seconds: retryDelaySeconds,
        }),
      );
    },
  };
}
