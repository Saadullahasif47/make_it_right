/**
 * Repair verification journeys (plan v2 F4, A5.01-A5.03), on desktop and phone. The department
 * adds before and after photos through the real file chooser, the worker (as Cron would run it)
 * compares them against the Gemini stub, and the reporter decides "Is it fixed?". The AI never
 * closes anything.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "../integration/support/supabase";

import { FLAGGED_URL, signedIn } from "./support/evidence";
import { LOCAL_STACK_REASON, hasLocalStack } from "./support/local-stack";
import { runWorker } from "./support/worker";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const BEFORE = join(process.cwd(), "tests", "fixtures", "evidence", "synthetic-sink.png");
const AFTER = join(
  process.cwd(),
  "tests",
  "eval",
  "visual",
  "images",
  "v02-clear-dripping_tap.png",
);
const TITLE = "Broken chair in the study room";

const cleanup: string[] = [];
let reporter: TestUser;
let carpenter: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [reporter, carpenter, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "furniture"),
    createTestUser("admin"),
  ]);
  cleanup.push(reporter.id, carpenter.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

async function ticketVersion(ticketId: string): Promise<number> {
  const { data } = await adminClient()
    .from("complaints")
    .select("version")
    .eq("id", ticketId)
    .single();
  return data?.version ?? 0;
}

async function move(user: TestUser, ticketId: string, target: "in_progress" | "resolved") {
  const { error } = await user.client.rpc("transition_ticket", {
    p_ticket_id: ticketId,
    p_target: target,
    p_expected_version: await ticketVersion(ticketId),
    ...(target === "resolved" ? { p_note: "Replaced the cracked chair leg." } : {}),
  });
  expect(error).toBeNull();
}

/** A furniture report routed to the carpenters directly (no triage), with its case id. */
async function routedReport(): Promise<{ ticketId: string; caseId: string }> {
  const { data, error } = await reporter.client
    .rpc("create_ticket", {
      p_title: TITLE,
      p_description: "The chair by the window has a cracked leg.",
      p_building: `Library ${randomUUID().slice(0, 6)}`,
      p_room: "S-1",
      p_idempotency_key: randomUUID(),
    })
    .single();
  expect(error).toBeNull();
  const ticketId = data?.id ?? "";
  const assigned = await admin.client.rpc("assign_ticket", {
    p_ticket_id: ticketId,
    p_department_id: await departmentId("furniture"),
    p_category: "furniture",
    p_priority: "medium",
    p_expected_version: 1,
  });
  expect(assigned.error).toBeNull();
  const { data: link } = await adminClient()
    .from("case_reports")
    .select("case_id")
    .eq("complaint_id", ticketId)
    .single();
  return { ticketId, caseId: link?.case_id ?? "" };
}

/** Runs the worker until the case's comparison has a result. */
async function untilCompared(caseId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await runWorker();
        const { data } = await adminClient()
          .from("verification_reviews")
          .select("ai_status")
          .eq("case_id", caseId)
          .order("created_at", { ascending: false })
          .limit(1);
        return data?.[0]?.ai_status ?? null;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();
}

async function choose(page: Page, button: string, file: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button }).click();
  await (await chooser).setFiles(file);
}

const panel = (page: Page) => page.getByRole("region", { name: "Repair verification" });

test("the department adds before and after photos and the reporter confirms the fix", async ({
  browser,
}) => {
  const { ticketId, caseId } = await routedReport();

  const staff = await signedIn(browser, FLAGGED_URL, carpenter, /\/department$/);
  await staff.goto(`/department/${ticketId}`);
  await expect(panel(staff)).toBeVisible();
  await choose(staff, "Add a before photo", BEFORE);
  await expect(panel(staff).getByText("Before photo added.")).toBeVisible({ timeout: 20_000 });
  await choose(staff, "Add an after photo", AFTER);
  // The page refreshes into the comparison card (its success message goes with the uploader).
  await expect(panel(staff).getByRole("article", { name: "Photo comparison" })).toBeVisible({
    timeout: 20_000,
  });

  await untilCompared(caseId);
  await staff.reload();
  await expect(panel(staff).getByText("AI suggestion: Looks improved")).toBeVisible();
  await expect(panel(staff).getByText("no functional test", { exact: false })).toBeVisible();
  // One after photo at a time: the next waits for a decision.
  await expect(panel(staff).getByRole("button", { name: "Add an after photo" })).toHaveCount(0);
  await staff.context().close();

  // The comparison alone changed nothing.
  const { data: before } = await adminClient()
    .from("complaints")
    .select("status")
    .eq("id", ticketId)
    .single();
  expect(before?.status).toBe("assigned");
  await move(carpenter, ticketId, "in_progress");
  await move(carpenter, ticketId, "resolved");

  const page = await signedIn(browser, FLAGGED_URL, reporter, /\/student\/complaints$/);
  await page.goto(`/student/complaints/${ticketId}`);
  const verification = panel(page);
  await expect(verification.getByText("AI suggestion: Looks improved")).toBeVisible();
  await expect(verification.getByRole("img", { name: "After the repair" })).toBeVisible();
  await expect(
    verification.getByText("Check the photos, then answer", { exact: false }),
  ).toBeVisible();
  // The reporter sees the photos but can never add repair evidence.
  await expect(
    verification.getByRole("button", { name: /Add an? (before|after) photo/ }),
  ).toHaveCount(0);

  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);

  await page.getByRole("button", { name: "Yes, it is fixed" }).click();
  await expect(page.getByText("Thanks for confirming. This ticket is now closed.")).toBeVisible();
  await expect(panel(page).getByText("Repair confirmed by a person")).toBeVisible();
  await page.context().close();
});

test("through the API: staff upload, the reporter disputes, and roles are enforced", async ({
  browser,
}) => {
  const { ticketId, caseId } = await routedReport();
  await move(carpenter, ticketId, "in_progress");

  const staff = await signedIn(browser, FLAGGED_URL, carpenter, /\/department$/);
  const bytes = readFileSync(AFTER);
  const reserved = await staff.request.post(`/api/cases/${caseId}/repair-evidence`, {
    headers: { origin: FLAGGED_URL },
    data: { kind: "after", mimeType: "image/png", byteSize: bytes.byteLength },
  });
  expect(reserved.status()).toBe(201);
  const slot = (await reserved.json()) as { attachmentId: string; uploadUrl: string };
  const stored = await fetch(slot.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "image/png", "x-upsert": "false" },
    body: bytes,
  });
  expect(stored.ok).toBe(true);
  const finalized = await staff.request.post(`/api/cases/${caseId}/repair-evidence/finalize`, {
    headers: { origin: FLAGGED_URL },
    data: { attachmentId: slot.attachmentId },
  });
  expect(finalized.status()).toBe(200);
  const { reviewId } = (await finalized.json()) as { reviewId: string };
  await untilCompared(caseId);
  await move(carpenter, ticketId, "resolved");

  // The department cannot judge its own repair.
  const ownVerdict = await staff.request.post(`/api/cases/${caseId}/verification-decision`, {
    headers: { origin: FLAGGED_URL },
    data: { reviewId, confirm: true },
  });
  expect(ownVerdict.status()).toBe(403);
  await staff.context().close();

  const page = await signedIn(browser, FLAGGED_URL, reporter, /\/student\/complaints$/);
  const upload = await page.request.post(`/api/cases/${caseId}/repair-evidence`, {
    headers: { origin: FLAGGED_URL },
    data: { kind: "after", mimeType: "image/png", byteSize: 100 },
  });
  expect(upload.status()).toBe(403);
  const disputed = await page.request.post(`/api/cases/${caseId}/verification-decision`, {
    headers: { origin: FLAGGED_URL },
    data: { reviewId, confirm: false, note: "The chair still wobbles." },
  });
  expect(disputed.status()).toBe(200);
  expect(await disputed.json()).toMatchObject({ caseStatus: "reopened" });
  const again = await page.request.post(`/api/cases/${caseId}/verification-decision`, {
    headers: { origin: FLAGGED_URL },
    data: { reviewId, confirm: true },
  });
  expect(again.status()).toBe(409);

  await page.goto(`/student/complaints/${ticketId}`);
  await expect(panel(page).getByText("Sent back for more work")).toBeVisible();
  await expect(panel(page).getByText("“The chair still wobbles.”")).toBeVisible();
  await page.context().close();
});

test("with repair verification off, there is no panel and no API", async ({ browser, baseURL }) => {
  const origin = baseURL ?? "";
  const { ticketId, caseId } = await routedReport();
  const staff = await signedIn(browser, origin, carpenter, /\/department$/);
  await staff.goto(`/department/${ticketId}`);
  await expect(staff.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(panel(staff)).toHaveCount(0);
  const reserve = await staff.request.post(`/api/cases/${caseId}/repair-evidence`, {
    headers: { origin },
    data: { kind: "before", mimeType: "image/png", byteSize: 100 },
  });
  expect(reserve.status()).toBe(404);
  await staff.context().close();

  const page = await signedIn(browser, origin, reporter, /\/student\/complaints$/);
  const decide = await page.request.post(`/api/cases/${caseId}/verification-decision`, {
    headers: { origin },
    data: { reviewId: randomUUID(), confirm: true },
  });
  expect(decide.status()).toBe(404);
  await page.context().close();
});
