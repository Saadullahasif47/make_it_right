/**
 * Photo evidence and the AI job pipeline through the real local stack: Storage with its
 * policies, the Data API and the makeitright-ai-worker Edge Function (plan v2 A1.01-A1.04).
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_WORKER_SECRET } from "../../supabase/functions/_shared/jobs/worker";

import {
  adminClient,
  anonClient,
  createTestUser,
  deleteUsers,
  supabaseUrl,
  type TestUser,
} from "./support/supabase";

const BUCKET = "complaint-evidence";
/** The smallest valid-looking PNG header; the bucket and SQL only check size and type. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const created: string[] = [];
let student: TestUser;
let otherStudent: TestUser;
let admin: TestUser;

beforeAll(async () => {
  [student, otherStudent, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("admin"),
  ]);
  created.push(student.id, otherStudent.id, admin.id);
});

afterAll(async () => {
  await deleteUsers(created);
});

async function newTicket(): Promise<string> {
  const { data, error } = await student.client
    .rpc("create_ticket", {
      p_title: "Evidence integration ticket",
      p_description: "A ticket that receives a photo in the integration tests.",
      p_building: "Block E",
      p_room: "",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  return data.id;
}

interface Reserved {
  readonly attachmentId: string;
  readonly path: string;
}

async function reserve(ticketId: string, bytes = PNG.byteLength): Promise<Reserved> {
  const { data, error } = await student.client
    .rpc("request_evidence_upload", {
      p_complaint_id: ticketId,
      p_mime_type: "image/png",
      p_byte_size: bytes,
    })
    .single();
  if (error !== null) throw new Error(error.message);
  return { attachmentId: data.attachment_id, path: data.object_path };
}

async function uploadSigned(user: TestUser, path: string, bytes: Uint8Array) {
  const signed = await user.client.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error !== null) return { error: signed.error };
  return user.client.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, signed.data.token, bytes, { contentType: "image/png" });
}

async function finalize(reserved: Reserved): Promise<string> {
  const { data, error } = await student.client
    .rpc("finalize_evidence_upload", {
      p_attachment_id: reserved.attachmentId,
      p_sha256: createHash("sha256").update(PNG).digest("hex"),
      p_byte_size: PNG.byteLength,
      p_mime_type: "image/png",
    })
    .single();
  if (error !== null) throw new Error(error.message);
  return data.job_id;
}

/** Reserve, upload and finalise one photo; returns its queued job. */
async function photoJob(): Promise<{ readonly jobId: string; readonly reserved: Reserved }> {
  const reserved = await reserve(await newTicket());
  const upload = await uploadSigned(student, reserved.path, PNG);
  if (upload.error !== null) throw new Error(upload.error.message);
  return { jobId: await finalize(reserved), reserved };
}

const workerUrl = (): string => `${supabaseUrl()}/functions/v1/makeitright-ai-worker`;

async function callWorker(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(workerUrl(), {
    method: "POST",
    headers: {
      "x-worker-secret": LOCAL_WORKER_SECRET,
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}

async function jobRow(jobId: string) {
  const { data, error } = await adminClient()
    .from("ai_jobs")
    .select("status, attempts, last_error_code, admin_retries")
    .eq("id", jobId)
    .single();
  if (error !== null) throw new Error(error.message);
  return data;
}

describe("private photo storage (A1.01)", () => {
  it("stores a reserved photo that only its reporter and staff can read", async () => {
    const reserved = await reserve(await newTicket());
    const upload = await uploadSigned(student, reserved.path, PNG);
    expect(upload.error).toBeNull();

    const other = await otherStudent.client.storage.from(BUCKET).download(reserved.path);
    expect(other.data).toBeNull();
    const listing = await otherStudent.client.storage.from(BUCKET).list(student.id);
    expect(listing.data ?? []).toEqual([]);
    const anonymous = await anonClient().storage.from(BUCKET).download(reserved.path);
    expect(anonymous.data).toBeNull();
    const publicUrl = anonClient().storage.from(BUCKET).getPublicUrl(reserved.path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);

    // Before it is finalised, only the uploader can read it; afterwards admins can too.
    expect((await admin.client.storage.from(BUCKET).download(reserved.path)).data).toBeNull();
    expect((await student.client.storage.from(BUCKET).download(reserved.path)).data).not.toBeNull();
    await finalize(reserved);
    expect((await admin.client.storage.from(BUCKET).download(reserved.path)).data).not.toBeNull();
    expect(
      (await otherStudent.client.storage.from(BUCKET).download(reserved.path)).data,
    ).toBeNull();
  });

  it("refuses unreserved paths, overwrites, other users and oversized files", async () => {
    const ticketId = await newTicket();
    const stray = await student.client.storage
      .from(BUCKET)
      .upload(`${student.id}/${randomUUID()}.png`, PNG, { contentType: "image/png" });
    expect(stray.error).not.toBeNull();

    const reserved = await reserve(ticketId);
    expect((await uploadSigned(otherStudent, reserved.path, PNG)).error).not.toBeNull();
    expect((await uploadSigned(student, reserved.path, PNG)).error).toBeNull();
    const overwrite = await student.client.storage
      .from(BUCKET)
      .upload(reserved.path, PNG, { contentType: "image/png", upsert: true });
    expect(overwrite.error).not.toBeNull();

    const big = await reserve(ticketId, 2 * 1024 * 1024);
    const tooLarge = await uploadSigned(student, big.path, new Uint8Array(2 * 1024 * 1024 + 1));
    expect(tooLarge.error).not.toBeNull();
  });

  it("refuses to finalise an upload whose object was never stored", async () => {
    const reserved = await reserve(await newTicket());
    const { error } = await student.client.rpc("finalize_evidence_upload", {
      p_attachment_id: reserved.attachmentId,
      p_sha256: "a".repeat(64),
      p_byte_size: PNG.byteLength,
      p_mime_type: "image/png",
    });
    expect(error?.code).toBe("MR404");
  });
});

describe("durable AI jobs (A1.02-A1.04)", () => {
  it("queues the analysis the moment a photo is finalised, without waiting for AI", async () => {
    const { jobId } = await photoJob();
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("is closed to signed-in users and to callers without the worker secret", async () => {
    const { error } = await admin.client.rpc("worker_claim_ai_jobs", { p_batch: 1 });
    expect(error?.code).toBe("42501");
    expect((await fetch(workerUrl(), { method: "POST" })).status).toBe(401);
    expect((await callWorker({ "x-worker-secret": "wrong-secret" })).status).toBe(401);
  });

  it("sends a job type that is not built yet to review in one attempt", async () => {
    const { jobId } = await photoJob();
    expect((await callWorker()).status).toBe(200);
    expect(await jobRow(jobId)).toMatchObject({
      status: "needs_review",
      attempts: 1,
      last_error_code: "HANDLER_UNAVAILABLE",
    });
  });

  it("retries a simulated 429 and stops after three attempts", async () => {
    const { jobId } = await photoJob();
    const response = await callWorker({
      "x-worker-simulate": "rate_limited",
      "x-worker-retry-delay": "0",
    });
    expect(response.status).toBe(200);
    expect(await jobRow(jobId)).toMatchObject({
      status: "needs_review",
      attempts: 3,
      last_error_code: "RATE_LIMITED",
    });
  });

  it("recovers a job whose worker died after claiming it, with no second success", async () => {
    const { jobId } = await photoJob();
    const crash = await callWorker({ "x-worker-simulate": "crash", "x-worker-visibility": "1" });
    expect(crash.status).toBe(500);
    expect(await jobRow(jobId)).toMatchObject({ status: "running", attempts: 1 });

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await callWorker({ "x-worker-simulate": "success" })).status).toBe(200);
    expect(await jobRow(jobId)).toMatchObject({
      status: "succeeded",
      attempts: 2,
      last_error_code: null,
    });

    // Nothing left to deliver: another run does not touch the finished job.
    await callWorker({ "x-worker-simulate": "success" });
    expect(await jobRow(jobId)).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("lets an admin queue a reviewed job again, and nobody else", async () => {
    const { jobId } = await photoJob();
    await callWorker();
    expect((await jobRow(jobId)).status).toBe("needs_review");

    const refused = await student.client.rpc("admin_retry_ai_job", { p_job_id: jobId });
    expect(refused.error?.code).toBe("MR403");
    const retried = await admin.client.rpc("admin_retry_ai_job", { p_job_id: jobId });
    expect(retried.error).toBeNull();
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 0, admin_retries: 1 });
  });
});
