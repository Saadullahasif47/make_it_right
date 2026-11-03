import { describe, expect, it } from "vitest";

import { createAdminApi } from "@/features/admin/api";
import { formatHours } from "@/features/admin/components/dashboard";
import { DEFAULT_WINDOW, parseWindow } from "@/features/admin/metrics";
import type { SessionUser } from "@/features/auth/session";
import { createLogger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

const ORIGIN = "https://makeitright.test";

const admin: SessionUser = {
  id: "e0000000-0000-4000-8000-00000000000e",
  email: "admin@makeitright.test",
  displayName: "Admin",
  role: "admin",
  departmentId: null,
};
const student: SessionUser = {
  ...admin,
  id: "a0000000-0000-4000-8000-00000000000a",
  role: "student",
};

/** A complete, valid admin_metrics() payload, as the database returns it. */
function metricsPayload(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-11-03T10:00:00Z",
    window_days: 30,
    totals: { all: 12, open: 5, created_in_window: 9, closed_in_window: 3 },
    status_counts: {
      submitted: 1,
      triaging: 0,
      needs_review: 2,
      assigned: 1,
      in_progress: 1,
      resolved: 2,
      reopened: 0,
      closed: 5,
    },
    routing: { awaiting: 3, needs_review: 2, stalled_triage: 0 },
    aging: {
      under_1_day: 3,
      one_to_3_days: 1,
      three_to_7_days: 1,
      over_7_days: 0,
      oldest_open_hours: 100,
    },
    resolution: { resolved_in_window: 4, median_hours: 26.5 },
    created_per_day: Array.from({ length: 14 }, (_, index) => ({
      day: `2026-10-${String(21 + index).padStart(2, "0")}`,
      count: index % 3,
    })),
    departments: [
      {
        id: "d0000000-0000-4000-8000-000000000001",
        name: "Electrical Maintenance",
        is_active: true,
        open: 2,
        unacknowledged: 1,
        in_progress: 1,
        resolved_in_window: 3,
      },
    ],
    ai: {
      runs: 10,
      routed: 7,
      needs_review: 3,
      superseded: 0,
      running: 0,
      p50_ms: 1100,
      p95_ms: 4100,
      review_reasons: { HIGH_PRIORITY_REVIEW: 2, SAFETY_REVIEW: 1 },
    },
    ...overrides,
  };
}

function clientReturning(result: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const calls: unknown[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
  // Only rpc() is used by the metrics endpoint; the rest of the client is never touched.
  return { client: client as unknown as AppSupabaseClient, calls };
}

function apiWith(actor: SessionUser | null, client: AppSupabaseClient) {
  return createAdminApi({
    getActor: () => Promise.resolve(actor),
    getClient: () => Promise.resolve(client),
    getLogger: () => createLogger({ level: "error", sink: () => undefined }),
  });
}

const get = (query = "") => new Request(`${ORIGIN}/api/admin/metrics${query}`);

describe("parseWindow", () => {
  it.each([
    [undefined, DEFAULT_WINDOW],
    ["", DEFAULT_WINDOW],
    ["7", 7],
    ["30", 30],
    ["90", 90],
    ["14", undefined],
    ["0", undefined],
    ["abc", undefined],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseWindow(raw)).toBe(expected);
  });
});

describe("GET /api/admin/metrics", () => {
  it("requires a signed-in user", async () => {
    const { client } = clientReturning({ data: metricsPayload(), error: null });
    expect((await apiWith(null, client).metrics(get())).status).toBe(401);
  });

  it("is for administrators only, refused before the database is asked", async () => {
    const { client, calls } = clientReturning({ data: metricsPayload(), error: null });
    expect((await apiWith(student, client).metrics(get())).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects an unsupported window", async () => {
    const { client } = clientReturning({ data: metricsPayload(), error: null });
    const response = await apiWith(admin, client).metrics(get("?window=14"));
    expect(response.status).toBe(400);
    expect(
      ((await response.json()) as { error: { fields: { window: string } } }).error.fields.window,
    ).toContain("7, 30, 90");
  });

  it("returns validated, camel-cased metrics for the requested window", async () => {
    const { client, calls } = clientReturning({ data: metricsPayload(), error: null });
    const response = await apiWith(admin, client).metrics(get("?window=7"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual([{ name: "admin_metrics", args: { p_window_days: 7 } }]);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      totals: { all: 12, open: 5, createdInWindow: 9, closedInWindow: 3 },
      routing: { awaiting: 3, needsReview: 2, stalledTriage: 0 },
      resolution: { resolvedInWindow: 4, medianHours: 26.5 },
      ai: { runs: 10, routed: 7, p50Ms: 1100, reviewReasons: { SAFETY_REVIEW: 1 } },
    });
    expect(body.departments).toEqual([
      expect.objectContaining({
        name: "Electrical Maintenance",
        isActive: true,
        unacknowledged: 1,
      }),
    ]);
  });

  it("maps a database refusal to 403", async () => {
    const { client } = clientReturning({
      data: null,
      error: { code: "MR403", message: "only administrators" },
    });
    expect((await apiWith(admin, client).metrics(get())).status).toBe(403);
  });

  it("answers a safe 503 when the database returns something malformed", async () => {
    const { client } = clientReturning({
      data: metricsPayload({ created_per_day: [] }),
      error: null,
    });
    const response = await apiWith(admin, client).metrics(get());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("created_per_day");
  });
});

describe("formatHours", () => {
  it.each([
    [null, "–"],
    [0.25, "15 min"],
    [3.25, "3.3 h"],
    [26.5, "27 h"],
    [100, "4.2 days"],
  ])("formats %j as %j", (hours, expected) => {
    expect(formatHours(hours)).toBe(expected);
  });
});
