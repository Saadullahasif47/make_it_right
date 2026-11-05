/**
 * Duplicate detection and shared cases through the real local stack (plan v2 F2, A3.01-A3.03):
 * the makeitright-ai-worker embeds reports against the Gemini stub, ranks candidates, and only an
 * administrator links them; a shared case then leads its reports.
 */
import { randomUUID } from "node:crypto";

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

const created: string[] = [];
let stopStub: () => void = () => undefined;
let first: TestUser;
let second: TestUser;
let stranger: TestUser;
let plumber: TestUser;
let admin: TestUser;

beforeAll(async () => {
  stopStub = await ensureGeminiStub();
  [first, second, stranger, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  created.push(first.id, second.id, stranger.id, plumber.id, admin.id);
});

afterAll(async () => {
  await deleteUsers(created);
  stopStub();
});

/** Every test uses its own building, so cases from other tests are never in scope. */
const building = (): string => `Block ${randomUUID().slice(0, 6)}`;

async function report(
  user: TestUser,
  title: string,
  description: string,
  place: { building: string; room: string },
): Promise<string> {
  const { data, error } = await user.client
    .rpc("create_ticket", {
      p_title: title,
      p_description: description,
      p_building: place.building,
      p_room: place.room,
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  const queued = await user.client.rpc("request_duplicate_check", { p_complaint_id: data.id });
  if (queued.error !== null) throw new Error(queued.error.message);
  return data.id;
}

/** Runs the worker until the queue is empty, as Supabase Cron would over a few minutes. */
async function drain(): Promise<void> {
  for (let run = 0; run < 10; run += 1) {
    const response = await fetch(`${supabaseUrl()}/functions/v1/makeitright-ai-worker`, {
      method: "POST",
      headers: { "x-worker-secret": LOCAL_WORKER_SECRET },
    });
    const body = (await response.json()) as { processed?: number };
    if (body.processed === 0) return;
  }
}

async function candidatesOf(complaintId: string) {
  const { data } = await adminClient()
    .from("match_candidates")
    .select("id, candidate_case_id, decision, similarity, score, same_room, model")
    .eq("complaint_id", complaintId);
  return data ?? [];
}

async function caseOf(complaintId: string) {
  const { data } = await adminClient()
    .from("case_reports")
    .select(
      "case_id, matching_decision_id, maintenance_cases!case_reports_case_id_fkey(id, status, version, merged_into_case_id)",
    )
    .eq("complaint_id", complaintId)
    .single();
  return data;
}

async function ticket(complaintId: string) {
  const { data } = await adminClient()
    .from("complaints")
    .select("status, assigned_department_id, version")
    .eq("id", complaintId)
    .single();
  return data;
}

const LEAK = {
  title: "Water leaking under the washroom sink",
  description: "Water is leaking under the washroom sink and the floor is wet.",
};
// The stub's vectors are a bag of words, so the "same problem" report is worded almost the
// same; how well the real model matches rewordings is measured by pnpm eval:duplicates.
const LEAK_AGAIN = {
  title: "Water leaking under the washroom sink",
  description: "Water is leaking under the washroom sink and the floor is wet again.",
};
const LIGHT = {
  title: "Ceiling light flickering",
  description: "The ceiling light keeps flickering on and off all day.",
};

describe("candidates (A3.01-A3.02)", () => {
  it("embeds each report once with the pinned model and proposes the matching case", async () => {
    const place = { building: building(), room: "WC-1" };
    const original = await report(first, LEAK.title, LEAK.description, place);
    await drain();
    const duplicate = await report(second, LEAK_AGAIN.title, LEAK_AGAIN.description, place);
    await drain();

    const { data: vectors } = await adminClient()
      .from("complaint_embeddings")
      .select("complaint_id, model, dimension")
      .in("complaint_id", [original, duplicate]);
    expect(vectors).toHaveLength(2);
    expect(
      vectors?.every((row) => row.model === "gemini-embedding-2" && row.dimension === 768),
    ).toBe(true);

    const [candidate] = await candidatesOf(duplicate);
    expect(candidate).toMatchObject({
      candidate_case_id: (await caseOf(original))?.case_id,
      decision: "pending",
      same_room: true,
      model: "gemini-embedding-2",
    });
    // Proposed only: both reports still have their own cases.
    expect((await caseOf(duplicate))?.case_id).not.toBe((await caseOf(original))?.case_id);
  });

  it("does not propose an unrelated problem in the same room", async () => {
    const place = { building: building(), room: "WC-2" };
    await report(first, LEAK.title, LEAK.description, place);
    await drain();
    const light = await report(second, LIGHT.title, LIGHT.description, place);
    await drain();
    expect(await candidatesOf(light)).toEqual([]);
  });

  it("keeps candidates and vectors away from students", async () => {
    const asStudent = await second.client.from("match_candidates").select("id");
    expect(asStudent.data).toEqual([]);
    const vectors = await admin.client.from("complaint_embeddings").select("complaint_id");
    expect(vectors.error?.code).toBe("42501");
    const original = await report(first, LEAK.title, LEAK.description, {
      building: building(),
      room: "1",
    });
    const foreign = await stranger.client.rpc("request_duplicate_check", {
      p_complaint_id: original,
    });
    expect(foreign.error?.code).toBe("MR404");
  });

  it("keeps the report and its own case when embedding fails", async () => {
    const failing = await report(first, "Leak in the lab", "STUB:EMBED-REJECT water on the floor", {
      building: building(),
      room: "LAB-1",
    });
    await drain();
    const { data: job } = await adminClient()
      .from("ai_jobs")
      .select("status, last_error_code")
      .eq("dedupe_key", `embedding:${failing}`)
      .single();
    expect(job).toMatchObject({ status: "needs_review", last_error_code: "PROVIDER_REJECTED" });
    expect((await caseOf(failing))?.case_id).toBeDefined();

    // Manual handling still works: an admin routes the report as usual.
    const assigned = await admin.client.rpc("assign_ticket", {
      p_ticket_id: failing,
      p_department_id: await departmentId("plumbing"),
      p_category: "plumbing",
      p_priority: "medium",
      p_expected_version: (await ticket(failing))?.version ?? 0,
    });
    expect(assigned.error).toBeNull();
  });
});

describe("linking (A3.03, F2.04-F2.05)", () => {
  async function pair() {
    const place = { building: building(), room: "WC-3" };
    const original = await report(first, LEAK.title, LEAK.description, place);
    await drain();
    const duplicate = await report(second, LEAK_AGAIN.title, LEAK_AGAIN.description, place);
    await drain();
    const [candidate] = await candidatesOf(duplicate);
    if (candidate === undefined) throw new Error("no candidate was proposed");
    const target = await caseOf(original);
    return { original, duplicate, candidate, target };
  }

  it("rejecting changes nothing, and only an admin decides", async () => {
    const { duplicate, candidate, target } = await pair();
    const version = target?.maintenance_cases.version ?? 0;
    const byStudent = await second.client.rpc("review_match_candidate", {
      p_candidate_id: candidate.id,
      p_decision: "accepted",
      p_expected_case_version: version,
    });
    expect(byStudent.error?.code).toBe("MR403");

    const rejected = await admin.client.rpc("review_match_candidate", {
      p_candidate_id: candidate.id,
      p_decision: "rejected",
      p_expected_case_version: version,
    });
    expect(rejected.error).toBeNull();
    expect((await caseOf(duplicate))?.case_id).not.toBe(target?.case_id);
    expect((await caseOf(duplicate))?.maintenance_cases.status).not.toBe("merged");
    const again = await admin.client.rpc("review_match_candidate", {
      p_candidate_id: candidate.id,
      p_decision: "accepted",
      p_expected_case_version: version,
    });
    expect(again.error?.code).toBe("MR422");
  });

  it("refuses a link against a case that changed since the admin looked", async () => {
    const { candidate, target } = await pair();
    const stale = await admin.client.rpc("review_match_candidate", {
      p_candidate_id: candidate.id,
      p_decision: "accepted",
      p_expected_case_version: (target?.maintenance_cases.version ?? 0) - 1,
    });
    expect(stale.error?.code).toBe("MR412");
  });

  it("links atomically, keeps both reports, and the shared case then leads them", async () => {
    const { original, duplicate, candidate, target } = await pair();
    const oldCase = (await caseOf(duplicate))?.case_id;
    const linked = await admin.client.rpc("review_match_candidate", {
      p_candidate_id: candidate.id,
      p_decision: "accepted",
      p_expected_case_version: target?.maintenance_cases.version ?? 0,
    });
    expect(linked.error).toBeNull();

    expect(await caseOf(duplicate)).toMatchObject({
      case_id: target?.case_id,
      matching_decision_id: candidate.id,
    });
    const { data: merged } = await adminClient()
      .from("maintenance_cases")
      .select("status, merged_into_case_id")
      .eq("id", oldCase ?? "")
      .single();
    expect(merged).toEqual({ status: "merged", merged_into_case_id: target?.case_id });
    // Each reporter still has exactly their own report, with its history.
    expect(
      (await second.client.from("complaints").select("id").eq("id", duplicate)).data,
    ).toHaveLength(1);
    expect((await second.client.from("complaints").select("id").eq("id", original)).data).toEqual(
      [],
    );
    const { data: events } = await second.client
      .from("ticket_events")
      .select("event_type")
      .eq("complaint_id", duplicate)
      .order("id");
    expect(events?.map((event) => event.event_type)).toEqual(["created", "case_linked"]);

    // Routing one report routes the case and the other report.
    const plumbing = await departmentId("plumbing");
    const assigned = await admin.client.rpc("assign_ticket", {
      p_ticket_id: original,
      p_department_id: plumbing,
      p_category: "plumbing",
      p_priority: "medium",
      p_expected_version: (await ticket(original))?.version ?? 0,
    });
    expect(assigned.error).toBeNull();
    expect(await ticket(duplicate)).toMatchObject({
      status: "assigned",
      assigned_department_id: plumbing,
    });

    // Work on the second report moves the first one too.
    const started = await plumber.client.rpc("transition_ticket", {
      p_ticket_id: duplicate,
      p_target: "in_progress",
      p_expected_version: (await ticket(duplicate))?.version ?? 0,
    });
    expect(started.error).toBeNull();
    expect((await ticket(original))?.status).toBe("in_progress");
    const resolved = await plumber.client.rpc("transition_ticket", {
      p_ticket_id: original,
      p_target: "resolved",
      p_expected_version: (await ticket(original))?.version ?? 0,
      p_note: "Replaced the trap seal.",
    });
    expect(resolved.error).toBeNull();
    expect((await ticket(duplicate))?.status).toBe("resolved");

    // Each reporter confirms their own report; the case closes with the last one.
    await first.client.rpc("transition_ticket", {
      p_ticket_id: original,
      p_target: "closed",
      p_expected_version: (await ticket(original))?.version ?? 0,
    });
    expect((await ticket(duplicate))?.status).toBe("resolved");
    expect((await caseOf(original))?.maintenance_cases.status).toBe("resolved");
    await second.client.rpc("transition_ticket", {
      p_ticket_id: duplicate,
      p_target: "closed",
      p_expected_version: (await ticket(duplicate))?.version ?? 0,
    });
    expect((await caseOf(original))?.maintenance_cases.status).toBe("closed");
  });
});
