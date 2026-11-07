/**
 * Queue and worker load test (plan v2 A7.02): 1, 5 and 20 simultaneous students each submit a
 * report and attach a photo through the real HTTP API (report, reserve, signed upload, finalise),
 * then the AI worker is driven as Supabase Cron would drive it until every photo analysis has
 * finished. A recovery wave makes the first worker run crash mid-job, then checks that the
 * queue redelivers it and that no analysis is stored twice.
 *
 * Records, per level: submission p50/p95 (report + photo, end to end), queue p50/p95 (finalise to
 * analysis stored, database clock), completion rate and attempts. Local stack only: the photo
 * analysis uses the Gemini stub, so these numbers measure our pipeline, not Google.
 *
 *   node --env-file=.env.local scripts/queue-load-test.mts --base-url http://localhost:3102
 *   options: --levels 1,5,20  --min-samples 10  --keep
 *
 * --base-url must be a running production build with FEATURE_VISUAL_INSPECTION=true (the
 * `makeitright-features` preview configuration). The local worker must have its drill switch on
 * (AI_WORKER_FAULTS=true in supabase/config.toml) for the recovery wave.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { LOCAL_WORKER_SECRET } from "../supabase/functions/_shared/jobs/worker.ts";

import {
  createTempUser,
  deleteTempUsers,
  isLocalUrl,
  percentile,
  requireEnv,
  serviceClient,
  type TempUser,
} from "./lib/session.mts";

const { values: options } = parseArgs({
  options: {
    "base-url": { type: "string" },
    levels: { type: "string", default: "1,5,20" },
    "min-samples": { type: "string", default: "10" },
    keep: { type: "boolean", default: false },
  },
});

const baseUrl = (options["base-url"] ?? "").replace(/\/+$/, "");
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
if (baseUrl === "" || !isLocalUrl(baseUrl) || !isLocalUrl(supabaseUrl)) {
  console.error(
    "Pass a local --base-url (for example http://localhost:3102); the cloud is never a target.",
  );
  process.exit(1);
}

const levels = options.levels.split(",").map((level) => Number(level.trim()));
const minSamples = Number(options["min-samples"]);
const runId = randomUUID().slice(0, 8);
const admin = serviceClient();
const PHOTO = readFileSync(
  join(process.cwd(), "tests", "fixtures", "evidence", "synthetic-sink.png"),
);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Submission {
  readonly level: number;
  readonly ok: boolean;
  readonly ms: number;
  readonly ticketId?: string;
  readonly attachmentId?: string;
  readonly jobId?: string;
  readonly failedAt?: string;
}

async function post(path: string, cookie: string, body: unknown, key?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie,
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    body: JSON.stringify(body),
  });
}

/** One student's report with one photo, through the same requests the browser makes. */
async function submit(student: TempUser, level: number): Promise<Submission> {
  const started = performance.now();
  const fail = (failedAt: string): Submission => ({
    level,
    ok: false,
    ms: performance.now() - started,
    failedAt,
  });
  try {
    const created = await post(
      "/api/complaints",
      student.cookie,
      {
        title: "Queue load test sink",
        description: "A fictional report from the A7 queue load test. Please ignore it.",
        building: "Load Block",
        room: String(level),
      },
      randomUUID(),
    );
    if (!created.ok) return fail(`report ${String(created.status)}`);
    const { id } = (await created.json()) as { id: string };

    const reserved = await post(`/api/complaints/${id}/photos`, student.cookie, {
      mimeType: "image/png",
      byteSize: PHOTO.byteLength,
    });
    if (!reserved.ok) return fail(`reserve ${String(reserved.status)}`);
    const slot = (await reserved.json()) as { attachmentId: string; uploadUrl: string };

    const stored = await fetch(slot.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png", "x-upsert": "false" },
      body: PHOTO,
    });
    if (!stored.ok) return fail(`upload ${String(stored.status)}`);

    const finalized = await post(`/api/complaints/${id}/photos/finalize`, student.cookie, {
      attachmentId: slot.attachmentId,
    });
    if (!finalized.ok) return fail(`finalize ${String(finalized.status)}`);
    const { jobId } = (await finalized.json()) as { jobId: string };
    return {
      level,
      ok: true,
      ms: performance.now() - started,
      ticketId: id,
      attachmentId: slot.attachmentId,
      jobId,
    };
  } catch {
    return fail("network");
  }
}

/** One worker run; returns how many jobs it handled. The crash drill answers 500 by design. */
async function runWorker(headers: Record<string, string> = {}, expected = 200): Promise<number> {
  const response = await fetch(`${supabaseUrl}/functions/v1/makeitright-ai-worker`, {
    method: "POST",
    headers: { "x-worker-secret": LOCAL_WORKER_SECRET, ...headers },
  });
  if (response.status !== expected) {
    throw new Error(`worker answered ${String(response.status)}`);
  }
  const body = (await response.json()) as { processed?: number };
  return body.processed ?? 0;
}

/** Empties whatever is visible in the queue, so a drill claims this run's job. */
async function drainQueue(): Promise<void> {
  for (let run = 0; run < 30; run += 1) {
    if ((await runWorker()) === 0) return;
  }
}

interface JobRow {
  readonly id: string;
  readonly status: string;
  readonly attempts: number;
  readonly created_at: string;
  readonly finished_at: string | null;
}

async function jobs(ids: readonly string[]): Promise<JobRow[]> {
  const { data, error } = await admin
    .from("ai_jobs")
    .select("id, status, attempts, created_at, finished_at")
    .in("id", [...ids]);
  if (error !== null) throw new Error(error.message);
  return data;
}

const TERMINAL = new Set(["succeeded", "needs_review"]);

/** Calls the worker (as Cron would, but without waiting a minute) until every job is done. */
async function drain(ids: readonly string[], timeoutMs = 180_000): Promise<JobRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await jobs(ids);
    if (rows.every((row) => TERMINAL.has(row.status)) || Date.now() > deadline) return rows;
    await runWorker();
  }
}

const queueMs = (row: JobRow) =>
  row.finished_at === null ? Number.NaN : Date.parse(row.finished_at) - Date.parse(row.created_at);

/** A Gemini stub for the worker's photo analysis (the same one the tests use). */
async function ensureStub(): Promise<ChildProcess | undefined> {
  const healthy = () =>
    fetch("http://127.0.0.1:3199/health", { signal: AbortSignal.timeout(1_000) })
      .then((r) => r.ok)
      .catch(() => false);
  if (await healthy()) return undefined;
  const child = spawn(process.execPath, ["tests/support/gemini-stub.mts", "3199", "127.0.0.1"], {
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await healthy()) return child;
    await pause(200);
  }
  child.kill();
  throw new Error("the Gemini stub did not start");
}

async function main() {
  console.log(`queue load test ${runId}: ${baseUrl}, levels ${levels.join("/")}`);
  const stub = await ensureStub();
  const studentCount = Math.max(...levels, 5);
  const students = await Promise.all(
    Array.from({ length: studentCount }, (_, index) =>
      createTempUser(`queue-${runId}-${String(index)}`, "student"),
    ),
  );
  const results: Record<string, unknown>[] = [];
  let rotation = 0;
  const batch = (size: number) =>
    Array.from({ length: size }, () => students[rotation++ % students.length]).filter(
      (student): student is TempUser => student !== undefined,
    );

  try {
    await fetch(`${baseUrl}/api/health`);
    for (const level of levels) {
      const waves = Math.max(1, Math.ceil(minSamples / level));
      const submissions: Submission[] = [];
      const started = performance.now();
      for (let wave = 0; wave < waves; wave += 1) {
        submissions.push(
          ...(await Promise.all(batch(level).map((student) => submit(student, level)))),
        );
        await pause(300);
      }
      const submitWallMs = performance.now() - started;
      const jobIds = submissions.flatMap((entry) =>
        entry.jobId === undefined ? [] : [entry.jobId],
      );
      const drainStarted = performance.now();
      const rows = await drain(jobIds);
      const drainWallMs = performance.now() - drainStarted;
      const done = rows.filter((row) => row.status === "succeeded");
      const okMs = submissions.filter((entry) => entry.ok).map((entry) => entry.ms);
      const queued = done.map(queueMs).filter((ms) => Number.isFinite(ms));
      results.push({
        level,
        samples: submissions.length,
        submitted: submissions.filter((entry) => entry.ok).length,
        failures: submissions.filter((entry) => !entry.ok).map((entry) => entry.failedAt),
        submit_p50_ms: Math.round(percentile(okMs, 50)),
        submit_p95_ms: Math.round(percentile(okMs, 95)),
        submit_wall_ms: Math.round(submitWallMs),
        jobs: jobIds.length,
        succeeded: done.length,
        completion_rate: jobIds.length === 0 ? 0 : done.length / jobIds.length,
        queue_p50_ms: Math.round(percentile(queued, 50)),
        queue_p95_ms: Math.round(percentile(queued, 95)),
        drain_wall_ms: Math.round(drainWallMs),
        max_attempts: Math.max(0, ...rows.map((row) => row.attempts)),
      });
      console.log(
        `  level ${String(level)}: ${String(done.length)}/${String(jobIds.length)} analysed`,
      );
    }

    // Recovery: the first worker run crashes after claiming a job; the queue redelivers it.
    await drainQueue();
    const recovery = await Promise.all(batch(5).map((student) => submit(student, 5)));
    const recoveryIds = recovery.flatMap((entry) =>
      entry.jobId === undefined ? [] : [entry.jobId],
    );
    // Each crash claims the next visible message, which may be an older job: repeat until one of
    // this wave's jobs is the one held by the "dead" worker.
    let crashed = 0;
    for (let attempt = 0; attempt < 10 && crashed === 0; attempt += 1) {
      await runWorker({ "x-worker-simulate": "crash", "x-worker-visibility": "2" }, 500);
      crashed = (await jobs(recoveryIds)).filter((row) => row.status === "running").length;
    }
    await pause(2_500);
    const recovered = await drain(recoveryIds);
    const attachments = recovery.flatMap((entry) =>
      entry.attachmentId === undefined ? [] : [entry.attachmentId],
    );
    const { data: analyses } = await admin
      .from("visual_analyses")
      .select("attachment_id")
      .in("attachment_id", attachments);
    const perPhoto = new Map<string, number>();
    for (const row of analyses ?? [])
      perPhoto.set(row.attachment_id, (perPhoto.get(row.attachment_id) ?? 0) + 1);
    const recoveryResult = {
      jobs: recoveryIds.length,
      left_running_by_crash: crashed,
      succeeded: recovered.filter((row) => row.status === "succeeded").length,
      max_attempts: Math.max(0, ...recovered.map((row) => row.attempts)),
      duplicate_analyses: [...perPhoto.values()].filter((count) => count > 1).length,
      photos_without_analysis: attachments.length - perPhoto.size,
    };
    console.log(`  recovery: ${JSON.stringify(recoveryResult)}`);

    const report = {
      run: runId,
      date: new Date().toISOString(),
      target: baseUrl,
      note: "Local stack, production build, Gemini stub for photo analysis; the worker is called back to back instead of once a minute.",
      levels: results,
      recovery: recoveryResult,
    };
    mkdirSync("docs/evidence/a7", { recursive: true });
    writeFileSync("docs/evidence/a7/queue-load-local.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log("  wrote docs/evidence/a7/queue-load-local.json");
  } finally {
    if (!options.keep) {
      await deleteTempUsers(students.map((student) => student.id));
      console.log("  cleaned up temporary students, their reports and photos");
    }
    stub?.kill();
  }
}

await main();
