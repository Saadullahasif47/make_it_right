/**
 * Maintenance coordinator journeys (plan v2 F3, A4.03), on desktop and phone. An administrator
 * asks the coordinator about a case; the worker (as Cron would run it) runs the bounded tool loop
 * against the Gemini stub; a high-priority proposal waits in the review queue until the
 * administrator approves it, and the department then sees its work order.
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  type TestUser,
} from "../integration/support/supabase";

import { FLAGGED_URL, signedIn } from "./support/evidence";
import { LOCAL_STACK_REASON, hasLocalStack } from "./support/local-stack";
import { runWorker } from "./support/worker";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);

const cleanup: string[] = [];
let student: TestUser;
let carpenter: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, carpenter, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "furniture"),
    createTestUser("admin"),
  ]);
  cleanup.push(student.id, carpenter.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

const TITLE = "Broken chair in the reading room";

/**
 * Files a report as the student and waits until the triage agent has finished with it. The
 * report mentions an injury, so triage always leaves it for a person (BR-08) and the
 * coordinator is the one proposing its route.
 */
async function reportChair(page: Page, marker: string): Promise<string> {
  await page.goto("/student/complaints/new");
  await page.getByLabel("What is wrong?").fill(TITLE);
  await page.getByLabel("Building").fill(`Library ${randomUUID().slice(0, 6)}`);
  await page.getByLabel("Room (optional)").fill("R-2");
  await page
    .getByLabel("Describe the problem")
    .fill(`The chair by the window collapsed and a student was injured. ${marker}`);
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page).toHaveURL(/\/student\/complaints\/[0-9a-f-]{36}\?notice=/, {
    timeout: 20_000,
  });
  const ticketId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await expect
    .poll(
      async () => {
        const { data } = await adminClient()
          .from("complaints")
          .select("status")
          .eq("id", ticketId)
          .single();
        return data?.status;
      },
      { timeout: 30_000 },
    )
    .not.toMatch(/^(submitted|triaging)$/);
  return ticketId;
}

async function caseOf(ticketId: string): Promise<string> {
  const { data } = await adminClient()
    .from("case_reports")
    .select("case_id")
    .eq("complaint_id", ticketId)
    .single();
  return data?.case_id ?? "";
}

/** Runs the worker until the case's coordination job has finished. */
async function untilCoordinated(caseId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await runWorker();
        const { data } = await adminClient()
          .from("ai_jobs")
          .select("status")
          .eq("job_type", "coordination")
          .eq("target_id", caseId);
        return data?.every((job) => job.status === "succeeded") && data.length > 0;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

const panel = (page: Page) => page.getByRole("region", { name: "Work order", exact: true });

test("an admin approves a high-priority work order the coordinator proposed", async ({
  browser,
}) => {
  const reporter = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
  const ticketId = await reportChair(reporter, "STUB:COORD-HIGH");
  await reporter.context().close();
  const caseId = await caseOf(ticketId);

  const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  await page.goto(`/admin/complaints/${ticketId}`);
  await panel(page).getByRole("button", { name: "Ask the coordinator" }).click();
  await expect(
    page.getByText("The coordinator is looking at this case.", { exact: false }),
  ).toBeVisible();
  await expect(panel(page).getByText("The coordinator is working on this case.")).toBeVisible();

  await untilCoordinated(caseId);

  // The review queue lists the proposal and links to the ticket.
  await page.goto("/admin/review");
  const queue = page.getByRole("region", { name: /Work orders awaiting approval/ });
  await expect(queue).toBeVisible();
  await queue.locator(`a[href="/admin/complaints/${ticketId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/complaints/${ticketId}$`));

  const work = panel(page);
  await expect(work.getByText("Proposal waiting for your approval")).toBeVisible();
  await expect(
    work.getByRole("list", { name: "Approval reasons" }).getByText("High priority"),
  ).toBeVisible();
  await expect(
    work
      .getByRole("list", { name: "Approval reasons" })
      .getByText("possible hazard", { exact: false }),
  ).toBeVisible();
  await expect(work.getByText("Furniture and Fixtures").first()).toBeVisible();

  // The readable trace: which tools the model asked for, in order.
  await work.locator("summary").first().click();
  const calls = work.getByRole("list", { name: "Tool calls" });
  await expect(
    calls.getByText("Checked a department's open work orders", { exact: false }),
  ).toBeVisible();
  await expect(calls.getByText("Proposed a work order", { exact: false })).toBeVisible();
  await expect(work.getByText("coordinator-v1", { exact: false })).toBeVisible();

  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);

  await work.getByLabel("Note (optional)").fill("Checked with the library: urgent.");
  await work.getByRole("button", { name: "Approve work order" }).click();
  await expect(page.getByText("Approved. The department now has the work order.")).toBeVisible();
  await expect(
    panel(page).getByText("proposed by the AI coordinator, approved by an administrator", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(panel(page).getByText("Proposal waiting for your approval")).toHaveCount(0);
  await page.context().close();

  const { data: orders } = await adminClient()
    .from("case_work_orders")
    .select("source, status")
    .eq("case_id", caseId)
    .eq("status", "active");
  expect(orders).toEqual([{ source: "admin_approved", status: "active" }]);

  // The department sees its work order and its API answers; another case stays hidden.
  const staff = await signedIn(browser, FLAGGED_URL, carpenter, /\/department$/);
  await staff.goto(`/department/${ticketId}`);
  await expect(panel(staff).getByText("Furniture and Fixtures", { exact: false })).toBeVisible();
  await expect(panel(staff).getByText("Coordinator runs")).toHaveCount(0);
  const response = await staff.request.get(`/api/cases/${caseId}/work-orders`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { workOrders: { source: string; status: string }[] };
  expect(body.workOrders[0]).toMatchObject({ source: "admin_approved", status: "active" });
  const hidden = await staff.request.get(`/api/cases/${randomUUID()}/work-orders`);
  expect(hidden.status()).toBe(404);
  await staff.context().close();
});

test("an admin rejects a proposal and the case stays for manual routing", async ({ browser }) => {
  const reporter = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
  const ticketId = await reportChair(reporter, "STUB:COORD-HIGH");
  await reporter.context().close();
  const caseId = await caseOf(ticketId);

  const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  // The JSON API queues the same bounded job as the button.
  const queued = await page.request.post(`/api/cases/${caseId}/coordinate`, {
    headers: { origin: FLAGGED_URL },
  });
  expect(queued.status()).toBe(202);
  await untilCoordinated(caseId);

  await page.goto(`/admin/complaints/${ticketId}`);
  await panel(page).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Proposal rejected. The case is yours to route.")).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Ask the coordinator again" }),
  ).toBeVisible();
  await page.context().close();

  const { data: proposals } = await adminClient()
    .from("work_order_proposals")
    .select("status, decided_by")
    .eq("case_id", caseId);
  expect(proposals).toEqual([{ status: "rejected", decided_by: admin.id }]);
});

test("with the coordinator off, there is no panel and no API", async ({ browser, baseURL }) => {
  const origin = baseURL ?? "";
  const reporter = await signedIn(browser, origin, student, /\/student\/complaints$/);
  await reporter.goto("/student/complaints/new");
  await reporter.getByLabel("What is wrong?").fill(TITLE);
  await reporter.getByLabel("Building").fill("Library Off");
  await reporter
    .getByLabel("Describe the problem")
    .fill("The chair by the window has a cracked leg.");
  await reporter.getByRole("button", { name: "Submit report" }).click();
  await expect(reporter).toHaveURL(/\/student\/complaints\/[0-9a-f-]{36}\?notice=/, {
    timeout: 20_000,
  });
  const ticketId = new URL(reporter.url()).pathname.split("/").at(-1) ?? "";
  await reporter.context().close();
  const caseId = await caseOf(ticketId);

  const page = await signedIn(browser, origin, admin, /\/admin$/);
  await page.goto(`/admin/complaints/${ticketId}`);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  // Manual routing is still there (F3.05: disable agent -> manual routing still works).
  await expect(page.getByRole("button", { name: /Assign/ }).first()).toBeVisible();
  const post = await page.request.post(`/api/cases/${caseId}/coordinate`, { headers: { origin } });
  expect(post.status()).toBe(404);
  const get = await page.request.get(`/api/cases/${caseId}/work-orders`);
  expect(get.status()).toBe(404);
  await page.goto("/admin/review");
  await expect(page.getByRole("region", { name: /Work orders awaiting approval/ })).toHaveCount(0);
  await page.context().close();
});
