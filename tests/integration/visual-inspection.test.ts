/**
 * AI visual inspection through the real local stack (plan v2 F1, A2.01-A2.02): a finalised photo
 * is analysed by the makeitright-ai-worker Edge Function against the Gemini stub, the result is
 * stored and readable with the ticket, and every failure leaves the report intact.
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
const PHOTO = new Uint8Array(
  readFileSync(join(process.cwd(), "tests", "fixtures", "evidence", "synthetic-sink.png")),
);

const created: string[] = [];
let stopStub: () => void = () => undefined;
let student: TestUser;
let otherStudent: TestUser;
let plumber: TestUser;
let admin: TestUser;

beforeAll(async () => {
  stopStub = await ensureGeminiStub();
  [student, otherStudent, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  created.push(student.id, otherStudent.id, plumber.id, admin.id);
});

afterAll(async () => {
  await deleteUsers(created);
  stopStub();
});

/** A report whose description carries the stub's markers, with one finalised photo. */
async function reportWithPhoto(
  marker = "",
): Promise<{ ticketId: string; attachmentId: string; jobId: string }> {
  const ticket = await student.client
    .rpc("create_ticket", {
      p_title: "Water leaking under the washroom sink",
      p_description: `A puddle keeps forming under the sink cabinet. ${marker}`.trim(),
      p_building: "ENG",
      p_room: "WC-105",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (ticket.error !== null) throw new Error(ticket.error.message);

  const slot = await student.client
    .rpc("request_evidence_upload", {
      p_complaint_id: ticket.data.id,
      p_mime_type: "image/png",
      p_byte_size: PHOTO.byteLength,
    })
    .single();
  if (slot.error !== null) throw new Error(slot.error.message);
  const signed = await student.client.storage
    .from(BUCKET)
    .createSignedUploadUrl(slot.data.object_path);
  if (signed.error !== null) throw new Error(signed.error.message);
  const upload = await student.client.storage
    .from(BUCKET)
    .uploadToSignedUrl(slot.data.object_path, signed.data.token, PHOTO, {
      contentType: "image/png",
    });
  if (upload.error !== null) throw new Error(upload.error.message);

  const finalized = await student.client
    .rpc("finalize_evidence_upload", {
      p_attachment_id: slot.data.attachment_id,
      p_sha256: createHash("sha256").update(PHOTO).digest("hex"),
      p_byte_size: PHOTO.byteLength,
      p_mime_type: "image/png",
    })
    .single();
  if (finalized.error !== null) throw new Error(finalized.error.message);
  return {
    ticketId: ticket.data.id,
    attachmentId: slot.data.attachment_id,
    jobId: finalized.data.job_id,
  };
}

async function runWorker(headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(`${supabaseUrl()}/functions/v1/makeitright-ai-worker`, {
    method: "POST",
    headers: { "x-worker-secret": LOCAL_WORKER_SECRET, ...headers },
  });
  expect(response.status).toBe(200);
}

async function job(jobId: string) {
  const { data } = await adminClient()
    .from("ai_jobs")
    .select("status, attempts, last_error_code")
    .eq("id", jobId)
    .single();
  return data;
}

/** Runs the worker until the job leaves the queue (other queued jobs may be ahead of it). */
async function settle(jobId: string, headers: Record<string, string> = {}) {
  for (let run = 0; run < 6; run += 1) {
    await runWorker(headers);
    const row = await job(jobId);
    if (row !== null && row.status !== "queued" && row.status !== "running") {
      return row;
    }
  }
  return job(jobId);
}

async function analysisOf(attachmentId: string) {
  const { data } = await adminClient()
    .from("visual_analyses")
    .select("*")
    .eq("attachment_id", attachmentId);
  return data ?? [];
}

describe("a photo is analysed in the background (A2.01-A2.02)", () => {
  it("stores a structured, versioned analysis readable with the ticket", async () => {
    const { ticketId, attachmentId, jobId } = await reportWithPhoto();
    expect(await settle(jobId)).toMatchObject({ status: "succeeded", attempts: 1 });

    const [analysis] = await analysisOf(attachmentId);
    expect(analysis).toMatchObject({
      complaint_id: ticketId,
      job_id: jobId,
      prompt_version: "visual-v1",
      model: "gemini-3.1-flash-lite",
      suggested_category: "plumbing",
      image_quality: "usable",
      text_consistency: "consistent",
      needs_human_review: false,
    });
    expect(analysis?.uncertainty_flags).toEqual(["PARTLY_NOT_VISIBLE"]);

    const asReporter = await student.client
      .from("visual_analyses")
      .select("id")
      .eq("attachment_id", attachmentId);
    expect(asReporter.data).toHaveLength(1);
    const asOther = await otherStudent.client
      .from("visual_analyses")
      .select("id")
      .eq("attachment_id", attachmentId);
    expect(asOther.data).toEqual([]);
    const states = await student.client.rpc("photo_analysis_states", { p_complaint_id: ticketId });
    expect(states.data).toEqual([{ attachment_id: attachmentId, job_status: "succeeded" }]);
    const otherStates = await otherStudent.client.rpc("photo_analysis_states", {
      p_complaint_id: ticketId,
    });
    expect(otherStates.error?.code).toBe("MR404");
  });

  it("flags a photo that contradicts the report for a person, keeping both", async () => {
    const { attachmentId, jobId } = await reportWithPhoto("STUB:VISION-MISMATCH");
    expect((await settle(jobId))?.status).toBe("succeeded");
    const [analysis] = await analysisOf(attachmentId);
    expect(analysis?.needs_human_review).toBe(true);
    expect(analysis?.uncertainty_flags).toContain("TEXT_IMAGE_MISMATCH");
  });

  it("sends overconfident wording to a person", async () => {
    const { attachmentId, jobId } = await reportWithPhoto("STUB:VISION-CERTAIN");
    await settle(jobId);
    const [analysis] = await analysisOf(attachmentId);
    expect(analysis?.needs_human_review).toBe(true);
    expect(analysis?.uncertainty_flags).toContain("CERTAINTY_LANGUAGE");
  });

  it("never stores malformed model output; the job waits for review", async () => {
    const { ticketId, attachmentId, jobId } = await reportWithPhoto("STUB:VISION-INVALID");
    expect(await settle(jobId)).toMatchObject({
      status: "needs_review",
      attempts: 1,
      last_error_code: "INVALID_OUTPUT",
    });
    expect(await analysisOf(attachmentId)).toEqual([]);
    const states = await student.client.rpc("photo_analysis_states", { p_complaint_id: ticketId });
    expect(states.data).toEqual([{ attachment_id: attachmentId, job_status: "needs_review" }]);
  });

  it("keeps the ticket workflow working through a provider outage (429)", async () => {
    const { ticketId, attachmentId, jobId } = await reportWithPhoto("STUB:429");
    await runWorker();
    expect(await job(jobId)).toMatchObject({
      status: "retry_wait",
      last_error_code: "RATE_LIMITED",
    });
    expect(await analysisOf(attachmentId)).toEqual([]);

    // Routing and the rest of the lifecycle do not wait for the photo.
    const { data: ticket } = await adminClient()
      .from("complaints")
      .select("version")
      .eq("id", ticketId)
      .single();
    const assigned = await admin.client.rpc("assign_ticket", {
      p_ticket_id: ticketId,
      p_department_id: await departmentId("plumbing"),
      p_category: "plumbing",
      p_priority: "medium",
      p_expected_version: ticket?.version ?? 0,
    });
    expect(assigned.error).toBeNull();
    const visibleToPlumber = await plumber.client
      .from("complaints")
      .select("id")
      .eq("id", ticketId);
    expect(visibleToPlumber.data).toHaveLength(1);
  });
});

describe("the analysis is an audit record (A2.02)", () => {
  it("cannot be written or changed by anyone through the API", async () => {
    const { attachmentId, jobId } = await reportWithPhoto();
    await settle(jobId);
    const [analysis] = await analysisOf(attachmentId);
    const analysisId = analysis?.id ?? "";

    for (const user of [student, admin]) {
      const update = await user.client
        .from("visual_analyses")
        .update({ suggested_category: "electrical" })
        .eq("id", analysisId);
      expect(update.error?.code).toBe("42501");
      const save = await user.client.rpc("worker_save_visual_analysis", {
        p_job_id: jobId,
        p_msg_id: 1,
        p_attempt: 1,
        p_prompt_version: "visual-v1",
        p_model: "forged",
        p_result: {},
      });
      expect(save.error?.code).toBe("42501");
    }
  });

  it("records the reporter's and an admin's responses without changing it", async () => {
    const { attachmentId, jobId } = await reportWithPhoto();
    await settle(jobId);
    const [analysis] = await analysisOf(attachmentId);
    const analysisId = analysis?.id ?? "";

    const confirmed = await student.client.rpc("review_visual_analysis", {
      p_analysis_id: analysisId,
      p_decision: "confirmed",
    });
    expect(confirmed.error).toBeNull();
    const studentCorrection = await student.client.rpc("review_visual_analysis", {
      p_analysis_id: analysisId,
      p_decision: "corrected",
      p_corrected_category: "electrical",
    });
    expect(studentCorrection.error?.code).toBe("MR403");
    const stranger = await otherStudent.client.rpc("review_visual_analysis", {
      p_analysis_id: analysisId,
      p_decision: "confirmed",
    });
    expect(stranger.error?.code).toBe("MR404");
    const adminCorrection = await admin.client.rpc("review_visual_analysis", {
      p_analysis_id: analysisId,
      p_decision: "corrected",
      p_corrected_category: "sanitation",
      p_note: "Standing water from cleaning, not a leak.",
    });
    expect(adminCorrection.error).toBeNull();

    const [after] = await analysisOf(attachmentId);
    expect(after?.suggested_category).toBe("plumbing");
    const { data: reviews } = await student.client
      .from("visual_analysis_reviews")
      .select("decision, reviewer_role, corrected_category")
      .eq("analysis_id", analysisId)
      .order("id");
    expect(reviews).toEqual([
      { decision: "confirmed", reviewer_role: "student", corrected_category: null },
      { decision: "corrected", reviewer_role: "admin", corrected_category: "sanitation" },
    ]);
  });
});
