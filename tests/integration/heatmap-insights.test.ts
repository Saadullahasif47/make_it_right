/**
 * Campus heatmap and maintenance insights against the real local database (plan v2 F5, F6,
 * A6.01-A6.04): counts follow real cases as they change, only administrators read analytics, and
 * repeated refreshes never duplicate an alert.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { heatmapSchema, type Heatmap } from "@/features/heatmap/schemas";
import { insightsSchema } from "@/features/insights/schemas";

import { adminClient, createTestUser, deleteUsers, type TestUser } from "./support/supabase";

let student: TestUser;
let electrician: TestUser;
let admin: TestUser;

beforeAll(async () => {
  [student, electrician, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "electrical"),
    createTestUser("admin"),
  ]);
});

afterAll(async () => {
  await deleteUsers([student.id, electrician.id]);
  // The reports above are gone with their cases: let the rules forget them too.
  const refreshed = await admin.client.rpc("admin_refresh_alerts");
  expect(refreshed.error).toBeNull();
  await deleteUsers([admin.id]);
});

async function location(building: string, room: string): Promise<string> {
  const { data } = await adminClient()
    .from("maintenance_locations")
    .select("id")
    .eq("building_code", building)
    .eq("room_code", room)
    .single();
  return data?.id ?? "";
}

async function assetId(code: string): Promise<string> {
  const { data } = await adminClient()
    .from("asset_registry")
    .select("id")
    .eq("asset_code", code)
    .single();
  return data?.id ?? "";
}

async function heatmap(): Promise<Heatmap> {
  const { data, error } = await admin.client.rpc("admin_heatmap", {
    p_days: 30,
    p_building: "SCI",
    p_include_synthetic: false,
  });
  if (error !== null) throw new Error(`${error.code} ${error.message}`);
  return heatmapSchema.parse(data);
}

const roomCount = (map: Heatmap, locationId: string) =>
  map.rooms.find((room) => room.location_id === locationId)?.cases ?? -1;

async function report(
  room: string,
): Promise<{ ticketId: string; caseId: string; version: number }> {
  const { data, error } = await student.client
    .rpc("create_ticket", {
      p_title: "Air conditioning not cooling",
      p_description: "The split AC unit blows warm air all afternoon.",
      p_building: "Science Block",
      p_room: room,
      p_idempotency_key: randomUUID(),
    })
    .single();
  if (error !== null) throw new Error(error.message);
  const { data: link } = await adminClient()
    .from("case_reports")
    .select("case:maintenance_cases!case_reports_case_id_fkey(id, version)")
    .eq("complaint_id", data.id)
    .single();
  const caseRow = (link as unknown as { case: { id: string; version: number } }).case;
  return { ticketId: data.id, caseId: caseRow.id, version: caseRow.version };
}

describe("heatmap (A6.01-A6.02)", () => {
  it("counts a new report's case in its room and follows it when staff move it", async () => {
    const lab204 = await location("SCI", "LAB-204");
    const lab103 = await location("SCI", "LAB-103");
    const before = await heatmap();

    const { caseId, version } = await report("LAB-204");
    const after = await heatmap();
    expect(roomCount(after, lab204)).toBe(roomCount(before, lab204) + 1);
    expect(after.totals.reports).toBe(before.totals.reports + 1);

    const moved = await admin.client.rpc("set_case_location", {
      p_case_id: caseId,
      p_expected_version: version,
      p_location_id: lab103,
    });
    expect(moved.error).toBeNull();
    const later = await heatmap();
    expect(roomCount(later, lab204)).toBe(roomCount(before, lab204));
    expect(roomCount(later, lab103)).toBe(roomCount(before, lab103) + 1);
  });

  it("is for administrators only", async () => {
    for (const user of [student, electrician]) {
      const { error } = await user.client.rpc("admin_heatmap", { p_days: 30 });
      expect(error?.code).toBe("MR403");
      const insights = await user.client.rpc("admin_maintenance_insights", {});
      expect(insights.error?.code).toBe("MR403");
      const alerts = await user.client.from("maintenance_alerts").select("id");
      expect(alerts.data).toEqual([]);
    }
  });
});

describe("insights (A6.03-A6.04)", () => {
  it("raises a repeat-failure alert from real cases once, however often it refreshes", async () => {
    const unit = await assetId("ACU-SCI-103");
    // The seeded history has one case on this AC unit; two real reports make three.
    for (let n = 0; n < 2; n += 1) {
      const { caseId, version } = await report("LAB-103");
      const placed = await admin.client.rpc("set_case_location", {
        p_case_id: caseId,
        p_expected_version: version,
        p_asset_id: unit,
      });
      expect(placed.error).toBeNull();
    }

    const first = await admin.client.rpc("admin_refresh_alerts");
    expect(first.error).toBeNull();
    const second = await admin.client.rpc("admin_refresh_alerts");
    expect(second.data).toMatchObject({ raised: 0 });

    const { data, error } = await admin.client.rpc("admin_maintenance_insights", { p_weeks: 12 });
    expect(error).toBeNull();
    const insights = insightsSchema.parse(data);
    const alerts = insights.alerts.filter(
      (alert) => alert.rule_code === "REPEAT_30D" && alert.asset?.code === "ACU-SCI-103",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.cases).toHaveLength(3);
    expect(alerts[0]?.refresh_count).toBeGreaterThanOrEqual(2);
    // Every alert links back to its cases.
    expect(insights.alerts.every((alert) => alert.cases.length > 0)).toBe(true);
    expect(insights.trend).toHaveLength(12);
    expect(insights.ranked_assets[0]?.cases).toBeGreaterThanOrEqual(3);
  });
});
