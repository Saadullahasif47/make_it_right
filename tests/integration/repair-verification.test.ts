/**
 * Repair verification through the real local stack (plan v2 F4, A5.01-A5.03): staff upload
 * before and after photos to private Storage, the makeitright-ai-worker compares them against
 * the Gemini stub, and only a person's decision closes or reopens the case.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_WORKER_SECRET } from "../../supabase/functions/_shared/jobs/worker";

import { ensureGeminiStub } from "./support/gemini-stub";
import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  supabaseUrl,
  type TestUser,
} from "./support/supabase";

const BUCKET = "complaint-evidence";
const image = (...path: string[]) => new Uint8Array(readFileSync(join(process.cwd(), ...path)));
const BEFORE = image("tests", "fixtures", "evidence", "synthetic-sink.png");
const AFTER = image("tests", "eval", "visual", "images", "v02-clear-dripping_tap.png");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const created: string[] = [];
let stopStub: () => void = () => undefined;
let reporter: TestUser;
let stranger: TestUser;
let carpenter: TestUser;
let plumber: TestUser;
let admin: TestUser;
let furniture: string;

beforeAll(async () => {
  stopStub = await ensureGeminiStub();
  [reporter, stranger, carpenter, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "furniture"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  created.push(reporter.id, stranger.id, carpenter.id, plumber.id, admin.id);
  furniture = await departmentId("furniture");
});

afterAll(async () => {
  await deleteUsers(created);
  stopStub();
});

async function version(ticketId: string): Promise<number> {
  const { data } = await adminClient()
    .from("complaints")
    .select("version")
    .eq("id", ticketId)
    .single();
  return data?.version ?? 0;
}

async function transition(user: TestUser, ticketId: string, target: "in_progress" | "resolved") {
  const { error } = await user.client.rpc("transition_ticket", {
    p_ticket_id: ticketId,
    p_target: target,
    p_expected_version: await version(ticketId),
    ...(target === "resolved" ? { p_note: "Repaired the fixture." } : {}),
  });
  if (error !== null) throw new Error(`${error.code} ${error.message}`);
}

/** A furniture report routed to the carpenters and being worked on; markers steer the stub. */
async function caseInProgress(marker = ""): Promise<{ ticketId: string; caseId: string }> {
  const { data, error } = await reporter.client
    .rpc("create_ticket", {
      p_title: "Broken chair in the study room",
      p_description: `The chair leg is cracked. ${marker}`.trim(),
      p_building: `Rv ${randomUUID().slice(0, 6)}`,
      p_room: "S-1",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  const assigned = await admin.client.rpc("assign_ticket", {
    p_ticket_id: data.id,
    p_department_id: furniture,
    p_category: "furniture",
    p_priority: "medium",
    p_expected_version: 1,
  });
  if (assigned.error !== null) throw new Error(assigned.error.message);
  await transition(carpenter, data.id, "in_progress");
  const { data: link } = await adminClient()
    .from("case_reports")
    .select("case_id")
    .eq("complaint_id", data.id)
    .single();
  return { ticketId: data.id, caseId: link?.case_id ?? "" };
}

/** The app's three steps: reserve, signed direct upload, finalise. */
async function uploadRepair(
  user: TestUser,
  caseId: string,
  kind: "before" | "after",
  bytes: Uint8Array,
) {
  const slot = await user.client
    .rpc("request_repair_evidence_upload", {
      p_case_id: caseId,
      p_kind: kind,
      p_mime_type: "image/png",
      p_byte_size: bytes.byteLength,
    })
    .single();
  if (slot.error !== null) throw new Error(`${slot.error.code} ${slot.error.message}`);
  const signed = await user.client.storage
    .from(BUCKET)
    .createSignedUploadUrl(slot.data.object_path);
  if (signed.error !== null) throw new Error(signed.error.message);
  const stored = await user.client.storage
    .from(BUCKET)
    .uploadToSignedUrl(slot.data.object_path, signed.data.token, bytes, {
      contentType: "image/png",
    });
  if (stored.error !== null) throw new Error(stored.error.message);
  const finalized = await user.client
    .rpc("finalize_repair_evidence_upload", {
      p_attachment_id: slot.data.attachment_id,
      p_sha256: sha(bytes),
      p_byte_size: bytes.byteLength,
      p_mime_type: "image/png",
    })
    .single();
  if (finalized.error !== null) throw new Error(finalized.error.message);
  return { ...finalized.data, objectPath: slot.data.object_path };
}

/** Runs the worker until the queue is empty, as Supabase Cron would over a few minutes. */
async function drain(): Promise<void> {
  for (let run = 0; run < 10; run += 1) {
    const response = await fetch(`${supabaseUrl()}/functions/v1/makeitright-ai-worker`, {
      method: "POST",
      headers: { "x-worker-secret": LOCAL_WORKER_SECRET },
    });
    // A stopped worker must fail the test, not look like an empty queue.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { processed?: number };
    if (body.processed === 0) return;
  }
}

async function review(reviewId: string) {
  const { data } = await adminClient()
    .from("verification_reviews")
    .select(
      "state, ai_status, model, prompt_version, uncertainty_flags, explanation, before_attachment_id, ai_result",
    )
    .eq("id", reviewId)
    .single();
  return data;
}

async function caseStatus(caseId: string) {
  const { data } = await adminClient()
    .from("maintenance_cases")
    .select("status")
    .eq("id", caseId)
    .single();
  return data?.status;
}

describe("comparison (A5.02)", () => {
  it("compares before and after, stores a suggestion and never moves the case", async () => {
    const { caseId } = await caseInProgress();
    const before = await uploadRepair(carpenter, caseId, "before", BEFORE);
    const after = await uploadRepair(carpenter, caseId, "after", AFTER);
    expect(after.review_id).not.toBeNull();
    await drain();

    expect(await review(after.review_id)).toMatchObject({
      state: "awaiting_decision",
      ai_status: "visually_improved",
      model: "gemini-3.1-flash-lite",
      prompt_version: "verify-v1",
      before_attachment_id: before.attachment_id,
      ai_result: expect.objectContaining({ functional_test_not_performed: true }) as unknown,
    });
    expect(await caseStatus(caseId)).toBe("in_progress");
    const { data: events } = await adminClient()
      .from("case_events")
      .select("event_type, actor_kind")
      .eq("case_id", caseId)
      .in("event_type", ["repair_evidence_added", "verification_result"]);
    expect(events).toEqual(
      expect.arrayContaining([
        { event_type: "repair_evidence_added", actor_kind: "user" },
        { event_type: "verification_result", actor_kind: "agent" },
      ]),
    );
  });

  it("uses the reporter's own photo as the before photo when staff took none", async () => {
    const { ticketId, caseId } = await caseInProgress();
    const slot = await reporter.client
      .rpc("request_evidence_upload", {
        p_complaint_id: ticketId,
        p_mime_type: "image/png",
        p_byte_size: BEFORE.byteLength,
      })
      .single();
    if (slot.error !== null) throw new Error(slot.error.message);
    const signed = await reporter.client.storage
      .from(BUCKET)
      .createSignedUploadUrl(slot.data.object_path);
    await reporter.client.storage
      .from(BUCKET)
      .uploadToSignedUrl(slot.data.object_path, signed.data?.token ?? "", BEFORE, {
        contentType: "image/png",
      });
    await reporter.client.rpc("finalize_evidence_upload", {
      p_attachment_id: slot.data.attachment_id,
      p_sha256: sha(BEFORE),
      p_byte_size: BEFORE.byteLength,
      p_mime_type: "image/png",
    });

    const after = await uploadRepair(carpenter, caseId, "after", AFTER);
    await drain();
    expect(await review(after.review_id)).toMatchObject({
      before_attachment_id: slot.data.attachment_id,
      ai_status: "visually_improved",
    });
  });

  it("answers not comparable without a before photo, and makes no model call", async () => {
    const { caseId } = await caseInProgress();
    const after = await uploadRepair(carpenter, caseId, "after", AFTER);
    await drain();
    expect(await review(after.review_id)).toMatchObject({
      ai_status: "not_comparable",
      model: "none",
      uncertainty_flags: ["MISSING_BEFORE"],
      before_attachment_id: null,
    });
  });

  it.each([
    ["STUB:VERIFY-SCENE", "not_comparable", "DIFFERENT_SCENE"],
    ["STUB:VERIFY-DARK", "inconclusive", "AFTER_DARK"],
    ["STUB:VERIFY-OVERCLAIM", "inconclusive", "OVERCLAIM"],
    ["STUB:VERIFY-UNRESOLVED", "possibly_unresolved", "PARTLY_NOT_VISIBLE"],
  ])("%s is stored as %s (%s)", async (marker, status, flag) => {
    const { caseId } = await caseInProgress(marker);
    await uploadRepair(carpenter, caseId, "before", BEFORE);
    const after = await uploadRepair(carpenter, caseId, "after", AFTER);
    await drain();
    const stored = await review(after.review_id);
    expect(stored?.ai_status).toBe(status);
    expect(stored?.uncertainty_flags).toContain(flag);
    expect(stored?.explanation).not.toMatch(/fully repaired|works perfectly/i);
  });

  it("leaves the verification waiting for a person when the provider is unavailable", async () => {
    const { caseId } = await caseInProgress("STUB:429");
    await uploadRepair(carpenter, caseId, "before", BEFORE);
    const after = await uploadRepair(carpenter, caseId, "after", AFTER);
    await drain();
    const { data: job } = await adminClient()
      .from("ai_jobs")
      .select("status, last_error_code")
      .eq("id", after.job_id)
      .single();
    expect(job).toMatchObject({ status: "retry_wait", last_error_code: "RATE_LIMITED" });
    expect(await review(after.review_id)).toMatchObject({
      state: "pending",
      ai_status: null,
    });
    expect(await caseStatus(caseId)).toBe("in_progress");
  });
});

describe("who may add and see repair photos (A5.01)", () => {
  it("refuses the reporter and other departments, and nobody can overwrite a photo", async () => {
    const { caseId } = await caseInProgress();
    await expect(uploadRepair(reporter, caseId, "after", AFTER)).rejects.toThrow(/MR403/);
    await expect(uploadRepair(plumber, caseId, "before", BEFORE)).rejects.toThrow(/MR404/);

    const after = await uploadRepair(carpenter, caseId, "after", AFTER);
    for (const user of [reporter, carpenter]) {
      const replaced = await user.client.storage
        .from(BUCKET)
        .upload(after.objectPath, BEFORE, { contentType: "image/png", upsert: true });
      expect(replaced.error).not.toBeNull();
    }
    const download = await adminClient().storage.from(BUCKET).download(after.objectPath);
    expect(sha(new Uint8Array(await (download.data ?? new Blob()).arrayBuffer()))).toBe(sha(AFTER));
  });

  it("shows the verification to the case's reporter, never to another student", async () => {
    const { ticketId, caseId } = await caseInProgress();
    await uploadRepair(carpenter, caseId, "after", AFTER);
    const mine = await reporter.client.rpc("repair_verification_view", {
      p_complaint_id: ticketId,
    });
    expect(mine.data).toMatchObject({ case_id: caseId, can_upload: false });
    const theirs = await stranger.client.rpc("repair_verification_view", {
      p_complaint_id: ticketId,
    });
    expect(theirs.data).toBeNull();
    const photos = await stranger.client
      .from("evidence_attachments")
      .select("id")
      .eq("case_id", caseId);
    expect(photos.data).toEqual([]);
  });
});

describe("people decide (A5.03)", () => {
  it("a dispute reopens the work with every photo kept, then a new after photo starts again", async () => {
    const { ticketId, caseId } = await caseInProgress();
    await uploadRepair(carpenter, caseId, "before", BEFORE);
    const first = await uploadRepair(carpenter, caseId, "after", AFTER);
    await drain();
    await transition(carpenter, ticketId, "resolved");

    const decided = await reporter.client.rpc("decide_repair_verification", {
      p_review_id: first.review_id,
      p_confirm: false,
      p_note: "The chair still wobbles.",
    });
    expect(decided.error).toBeNull();
    expect(decided.data).toBe("reopened");
    expect(await review(first.review_id)).toMatchObject({ state: "rework" });
    const { count } = await adminClient()
      .from("repair_evidence")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId);
    expect(count).toBe(2);
    const { data: orders } = await adminClient()
      .from("case_work_orders")
      .select("status")
      .eq("case_id", caseId);
    expect(orders).toEqual([{ status: "active" }]);

    await transition(carpenter, ticketId, "in_progress");
    const second = await uploadRepair(carpenter, caseId, "after", AFTER);
    expect(second.review_id).not.toBe(first.review_id);
    await drain();
    await transition(carpenter, ticketId, "resolved");

    // The usual "Is it fixed?" confirmation settles the verification too.
    const confirmed = await reporter.client.rpc("transition_ticket", {
      p_ticket_id: ticketId,
      p_target: "closed",
      p_expected_version: await version(ticketId),
    });
    expect(confirmed.error).toBeNull();
    expect(await review(second.review_id)).toMatchObject({ state: "confirmed" });
    expect(await caseStatus(caseId)).toBe("closed");
  });
});
