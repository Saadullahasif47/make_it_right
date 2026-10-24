import { describe, expect, it } from "vitest";

import { COMPLAINT_CATEGORIES } from "@/features/complaints/categories";
import { evaluateProposal } from "@/features/agent/policy";
import { TOOL_DECLARATIONS } from "@/features/agent/prompt";
import { screenForSafety } from "@/features/agent/safety";
import {
  PROPOSABLE_PRIORITIES,
  REVIEW_REASONS,
  TOOL_NAMES,
  executeTool,
  type ToolContext,
} from "@/features/agent/tools";

import {
  DEPARTMENTS,
  FABRICATED_DEPARTMENT,
  SNAPSHOT,
  call,
  propose,
} from "../../../support/agent";

const SAFE: ToolContext = {
  snapshot: SNAPSHOT,
  safety: screenForSafety("Corridor lights are off"),
};
const DANGER: ToolContext = { snapshot: SNAPSHOT, safety: screenForSafety("Socket is sparking") };

describe("evaluateProposal (server routing policy)", () => {
  const base = {
    category: "electrical",
    departmentId: DEPARTMENTS.electrical.id,
    priority: "medium",
    reason: "Lights out.",
  } as const;

  it("approves the approved department at low or medium priority", () => {
    expect(evaluateProposal(base, SNAPSHOT, SAFE.safety)).toEqual({
      kind: "approve",
      route: { ...base },
    });
    expect(evaluateProposal({ ...base, priority: "low" }, SNAPSHOT, SAFE.safety).kind).toBe(
      "approve",
    );
  });

  it("asks the model to correct a department that is not the approved route", () => {
    for (const departmentId of [DEPARTMENTS.plumbing.id, FABRICATED_DEPARTMENT]) {
      const verdict = evaluateProposal({ ...base, departmentId }, SNAPSHOT, SAFE.safety);
      expect(verdict).toMatchObject({ kind: "retry", code: "DEPARTMENT_NOT_APPROVED" });
    }
  });

  it("sends categories without an enabled route to a human", () => {
    expect(evaluateProposal({ ...base, category: "furniture" }, SNAPSHOT, SAFE.safety)).toEqual({
      kind: "review",
      code: "NO_APPROVED_ROUTE",
    });
  });

  it("never approves high priority or anything the safety screen flags (BR-08)", () => {
    expect(evaluateProposal({ ...base, priority: "high" }, SNAPSHOT, SAFE.safety)).toEqual({
      kind: "review",
      code: "HIGH_PRIORITY_REVIEW",
    });
    expect(evaluateProposal({ ...base, priority: "low" }, SNAPSHOT, DANGER.safety)).toEqual({
      kind: "review",
      code: "SAFETY_REVIEW",
    });
  });
});

describe("executeTool", () => {
  it("lists active departments by id and name only", () => {
    const outcome = executeTool(call("list_departments"), 1, SAFE);
    expect(outcome).toEqual({
      kind: "continue",
      response: {
        ok: true,
        departments: Object.values(DEPARTMENTS).map(({ id, name }) => ({ id, name })),
      },
      trace: { step: 1, tool: "list_departments", verdict: "ok" },
    });
  });

  it("returns the approved route, or null when a category has none", () => {
    expect(
      executeTool(call("find_category_route", { category: "plumbing" }), 1, SAFE),
    ).toMatchObject({
      kind: "continue",
      response: { ok: true, department: { id: DEPARTMENTS.plumbing.id, name: "Plumbing" } },
    });
    expect(
      executeTool(call("find_category_route", { category: "sanitation" }), 1, SAFE),
    ).toMatchObject({
      kind: "continue",
      response: { ok: true, department: null },
    });
  });

  it.each([
    ["an unknown category", { category: "roofing" }],
    ["an extra argument", { category: "electrical", department: "x" }],
    ["no arguments", {}],
  ])("rejects find_category_route with %s", (_label, args) => {
    expect(executeTool(call("find_category_route", args), 2, SAFE)).toMatchObject({
      kind: "continue",
      response: { ok: false },
      trace: { step: 2, verdict: "rejected", code: "INVALID_ARGUMENTS" },
    });
  });

  it("refuses tools that were never declared, such as closing a ticket", () => {
    for (const name of ["close_ticket", "update_user_role", "run_sql", "send_email"]) {
      expect(executeTool(call(name, { ticket: "x" }), 1, SAFE)).toMatchObject({
        kind: "continue",
        response: { ok: false },
        trace: { verdict: "rejected", code: "UNKNOWN_TOOL" },
      });
    }
  });

  it("accepts a valid proposal as a final route, keeping only enums and ids in the trace", () => {
    const outcome = executeTool(propose({ reason: "Lights out. Call 0300 1234567." }), 2, SAFE);
    expect(outcome).toEqual({
      kind: "final",
      decision: {
        kind: "route",
        category: "electrical",
        departmentId: DEPARTMENTS.electrical.id,
        priority: "medium",
        reason: "Lights out. Call [phone].",
      },
      trace: {
        step: 2,
        tool: "propose_assignment",
        verdict: "accepted",
        category: "electrical",
        departmentId: DEPARTMENTS.electrical.id,
        priority: "medium",
      },
    });
    expect(JSON.stringify(outcome.trace)).not.toContain("Lights");
  });

  it.each([
    ["a fabricated department id that is not a uuid", { department_id: "electrical-dept" }],
    ["the priority 'urgent'", { priority: "urgent" }],
    ["the priority 'unassessed'", { priority: "unassessed" }],
    ["the category 'unclassified'", { category: "unclassified" }],
    ["a reason that is too short", { reason: "ok" }],
    ["a reason that is too long", { reason: "x".repeat(281) }],
    ["an injected status field", { status: "closed" }],
  ])("rejects a proposal with %s and lets the model correct it", (_label, overrides) => {
    expect(executeTool(propose(overrides), 1, SAFE)).toMatchObject({
      kind: "continue",
      response: { ok: false },
      trace: { verdict: "rejected", code: "INVALID_ARGUMENTS" },
    });
  });

  it("rejects a well-formed proposal for a department outside the approved route", () => {
    expect(executeTool(propose({ department_id: FABRICATED_DEPARTMENT }), 1, SAFE)).toMatchObject({
      kind: "continue",
      response: { ok: false, error: expect.stringContaining("find_category_route") as unknown },
      trace: {
        verdict: "rejected",
        code: "DEPARTMENT_NOT_APPROVED",
        departmentId: FABRICATED_DEPARTMENT,
      },
    });
  });

  it("turns a high-priority or dangerous proposal into a review that keeps the suggestion", () => {
    expect(executeTool(propose({ priority: "high" }), 2, SAFE)).toMatchObject({
      kind: "final",
      decision: {
        kind: "review",
        failureCode: "HIGH_PRIORITY_REVIEW",
        proposal: {
          category: "electrical",
          departmentId: DEPARTMENTS.electrical.id,
          priority: "high",
        },
      },
    });
    expect(executeTool(propose(), 2, DANGER)).toMatchObject({
      kind: "final",
      decision: { kind: "review", failureCode: "SAFETY_REVIEW" },
    });
  });

  it("honours a request for human review, whatever reason it gives", () => {
    expect(executeTool(call("request_human_review", { reason: "ambiguous" }), 1, SAFE)).toEqual({
      kind: "final",
      decision: { kind: "review", failureCode: "MODEL_REQUESTED_REVIEW" },
      trace: { step: 1, tool: "request_human_review", verdict: "review", code: "MODEL_AMBIGUOUS" },
    });
    expect(
      executeTool(call("request_human_review", { reason: "escalate!!" }), 1, SAFE),
    ).toMatchObject({
      trace: { code: "MODEL_OTHER" },
    });
  });
});

describe("tool declarations", () => {
  it("declare exactly the tools the executor knows", () => {
    expect(TOOL_DECLARATIONS.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
  });

  it("use the same enums as the validators, so the two cannot drift", () => {
    const byName = Object.fromEntries(
      TOOL_DECLARATIONS.map((tool) => [tool.name, tool.parameters]),
    );
    expect(byName.propose_assignment).toMatchObject({
      properties: {
        category: { enum: [...COMPLAINT_CATEGORIES] },
        priority: { enum: [...PROPOSABLE_PRIORITIES] },
      },
      additionalProperties: false,
    });
    expect(byName.find_category_route).toMatchObject({
      properties: { category: { enum: [...COMPLAINT_CATEGORIES] } },
    });
    expect(byName.request_human_review).toMatchObject({
      properties: { reason: { enum: [...REVIEW_REASONS] } },
    });
  });
});
