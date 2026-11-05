/**
 * The AI job worker's logic (supabase/functions/_shared/jobs), run in Node with a scripted
 * database: claiming, time limits, retries, superseded reports and the HTTP contract.
 */
import { describe, expect, it, vi } from "vitest";

import { createJobHandlers } from "../../../../supabase/functions/_shared/jobs/handlers";
import {
  classifyFailure,
  retryDelaySeconds,
} from "../../../../supabase/functions/_shared/jobs/retry";
import { runBatch, type BatchOptions } from "../../../../supabase/functions/_shared/jobs/run-batch";
import { JobError, type ClaimedJob } from "../../../../supabase/functions/_shared/jobs/types";
import {
  LOCAL_WORKER_SECRET,
  handleWorkerRequest,
  readWorkerSettings,
  secretsMatch,
  type WorkerSettings,
} from "../../../../supabase/functions/_shared/jobs/worker";
import {
  WorkerDatabaseError,
  createRestWorkerDatabase,
  type WorkerDatabase,
} from "../../../../supabase/functions/_shared/jobs/worker-db";

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "0b7a6e00-0000-4000-8000-000000000001",
    msgId: 7,
    jobType: "visual_analysis",
    targetId: "0b7a6e00-0000-4000-8000-000000000002",
    attempt: 1,
    ...overrides,
  };
}

/** A database that hands out the given jobs one claim at a time and records every report. */
function scriptedDb(jobs: ClaimedJob[]) {
  const queue = [...jobs];
  const db = {
    claim: vi.fn((batch: number) => Promise.resolve(queue.splice(0, batch))),
    complete: vi.fn((): Promise<"succeeded"> => Promise.resolve("succeeded")),
    fail: vi.fn(
      (
        _job: ClaimedJob,
        _code: string,
        retryable: boolean,
      ): Promise<"retry_wait" | "needs_review"> =>
        Promise.resolve(retryable ? "retry_wait" : "needs_review"),
    ),
  } satisfies WorkerDatabase;
  return db;
}

function options(db: WorkerDatabase, overrides: Partial<BatchOptions> = {}): BatchOptions {
  return {
    db,
    handlers: createJobHandlers({ visual_analysis: () => Promise.resolve() }),
    maxJobs: 5,
    budgetMs: 110_000,
    jobTimeoutMs: 45_000,
    visibilitySeconds: 90,
    ...overrides,
  };
}

describe("retry policy", () => {
  it("backs off exponentially with up to ten seconds of jitter, capped at five minutes", () => {
    expect(retryDelaySeconds(1, () => 0)).toBe(30);
    expect(retryDelaySeconds(2, () => 0)).toBe(60);
    expect(retryDelaySeconds(3, () => 0)).toBe(120);
    expect(retryDelaySeconds(9, () => 0)).toBe(300);
    expect(retryDelaySeconds(1, () => 0.999)).toBe(39);
  });

  it("keeps a handler's own decision and retries anything unexpected", () => {
    expect(classifyFailure(new JobError("INVALID_OUTPUT", false))).toEqual({
      code: "INVALID_OUTPUT",
      retryable: false,
    });
    expect(classifyFailure(new DOMException("late", "TimeoutError"))).toEqual({
      code: "TIMEOUT",
      retryable: true,
    });
    expect(classifyFailure(new Error("boom"))).toEqual({ code: "HANDLER_FAILED", retryable: true });
  });

  it("sends a job type that is not built yet straight to review", async () => {
    const db = scriptedDb([job({ jobType: "embedding" })]);
    const [report] = await runBatch(options(db, { handlers: createJobHandlers() }));
    expect(report).toMatchObject({ outcome: "needs_review", code: "HANDLER_UNAVAILABLE" });
    expect(db.fail).toHaveBeenCalledWith(
      expect.anything(),
      "HANDLER_UNAVAILABLE",
      false,
      expect.any(Number),
    );
  });
});

describe("runBatch", () => {
  it("claims one job at a time and completes each success", async () => {
    const db = scriptedDb([
      job(),
      job({ jobId: "0b7a6e00-0000-4000-8000-000000000003", msgId: 8 }),
    ]);
    const reports = await runBatch(options(db));
    expect(reports.map((report) => report.outcome)).toEqual(["succeeded", "succeeded"]);
    expect(db.claim).toHaveBeenCalledWith(1, 90);
    expect(db.complete).toHaveBeenCalledTimes(2);
  });

  it("stops at the job limit", async () => {
    const db = scriptedDb([job(), job(), job()]);
    expect(await runBatch(options(db, { maxJobs: 2 }))).toHaveLength(2);
  });

  it("claims no job it could not finish inside the time budget", async () => {
    const db = scriptedDb([job()]);
    expect(await runBatch(options(db, { budgetMs: 30_000 }))).toEqual([]);
    expect(db.claim).not.toHaveBeenCalled();
  });

  it("refuses a visibility timeout that a running job could outlive", async () => {
    await expect(runBatch(options(scriptedDb([]), { visibilitySeconds: 45 }))).rejects.toThrow(
      RangeError,
    );
  });

  it("reports a rate limit as retryable with the backoff delay", async () => {
    const db = scriptedDb([job({ attempt: 2 })]);
    const handlers = createJobHandlers({
      visual_analysis: () => Promise.reject(new JobError("RATE_LIMITED", true)),
    });
    const [report] = await runBatch(options(db, { handlers, random: () => 0 }));
    expect(report).toMatchObject({ outcome: "retry_wait", code: "RATE_LIMITED", attempt: 2 });
    expect(db.fail).toHaveBeenCalledWith(expect.anything(), "RATE_LIMITED", true, 60);
  });

  it("times out a handler that never settles, even if it ignores the abort signal", async () => {
    vi.useFakeTimers();
    try {
      const db = scriptedDb([job()]);
      const handlers = createJobHandlers({
        visual_analysis: () => new Promise<void>(() => undefined),
      });
      const running = runBatch(
        options(db, { handlers, jobTimeoutMs: 1_000, visibilitySeconds: 5 }),
      );
      await vi.advanceTimersByTimeAsync(1_100);
      const [report] = await running;
      expect(report).toMatchObject({ outcome: "retry_wait", code: "TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a result the database refuses as superseded (MR412) instead of applying it", async () => {
    const db = scriptedDb([job()]);
    db.complete.mockRejectedValueOnce(new WorkerDatabaseError("stale", "MR412"));
    const [report] = await runBatch(options(db));
    expect(report?.outcome).toBe("superseded");
  });

  it("leaves a job for redelivery when its report cannot be written", async () => {
    const db = scriptedDb([job()]);
    db.complete.mockRejectedValueOnce(new WorkerDatabaseError("down", undefined));
    const [report] = await runBatch(options(db));
    expect(report?.outcome).toBe("report_failed");
  });
});

describe("worker settings", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  const hosted = {
    SUPABASE_URL: "https://abcd.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    AI_WORKER_SECRET: "a-hosted-secret-that-is-long-enough-123",
  };

  it("accepts a hosted configuration and never enables drills there", () => {
    const result = readWorkerSettings(env({ ...hosted, AI_WORKER_FAULTS: "true" }));
    expect(result.ok && result.settings.simulationEnabled).toBe(false);
  });

  it("refuses the committed local secret on a hosted project", () => {
    const result = readWorkerSettings(env({ ...hosted, AI_WORKER_SECRET: LOCAL_WORKER_SECRET }));
    expect(result).toEqual({
      ok: false,
      problem: "AI_WORKER_SECRET is the local development value",
    });
  });

  it("refuses a short or missing secret", () => {
    expect(readWorkerSettings(env({ ...hosted, AI_WORKER_SECRET: "short" })).ok).toBe(false);
    expect(readWorkerSettings(env({ SUPABASE_URL: hosted.SUPABASE_URL })).ok).toBe(false);
  });

  it("allows the local secret and drills on the local stack only", () => {
    const result = readWorkerSettings(
      env({
        SUPABASE_URL: "http://kong:8000",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        AI_WORKER_SECRET: LOCAL_WORKER_SECRET,
        AI_WORKER_FAULTS: "true",
      }),
    );
    expect(result.ok && result.settings.simulationEnabled).toBe(true);
  });

  it("compares secrets exactly", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abd", "abc")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});

describe("handleWorkerRequest", () => {
  const settings: WorkerSettings = {
    supabaseUrl: "http://kong:8000",
    serviceKey: "k",
    secret: "s".repeat(40),
    ai: {
      enabled: false,
      apiKey: undefined,
      visionModel: "m",
      baseUrl: undefined,
      embeddingModel: "e",
    },
    simulationEnabled: false,
  };
  const deps = (db: WorkerDatabase) => ({ db, handlers: createJobHandlers(), log: vi.fn() });
  const request = (headers: Record<string, string>, method = "POST") =>
    new Request("http://worker.test/", { method, headers });

  it("rejects a missing or wrong secret before touching the queue", async () => {
    const db = scriptedDb([job()]);
    expect((await handleWorkerRequest(request({}), settings, deps(db))).status).toBe(401);
    expect(
      (await handleWorkerRequest(request({ "x-worker-secret": "wrong" }), settings, deps(db)))
        .status,
    ).toBe(401);
    expect(db.claim).not.toHaveBeenCalled();
  });

  it("accepts only POST", async () => {
    const response = await handleWorkerRequest(request({}, "GET"), settings, deps(scriptedDb([])));
    expect(response.status).toBe(405);
  });

  it("refuses drill headers where drills are off", async () => {
    const response = await handleWorkerRequest(
      request({ "x-worker-secret": settings.secret, "x-worker-simulate": "success" }),
      settings,
      deps(scriptedDb([job()])),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "DRILLS_DISABLED" });
  });

  it("runs a batch and returns ids and codes only", async () => {
    const response = await handleWorkerRequest(
      request({ "x-worker-secret": settings.secret }),
      settings,
      deps(scriptedDb([job()])),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processed: 1,
      reports: [{ jobId: job().jobId, outcome: "needs_review", code: "HANDLER_UNAVAILABLE" }],
    });
  });

  it("answers 503 when the database is unreachable", async () => {
    const db = scriptedDb([]);
    db.claim.mockRejectedValueOnce(new WorkerDatabaseError("down", undefined));
    const response = await handleWorkerRequest(
      request({ "x-worker-secret": settings.secret }),
      settings,
      deps(db),
    );
    expect(response.status).toBe(503);
  });
});

describe("createRestWorkerDatabase", () => {
  it("calls the RPC with the service key and validates the rows", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json([
          {
            job_id: job().jobId,
            msg_id: 7,
            job_type: "visual_analysis",
            target_id: job().targetId,
            attempt: 1,
          },
        ]),
      ),
    );
    const db = createRestWorkerDatabase({
      supabaseUrl: "http://kong:8000/",
      serviceKey: "service-key",
      fetch: fetchMock,
    });
    expect(await db.claim(1, 90)).toEqual([job()]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://kong:8000/rest/v1/rpc/worker_claim_ai_jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer service-key" }) as unknown,
        body: JSON.stringify({ p_batch: 1, p_visibility_seconds: 90 }),
      }),
    );
  });

  it("refuses a malformed row instead of running it", async () => {
    const db = createRestWorkerDatabase({
      supabaseUrl: "http://kong:8000",
      serviceKey: "k",
      fetch: () => Promise.resolve(Response.json([{ job_id: "nope" }])),
    });
    await expect(db.claim(1, 90)).rejects.toThrow();
  });

  it("surfaces the SQLSTATE of a refused report", async () => {
    const db = createRestWorkerDatabase({
      supabaseUrl: "http://kong:8000",
      serviceKey: "k",
      fetch: () =>
        Promise.resolve(Response.json({ code: "MR412", message: "stale" }, { status: 400 })),
    });
    await expect(db.complete(job())).rejects.toMatchObject({ sqlState: "MR412" });
  });
});
