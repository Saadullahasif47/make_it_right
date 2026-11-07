/**
 * Heatmap and insights logic that runs in the app (plan v2 F5, F6): filter parsing, links that keep
 * the view, the colour steps, alert sentences and the flag-gated navigation.
 */
import { describe, expect, it } from "vitest";

import { navigationFor } from "@/features/auth/navigation";
import { heatLevel, heatmapFiltersSchema, heatmapQuery } from "@/features/heatmap/schemas";
import { RULES, RULE_TEXT, describeAlert, type InsightAlert } from "@/features/insights/schemas";

const LOCATION = "11111111-1111-4111-8111-111111111111";

describe("heatmap filters (F5.04)", () => {
  it("defaults to 30 days, all statuses and demo history included", () => {
    expect(heatmapFiltersSchema.parse({})).toEqual({
      days: 30,
      building: undefined,
      floor: undefined,
      category: undefined,
      department: undefined,
      status: "all",
      synthetic: "include",
      room: undefined,
    });
  });

  it("reads a full query string, including repeated keys", () => {
    expect(
      heatmapFiltersSchema.parse({
        days: ["90", "7"],
        building: "ENG",
        floor: "2",
        category: "it_equipment",
        status: "active",
        synthetic: "exclude",
        room: LOCATION,
      }),
    ).toMatchObject({
      days: 90,
      building: "ENG",
      floor: 2,
      category: "it_equipment",
      status: "active",
      synthetic: "exclude",
      room: LOCATION,
    });
  });

  it("falls back instead of failing on anything malformed", () => {
    expect(
      heatmapFiltersSchema.parse({
        days: "45",
        building: "eng; drop",
        floor: "x",
        category: "unclassified",
        department: "nope",
        status: "everything",
        room: "1",
      }),
    ).toMatchObject({
      days: 30,
      building: undefined,
      floor: undefined,
      category: undefined,
      department: undefined,
      status: "all",
      room: undefined,
    });
  });

  it("builds links that keep the view and only change what is asked", () => {
    const filters = heatmapFiltersSchema.parse({ days: "90", building: "SCI", status: "done" });
    const query = new URLSearchParams(heatmapQuery(filters, { room: LOCATION }));
    expect(Object.fromEntries(query)).toEqual({
      days: "90",
      building: "SCI",
      status: "done",
      room: LOCATION,
    });
    expect(heatmapFiltersSchema.parse(Object.fromEntries(query))).toEqual({
      ...filters,
      room: LOCATION,
    });
  });
});

describe("colour steps", () => {
  it("is empty for no cases and highest for the busiest room", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
  });
});

function alert(overrides: Partial<InsightAlert>): InsightAlert {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    rule_code: "REPEAT_30D",
    level: "warning",
    status: "open",
    window_start: "2026-10-08T00:00:00Z",
    window_end: "2026-11-07T00:00:00Z",
    metric: {},
    first_seen_at: "2026-11-07T00:00:00Z",
    last_seen_at: "2026-11-07T00:00:00Z",
    refresh_count: 1,
    acknowledged_at: null,
    acknowledgement_note: null,
    building_code: "ENG",
    asset: { code: "PRJ-ENG-204", label: "Ceiling projector" },
    location: "Engineering Block, LAB-204",
    cases: [],
    ...overrides,
  };
}

describe("alert wording (F6.04)", () => {
  it("states the numbers behind each rule, from the metric", () => {
    expect(describeAlert(alert({ metric: { cases: 3 } }))).toBe(
      "PRJ-ENG-204 (Ceiling projector) has 3 separate cases in 30 days.",
    );
    expect(describeAlert(alert({ rule_code: "RECENT_REOPEN", metric: { gap_days: 3 } }))).toBe(
      "Reopened 3 days after it was marked resolved.",
    );
    expect(
      describeAlert(
        alert({
          rule_code: "BUILDING_CLUSTER",
          asset: null,
          metric: { cases: 6, building_name: "Engineering Block" },
        }),
      ),
    ).toBe("Engineering Block has 6 separate cases in 30 days.");
    expect(
      describeAlert(
        alert({ rule_code: "LONG_UNRESOLVED", metric: { age_days: 20.9, target_days: 7 } }),
      ),
    ).toBe("Unresolved for 20.9 days against a 7-day target.");
  });

  it("never claims a prediction or a probability", () => {
    for (const rule of RULES) {
      const text = Object.values(RULE_TEXT[rule]).join(" ");
      expect(text).not.toMatch(/predict|probabilit|will fail|likely to fail|%/i);
    }
  });
});

describe("navigation (A0.02: switched-off features stay invisible)", () => {
  const hrefs = (options: Parameters<typeof navigationFor>[1]) =>
    navigationFor("admin", options).map((item) => item.href);

  it("shows the heatmap and insights only while their flags are on", () => {
    expect(hrefs({ aiJobs: false, heatmap: false, insights: false })).not.toEqual(
      expect.arrayContaining(["/admin/heatmap"]),
    );
    expect(hrefs({ aiJobs: false, heatmap: true, insights: false })).toContain("/admin/heatmap");
    expect(hrefs({ aiJobs: false, heatmap: false, insights: true })).toContain("/admin/insights");
    expect(navigationFor("student", { aiJobs: true, heatmap: true, insights: true })).toHaveLength(
      2,
    );
  });
});
