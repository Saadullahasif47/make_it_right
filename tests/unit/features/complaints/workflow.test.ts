import { describe, expect, it } from "vitest";

import { APP_ROLES } from "@/features/auth/roles";
import {
  assignInputSchema,
  noteInputSchema,
  transitionInputSchema,
} from "@/features/complaints/schemas";
import { TICKET_STATES } from "@/features/complaints/statuses";
import {
  ASSIGNABLE_STATES,
  NOTE_REQUIRED_FOR,
  TRANSITION_LABELS,
  TRANSITION_RULES,
  allowedTargets,
  canAcknowledge,
  canAddNote,
  canAssign,
  canTransition,
} from "@/features/complaints/workflow";

describe("transition rules (plan §6)", () => {
  it("never leave closed and never stay in place", () => {
    for (const rule of TRANSITION_RULES) {
      expect(rule.from).not.toBe("closed");
      expect(rule.from).not.toBe(rule.to);
    }
  });

  it("have no duplicates", () => {
    const keys = TRANSITION_RULES.map((rule) => `${rule.from}>${rule.to}:${rule.role}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("let only the reporter (or an admin) confirm or dispute a resolution (BR-03)", () => {
    expect(canTransition("resolved", "closed", "student")).toBe(true);
    expect(canTransition("resolved", "reopened", "student")).toBe(true);
    expect(canTransition("resolved", "closed", "department")).toBe(false);
    expect(canTransition("resolved", "reopened", "department")).toBe(false);
  });

  it("let only staff (or an admin) do the work (BR-02)", () => {
    expect(canTransition("assigned", "in_progress", "department")).toBe(true);
    expect(canTransition("in_progress", "resolved", "department")).toBe(true);
    expect(canTransition("assigned", "in_progress", "student")).toBe(false);
    expect(canTransition("in_progress", "resolved", "student")).toBe(false);
  });

  it("forbid skipping the work step", () => {
    for (const role of APP_ROLES) {
      expect(canTransition("assigned", "resolved", role)).toBe(false);
      expect(canTransition("submitted", "resolved", role)).toBe(false);
    }
  });

  it("give admins every change that any other role has", () => {
    for (const rule of TRANSITION_RULES) {
      expect(canTransition(rule.from, rule.to, "admin")).toBe(true);
    }
  });

  it("route tickets only through assignment, never through a status change", () => {
    for (const role of APP_ROLES) {
      for (const from of TICKET_STATES) {
        expect(allowedTargets(from, role)).not.toContain("assigned");
      }
    }
  });

  it("label every reachable target", () => {
    for (const rule of TRANSITION_RULES) {
      expect(TRANSITION_LABELS[rule.to]).toBeDefined();
    }
  });
});

describe("other workflow permissions", () => {
  it("acknowledging is for staff, once, while assigned or reopened", () => {
    expect(canAcknowledge({ status: "assigned", acknowledgedAt: null }, "department")).toBe(true);
    expect(
      canAcknowledge({ status: "assigned", acknowledgedAt: "2026-10-23T10:00:00Z" }, "department"),
    ).toBe(false);
    expect(canAcknowledge({ status: "in_progress", acknowledgedAt: null }, "department")).toBe(
      false,
    );
    expect(canAcknowledge({ status: "assigned", acknowledgedAt: null }, "student")).toBe(false);
  });

  it("notes are for staff on any ticket that is not closed", () => {
    expect(canAddNote("in_progress", "department")).toBe(true);
    expect(canAddNote("closed", "admin")).toBe(false);
    expect(canAddNote("in_progress", "student")).toBe(false);
  });

  it("assignment is admin-only and never from resolved or closed", () => {
    expect(canAssign("submitted", "admin")).toBe(true);
    expect(canAssign("submitted", "department")).toBe(false);
    expect(ASSIGNABLE_STATES).not.toContain("resolved");
    expect(ASSIGNABLE_STATES).not.toContain("closed");
  });
});

describe("transitionInputSchema", () => {
  it("accepts a version sent as form text and as a JSON number", () => {
    expect(
      transitionInputSchema.parse({ target: "in_progress", expectedVersion: "3" }).expectedVersion,
    ).toBe(3);
    expect(
      transitionInputSchema.parse({ target: "in_progress", expectedVersion: 3 }).expectedVersion,
    ).toBe(3);
  });

  it.each([0, -1, 1.5, "abc", ""])("rejects the version %j", (expectedVersion) => {
    expect(
      transitionInputSchema.safeParse({ target: "in_progress", expectedVersion }).success,
    ).toBe(false);
  });

  it.each(NOTE_REQUIRED_FOR)("requires an explanation to move to %s", (target) => {
    expect(transitionInputSchema.safeParse({ target, expectedVersion: 1 }).success).toBe(false);
    expect(
      transitionInputSchema.safeParse({ target, expectedVersion: 1, note: "abcd" }).success,
    ).toBe(false);
    expect(
      transitionInputSchema.safeParse({ target, expectedVersion: 1, note: "Fixed it." }).success,
    ).toBe(true);
  });

  it("rejects unknown targets and injected fields", () => {
    expect(transitionInputSchema.safeParse({ target: "deleted", expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(
      transitionInputSchema.safeParse({ target: "in_progress", expectedVersion: 1, version: 99 })
        .success,
    ).toBe(false);
  });
});

describe("assignInputSchema", () => {
  const valid = {
    departmentId: "d0000000-0000-4000-8000-000000000001",
    category: "electrical",
    priority: "high",
    expectedVersion: 1,
  };

  it("accepts a full classification", () => {
    expect(assignInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["an unclassified category", { category: "unclassified" }],
    ["an unassessed priority", { priority: "unassessed" }],
    ["a malformed department", { departmentId: "electrical" }],
  ])("rejects %s", (_label, patch) => {
    expect(assignInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("noteInputSchema", () => {
  it("trims and bounds notes", () => {
    expect(noteInputSchema.parse({ note: "  Parts ordered.  " }).note).toBe("Parts ordered.");
    expect(noteInputSchema.safeParse({ note: "   " }).success).toBe(false);
    expect(noteInputSchema.safeParse({ note: "x".repeat(1001) }).success).toBe(false);
  });
});
