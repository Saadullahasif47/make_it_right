/**
 * Campus heatmap and maintenance insights journeys (plan v2 F5, F6, A6.01-A6.04), on desktop and
 * phone. An administrator reads the floor plans with the keyboard, drills into a room, places a
 * case on its equipment, refreshes the rules and acknowledges the alert they raise. Students and
 * switched-off deployments see none of it.
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  type TestUser,
} from "../integration/support/supabase";

import { FLAGGED_URL, signedIn } from "./support/evidence";
import { LOCAL_STACK_REASON, hasLocalStack } from "./support/local-stack";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

let student: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, admin] = await Promise.all([createTestUser("student"), createTestUser("admin")]);
});

/** Equipment rows this run created, removed once their cases are gone. */
const createdAssets: string[] = [];

test.afterAll(async () => {
  await deleteUsers([student.id]);
  // The reports are gone with their cases: let the rules forget them, then drop the equipment.
  await admin.client.rpc("admin_refresh_alerts");
  if (createdAssets.length > 0) {
    await adminClient().from("asset_registry").delete().in("id", createdAssets);
  }
  await deleteUsers([admin.id]);
});

/**
 * A fresh piece of equipment for this run (test fixture, written with the secret key), so
 * parallel projects and repeated runs never share an alert or its count.
 */
async function freshEquipment(building: string, room: string) {
  const code = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: place } = await adminClient()
    .from("maintenance_locations")
    .select("id")
    .eq("building_code", building)
    .eq("room_code", room)
    .single();
  const { data, error } = await adminClient()
    .from("asset_registry")
    .insert({
      location_id: place?.id ?? "",
      asset_code: code,
      asset_type: "water_cooler",
      label: "Test cooler",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdAssets.push(data?.id ?? "");
  return { id: data?.id ?? "", code, building, room, label: "Test cooler" };
}

async function reportIn(
  building: string,
  room: string,
): Promise<{ ticketId: string; caseId: string; version: number }> {
  const { data, error } = await student.client
    .rpc("create_ticket", {
      p_title: "Equipment keeps failing",
      p_description: "The same equipment has stopped working again.",
      p_building: building,
      p_room: room,
      p_idempotency_key: randomUUID(),
    })
    .single();
  expect(error).toBeNull();
  const { data: link } = await adminClient()
    .from("case_reports")
    .select("case:maintenance_cases!case_reports_case_id_fkey(id, version)")
    .eq("complaint_id", data?.id ?? "")
    .single();
  const caseRow = (link as unknown as { case: { id: string; version: number } }).case;
  return { ticketId: data?.id ?? "", caseId: caseRow.id, version: caseRow.version };
}

test("an administrator explores the heatmap by keyboard and opens a room's cases", async ({
  browser,
}) => {
  const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  await page.getByRole("link", { name: /^(Campus heatmap|Heatmap)$/ }).click();
  await expect(page).toHaveURL(/\/admin\/heatmap$/);
  await expect(page.getByRole("heading", { name: "Campus heatmap" })).toBeVisible();

  const plan = page.getByRole("group", { name: "Engineering Block · floor 2 floor plan" });
  await expect(plan).toBeVisible();
  const projectorLab = plan.getByRole("link", {
    name: /^LAB-204 \d+ cases?, Engineering Block, floor 2,/,
  });
  await expect(projectorLab).toHaveCount(1);
  await expect(
    page
      .getByRole("table", { name: "Rooms with cases, busiest first" })
      .getByRole("link", { name: "Engineering Block, LAB-204" }),
  ).toBeVisible();

  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);

  // Keyboard: the hotspot takes focus and Enter opens its cases.
  await projectorLab.focus();
  await expect(projectorLab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/room=[0-9a-f-]{36}/);
  const cases = page.getByRole("region", { name: "Engineering Block, LAB-204, floor 2" });
  await expect(cases.getByText("PRJ-ENG-204", { exact: false }).first()).toBeVisible();

  // A wider window keeps the room selected and shows its older cases too.
  await page.getByLabel("Opened in").selectOption("90");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/days=90/);
  await page.context().close();
});

test("an administrator places cases on equipment, refreshes the rules and acknowledges the alert", async ({
  browser,
}, testInfo) => {
  // Different rooms per project keep their building counts apart too.
  const mobile = testInfo.project.name === "mobile-chromium";
  const equipment = await freshEquipment(mobile ? "SCI" : "LIB", mobile ? "OFF-106" : "OFF-206");
  const reports = [
    await reportIn(equipment.building, equipment.room),
    await reportIn(equipment.building, equipment.room),
    await reportIn(equipment.building, equipment.room),
  ];

  const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  // The first case through the ticket page's picker; the rest through the same database function.
  const [first, ...rest] = reports;
  await page.goto(`/admin/complaints/${first?.ticketId ?? ""}`);
  const picker = page.getByRole("region", { name: "Room and equipment" });
  await picker
    .getByLabel("Equipment (optional)")
    .selectOption({ label: `${equipment.code}: ${equipment.label} (${equipment.room})` });
  await picker.getByRole("button", { name: "Save location" }).click();
  await expect(page.getByText("Location saved.", { exact: false })).toBeVisible();
  for (const item of rest) {
    const placed = await admin.client.rpc("set_case_location", {
      p_case_id: item.caseId,
      p_expected_version: item.version,
      p_asset_id: equipment.id,
    });
    expect(placed.error).toBeNull();
  }

  await page.goto("/admin/insights");
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByText("Rules checked against the latest cases.")).toBeVisible();
  const card = page
    .getByRole("listitem")
    .filter({ hasText: `${equipment.code} (${equipment.label}) has 3 separate cases in 30 days.` });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("list", { name: "Evidence cases" }).getByRole("link")).toHaveCount(3);
  await expect(page.getByText("not a trained prediction", { exact: false })).toBeVisible();

  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);

  await card.getByLabel("Note (optional)").fill("Technician booked for Friday.");
  await card.getByRole("button", { name: "Acknowledge" }).click();
  await expect(
    page.getByText("Acknowledged. The alert stays listed", { exact: false }),
  ).toBeVisible();
  const acknowledged = page
    .getByRole("listitem")
    .filter({ hasText: `${equipment.code} (${equipment.label})` });
  await expect(acknowledged.getByText("Acknowledged", { exact: true })).toBeVisible();
  await expect(
    acknowledged.getByText("Technician booked for Friday.", { exact: false }),
  ).toBeVisible();

  // The JSON API returns the same alert.
  const response = await page.request.get("/api/admin/maintenance-insights?weeks=8");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    alerts: { asset: { code: string } | null; status: string }[];
    trend: unknown[];
  };
  expect(body.trend).toHaveLength(8);
  expect(body.alerts.find((alert) => alert.asset?.code === equipment.code)?.status).toBe(
    "acknowledged",
  );
  await page.context().close();
});

test("students never see institutional analytics", async ({ browser }) => {
  const page = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
  await expect(page.getByRole("link", { name: /Heatmap|Insights/ })).toHaveCount(0);
  await page.goto("/admin/heatmap");
  await expect(
    page.getByRole("heading", { name: "You do not have access to this page" }),
  ).toBeVisible();
  for (const path of ["/api/admin/heatmap", "/api/admin/maintenance-insights"]) {
    expect((await page.request.get(path)).status()).toBe(403);
  }
  await page.context().close();
});

test("with both features off, there is no page, link or API", async ({ browser, baseURL }) => {
  const page = await signedIn(browser, baseURL ?? "", admin, /\/admin$/);
  await expect(page.getByRole("link", { name: /Heatmap|Insights/ })).toHaveCount(0);
  for (const path of ["/admin/heatmap", "/admin/insights"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
  }
  for (const path of ["/api/admin/heatmap", "/api/admin/maintenance-insights"]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
  await page.context().close();
});
