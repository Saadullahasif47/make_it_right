/**
 * The maintenance coordinator through the real local stack (plan v2 F3, A4.01-A4.04): the
 * makeitright-ai-worker runs the bounded tool loop against the Gemini stub, the database applies
 * the approval policy, and a work order is committed once, by policy or by an administrator.
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
let student: TestUser;
let carpenter: TestUser;
let plumber: TestUser;
let admin: TestUser;
let furniture: string;

beforeAll(async () => {
  stopStub = await ensureGeminiStub();
  [student, carpenter, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "furniture"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  created.push(student.id, carpenter.id, plumber.id, admin.id);
  furniture = await departmentId("furniture");
});

afterAll(async () => {
  await deleteUsers(created);
  stopStub();
});

/** A furniture report (the stub routes "chair" to furniture); markers steer the stub. */
async function report(marker = ""): Promise<{ complaintId: string; caseId: string }> {
  const { data, error } = await student.client
    .rpc("create_ticket", {
      p_title: "Broken chair in the reading room",
      p_description: `The chair by the window has a cracked leg and wobbles. ${marker}`.trim(),
      p_building: `Library ${randomUUID().slice(0, 6)}`,
      p_room: "R-2",
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  const { data: link } = await adminClient()
    .from("case_reports")
    .select("case_id")
    .eq("complaint_id", data.id)
    .single();
  if (link === null) throw new Error("no case for the report");
  return { complaintId: data.id, caseId: link.case_id };
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

async function coordinate(caseId: string, as: TestUser = admin): Promise<string> {
  const { data, error } = await as.client.rpc("request_case_coordination", { p_case_id: caseId });
  if (error !== null) throw new Error(`${error.code} ${error.message}`);
  return data;
}

async function runsOf(caseId: string) {
  const { data } = await adminClient()
    .from("coordination_runs")
    .select("id, outcome, reason_code, tool_trace, model, prompt_version, case_version")
    .eq("case_id", caseId)
    .order("created_at");
  return (data ?? []) as {
    id: string;
    outcome: string;
    reason_code: string | null;
    tool_trace: { tool: string; verdict: string; args: Record<string, string> }[];
    model: string;
    prompt_version: string;
    case_version: number;
  }[];
}

async function workOrdersOf(caseId: string) {
  const { data } = await adminClient()
    .from("case_work_orders")
    .select("department_id, status, source, proposal_id")
    .eq("case_id", caseId);
  return data ?? [];
}

async function proposalsOf(caseId: string) {
  const { data } = await adminClient()
    .from("work_order_proposals")
    .select("id, status, priority, policy_reasons, department_id, expected_case_version")
    .eq("case_id", caseId);
  return data ?? [];
}

async function caseRow(caseId: string) {
  const { data } = await adminClient()
    .from("maintenance_cases")
    .select("status, version, assigned_department_id, category, priority")
    .eq("id", caseId)
    .single();
  return data;
}

async function ticket(complaintId: string) {
  const { data } = await adminClient()
    .from("complaints")
    .select("status, assigned_department_id, category, version")
    .eq("id", complaintId)
    .single();
  return data;
}

describe("routine case (F3.03)", () => {
  it("reads through tools, commits one work order by policy and routes the ticket", async () => {
    const { complaintId, caseId } = await report();
    await coordinate(caseId);
    await drain();

    const [run] = await runsOf(caseId);
    expect(run).toMatchObject({
      outcome: "committed",
      reason_code: null,
      prompt_version: "coordinator-v1",
    });
    expect(run?.tool_trace.map((step) => [step.tool, step.verdict])).toEqual([
      ["get_department_capacity", "ok"],
      ["propose_work_order", "proposal"],
    ]);
    expect(await workOrdersOf(caseId)).toEqual([
      expect.objectContaining({
        department_id: furniture,
        status: "active",
        source: "coordinator",
      }),
    ]);
    expect(await caseRow(caseId)).toMatchObject({
      status: "assigned",
      assigned_department_id: furniture,
      category: "furniture",
      priority: "medium",
    });
    expect(await ticket(complaintId)).toMatchObject({
      status: "assigned",
      assigned_department_id: furniture,
      category: "furniture",
    });
    // The case timeline says who made the work order.
    const { data: events } = await adminClient()
      .from("case_events")
      .select("event_type, actor_kind, note")
      .eq("case_id", caseId)
      .eq("event_type", "assigned");
    expect(events).toEqual([
      expect.objectContaining({
        actor_kind: "agent",
        note: expect.stringContaining("AI coordinator (low-risk, approved by policy)") as unknown,
      }),
    ]);
  });

  it("collapses a repeated request onto one job and never makes two work orders", async () => {
    const { caseId } = await report();
    const [firstJob, secondJob] = await Promise.all([coordinate(caseId), coordinate(caseId)]);
    expect(secondJob).toBe(firstJob);
    await drain();
    await drain();
    expect(await runsOf(caseId)).toHaveLength(1);
    expect((await workOrdersOf(caseId)).filter((order) => order.status === "active")).toHaveLength(
      1,
    );

    // A fresh request after the commit proposes the same department: nothing changes.
    await coordinate(caseId);
    await drain();
    const orders = await workOrdersOf(caseId);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("active");
  });
});

describe("approval (F3.04)", () => {
  it("never commits a high-priority proposal until an administrator approves it", async () => {
    const { complaintId, caseId } = await report("STUB:COORD-HIGH");
    await coordinate(caseId);
    await drain();

    expect((await runsOf(caseId))[0]?.outcome).toBe("awaiting_approval");
    const [proposal] = await proposalsOf(caseId);
    expect(proposal).toMatchObject({ status: "pending", priority: "high" });
    expect(proposal?.policy_reasons).toContain("HIGH_PRIORITY");
    expect(await workOrdersOf(caseId)).toEqual([]);
    expect((await ticket(complaintId))?.assigned_department_id).toBeNull();

    // Departments cannot decide proposals.
    const refused = await carpenter.client.rpc("admin_decide_proposal", {
      p_proposal_id: proposal?.id ?? "",
      p_approve: true,
      p_expected_case_version: proposal?.expected_case_version ?? 0,
    });
    expect(refused.error?.code).toBe("MR403");

    const { data: result, error } = await admin.client.rpc("admin_decide_proposal", {
      p_proposal_id: proposal?.id ?? "",
      p_approve: true,
      p_expected_case_version: proposal?.expected_case_version ?? 0,
      p_note: "Checked the photos; it is urgent.",
    });
    expect(error).toBeNull();
    expect(result).toBe("committed");
    expect(await workOrdersOf(caseId)).toEqual([
      expect.objectContaining({
        source: "admin_approved",
        proposal_id: proposal?.id,
        status: "active",
      }),
    ]);
    expect(await ticket(complaintId)).toMatchObject({
      status: "assigned",
      assigned_department_id: furniture,
    });

    // Deciding twice is refused.
    const again = await admin.client.rpc("admin_decide_proposal", {
      p_proposal_id: proposal?.id ?? "",
      p_approve: true,
      p_expected_case_version: proposal?.expected_case_version ?? 0,
    });
    expect(again.error?.code).toBe("MR422");
  });

  it("retires a proposal whose case changed and leaves the manual routing in place", async () => {
    const { complaintId, caseId } = await report("STUB:COORD-HIGH");
    await coordinate(caseId);
    await drain();
    const [proposal] = await proposalsOf(caseId);

    // An administrator routes the ticket by hand meanwhile.
    const before = await ticket(complaintId);
    const plumbing = await departmentId("plumbing");
    const manual = await admin.client.rpc("assign_ticket", {
      p_ticket_id: complaintId,
      p_department_id: plumbing,
      p_category: "plumbing",
      p_priority: "low",
      p_expected_version: before?.version ?? 0,
    });
    expect(manual.error).toBeNull();

    const { data: result } = await admin.client.rpc("admin_decide_proposal", {
      p_proposal_id: proposal?.id ?? "",
      p_approve: true,
      p_expected_case_version: proposal?.expected_case_version ?? 0,
    });
    expect(result).toBe("stale");
    expect((await proposalsOf(caseId))[0]?.status).toBe("stale");
    expect(await workOrdersOf(caseId)).toEqual([
      expect.objectContaining({
        department_id: plumbing,
        source: "ticket_routing",
        status: "active",
      }),
    ]);
  });

  it("supersedes a run when the case changes while it is queued", async () => {
    const { complaintId, caseId } = await report();
    await coordinate(caseId);
    const before = await ticket(complaintId);
    const manual = await admin.client.rpc("assign_ticket", {
      p_ticket_id: complaintId,
      p_department_id: furniture,
      p_category: "furniture",
      p_priority: "low",
      p_expected_version: before?.version ?? 0,
    });
    expect(manual.error).toBeNull();
    await drain();

    expect((await runsOf(caseId))[0]).toMatchObject({
      outcome: "superseded",
      reason_code: "CASE_CHANGED",
    });
    expect(await proposalsOf(caseId)).toEqual([]);
    expect(await workOrdersOf(caseId)).toEqual([
      expect.objectContaining({ source: "ticket_routing", status: "active" }),
    ]);
  });
});

describe("refusals (A4.01, A4.04)", () => {
  it("refuses an invented tool and another case's equipment, and records both", async () => {
    const { caseId } = await report("STUB:COORD-INJECT STUB:COORD-SCOPE");
    await coordinate(caseId);
    await drain();
    const [run] = await runsOf(caseId);
    expect(run?.tool_trace.map((step) => step.verdict)).toEqual([
      "unknown_tool",
      "out_of_scope",
      "ok",
      "proposal",
    ]);
    expect(run?.tool_trace[0]?.tool).toBe("delete_case");
    // The case is routed correctly and nothing else happened: not closed, not deleted.
    expect(await caseRow(caseId)).toMatchObject({
      status: "assigned",
      assigned_department_id: furniture,
    });
  });

  it("explains a wrong department and accepts the corrected proposal", async () => {
    const { caseId } = await report("STUB:COORD-WRONG");
    await coordinate(caseId);
    await drain();
    const [run] = await runsOf(caseId);
    expect(run?.tool_trace.map((step) => step.verdict)).toEqual([
      "policy_rejected",
      "ok",
      "proposal",
    ]);
    expect((await workOrdersOf(caseId))[0]?.department_id).toBe(furniture);
  });

  it("records a request for review and changes nothing", async () => {
    const { caseId } = await report("STUB:COORD-REVIEW");
    await coordinate(caseId);
    await drain();
    expect((await runsOf(caseId))[0]).toMatchObject({
      outcome: "review_requested",
      reason_code: "MODEL_AMBIGUOUS",
    });
    expect(await proposalsOf(caseId)).toEqual([]);
    expect(await caseRow(caseId)).toMatchObject({ status: "open", assigned_department_id: null });
  });

  it("keeps the case routable by hand when the provider is unavailable", async () => {
    const { caseId } = await report("STUB:429");
    const jobId = await coordinate(caseId);
    await drain();
    const { data: job } = await adminClient()
      .from("ai_jobs")
      .select("status, last_error_code")
      .eq("id", jobId)
      .single();
    expect(job).toMatchObject({ status: "retry_wait", last_error_code: "RATE_LIMITED" });
    expect(await runsOf(caseId)).toEqual([]);
    expect(await caseRow(caseId)).toMatchObject({ status: "open" });
  });
});

describe("who may ask (plan §12)", () => {
  it("lets the holding department ask, but not another department or a student", async () => {
    const { caseId } = await report();
    await coordinate(caseId);
    await drain();

    await expect(coordinate(caseId, carpenter)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(coordinate(caseId, plumber)).rejects.toThrow(/MR404/);
    await expect(coordinate(caseId, student)).rejects.toThrow(/MR403/);
    await drain();
  });

  it("shows runs and proposals to administrators only", async () => {
    const { caseId } = await report("STUB:COORD-HIGH");
    await coordinate(caseId);
    await drain();
    for (const user of [student, carpenter]) {
      const runs = await user.client.from("coordination_runs").select("id").eq("case_id", caseId);
      const proposals = await user.client
        .from("work_order_proposals")
        .select("id")
        .eq("case_id", caseId);
      expect(runs.data).toEqual([]);
      expect(proposals.data).toEqual([]);
    }
    const adminRuns = await admin.client
      .from("coordination_runs")
      .select("id")
      .eq("case_id", caseId);
    expect(adminRuns.data).toHaveLength(1);
  });
});
