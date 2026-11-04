import { describe, expect, it } from "vitest";

import { ticketAge } from "@/features/complaints/age";
import { workflowReturnPath } from "@/features/complaints/paths";
import { TRIAGE_STALE_AFTER_MS, reviewReason } from "@/features/complaints/workflow";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

describe("ticketAge", () => {
  it.each([
    [0, "0 min", "0 minutes"],
    [MINUTE, "1 min", "1 minute"],
    [59 * MINUTE, "59 min", "59 minutes"],
    [60 * MINUTE, "1 h", "1 hour"],
    [23 * 60 * MINUTE + 59 * MINUTE, "23 h", "23 hours"],
    [24 * 60 * MINUTE, "1 d", "1 day"],
    [9 * 24 * 60 * MINUTE, "9 d", "9 days"],
  ])("%i ms reads %s / %s", (elapsed, short, long) => {
    expect(ticketAge(ago(elapsed), NOW)).toEqual({ short, long });
  });

  it("never reports a negative age for a clock that runs ahead", () => {
    expect(ticketAge(ago(-5 * MINUTE), NOW).short).toBe("0 min");
  });
});

describe("reviewReason", () => {
  it("says why each waiting ticket is in the queue", () => {
    expect(reviewReason({ status: "needs_review", updatedAt: ago(0) }, NOW)).toBe(
      "AI asked for a person",
    );
    expect(reviewReason({ status: "submitted", updatedAt: ago(0) }, NOW)).toBe("Not routed yet");
    expect(reviewReason({ status: "triaging", updatedAt: ago(0) }, NOW)).toBe("AI is routing it");
    expect(reviewReason({ status: "triaging", updatedAt: ago(TRIAGE_STALE_AFTER_MS) }, NOW)).toBe(
      "AI attempt stalled",
    );
  });
});

describe("workflowReturnPath", () => {
  const id = "00000000-0000-4000-8000-000000000001";

  it("returns staff to the queue panel only when they acted from it", () => {
    expect(workflowReturnPath("department", id, "panel")).toBe(`/department?ticket=${id}`);
    expect(workflowReturnPath("department", id, undefined)).toBe(`/department/${id}`);
  });

  it("ignores any other view value, and the panel for other roles", () => {
    expect(workflowReturnPath("department", id, "https://evil.example")).toBe(`/department/${id}`);
    expect(workflowReturnPath("admin", id, "panel")).toBe(`/admin/complaints/${id}`);
    expect(workflowReturnPath("student", id, "panel")).toBe(`/student/complaints/${id}`);
  });
});
