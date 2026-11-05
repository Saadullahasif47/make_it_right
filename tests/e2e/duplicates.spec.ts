/**
 * Duplicate detection journeys (plan v2 F2, A3.02-A3.03), on desktop and phone. Two students
 * report the same problem; the worker (as Cron would run it) embeds and ranks them against the
 * Gemini stub; an administrator decides. Nothing is ever linked without that decision.
 */
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

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
let first: TestUser;
let second: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [first, second, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("student"),
    createTestUser("admin"),
  ]);
  cleanup.push(first.id, second.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

const LEAK_TITLE = "Water leaking under the washroom sink";
const LEAK_TEXT = "Water is leaking under the washroom sink and the floor is wet near the basin.";

async function reportVia(
  page: Page,
  title: string,
  description: string,
  building: string,
): Promise<string> {
  await page.goto("/student/complaints/new");
  await page.getByLabel("What is wrong?").fill(title);
  await page.getByLabel("Building").fill(building);
  await page.getByLabel("Room (optional)").fill("WC-1");
  await page.getByLabel("Describe the problem").fill(description);
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page).toHaveURL(/\/student\/complaints\/[0-9a-f-]{36}\?notice=/, {
    timeout: 20_000,
  });
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

/** Runs the worker until the report's duplicate match has finished. */
async function untilMatched(ticketId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await runWorker();
        const { data } = await adminClient()
          .from("ai_jobs")
          .select("status")
          .eq("job_type", "duplicate_match")
          .eq("target_id", ticketId);
        return data?.[0]?.status;
      },
      { timeout: 30_000 },
    )
    .toBe("succeeded");
}

/** Two students report the same leak in a building of their own; returns both ticket ids. */
async function twoReports(browser: Browser): Promise<{ original: string; duplicate: string }> {
  const building = `Block ${randomUUID().slice(0, 6)}`;
  const firstPage = await signedIn(browser, FLAGGED_URL, first, /\/student\/complaints$/);
  const original = await reportVia(firstPage, LEAK_TITLE, LEAK_TEXT, building);
  await firstPage.context().close();
  await untilMatched(original);

  const secondPage = await signedIn(browser, FLAGGED_URL, second, /\/student\/complaints$/);
  const duplicate = await reportVia(secondPage, LEAK_TITLE, `${LEAK_TEXT} Again.`, building);
  await secondPage.context().close();
  await untilMatched(duplicate);
  return { original, duplicate };
}

const panel = (page: Page) => page.getByRole("region", { name: /Possible duplicates|Shared case/ });

test("an admin links two reports of the same leak; both stay separate reports", async ({
  browser,
}) => {
  const { original, duplicate } = await twoReports(browser);

  const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  await page.goto(`/admin/complaints/${duplicate}`);
  const candidates = panel(page);
  await expect(candidates.getByRole("heading", { name: "Possible duplicates" })).toBeVisible();
  await expect(candidates.getByText("They are suggestions", { exact: false })).toBeVisible();
  await expect(candidates.getByText(LEAK_TITLE)).toBeVisible();
  await expect(candidates.getByText("Same room")).toBeVisible();
  // Nothing is linked yet: each report still has its own case.
  const { data: before } = await adminClient()
    .from("case_reports")
    .select("case_id")
    .in("complaint_id", [original, duplicate]);
  expect(new Set(before?.map((row) => row.case_id)).size).toBe(2);

  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);

  await candidates.getByRole("button", { name: /^Same problem: link/ }).click();
  await expect(page.getByText("Linked. This report now follows the shared case.")).toBeVisible();
  const shared = panel(page);
  await expect(shared.getByRole("heading", { name: "Shared case" })).toBeVisible();
  await expect(shared.getByText("brings together 2 reports", { exact: false })).toBeVisible();
  await page.context().close();

  // The second reporter sees their own report, now marked as linked.
  const reporter = await signedIn(browser, FLAGGED_URL, second, /\/student\/complaints$/);
  await reporter.goto(`/student/complaints/${duplicate}`);
  await expect(reporter.getByText("Linked with other reports", { exact: true })).toBeVisible();
  await expect(reporter.getByRole("heading", { name: LEAK_TITLE })).toBeVisible();
  await reporter.context().close();
});

test("an admin marks a candidate as a different problem and nothing is linked", async ({
  browser,
}) => {
  const { original, duplicate } = await twoReports(browser);

  const page = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  await page.goto(`/admin/complaints/${duplicate}`);
  await panel(page)
    .getByRole("button", { name: /^Different problem/ })
    .click();
  await expect(page.getByText("Marked as a different problem.")).toBeVisible();
  await expect(panel(page).getByText("Different problem", { exact: true })).toBeVisible();
  await page.context().close();

  const { data: after } = await adminClient()
    .from("case_reports")
    .select("case_id")
    .in("complaint_id", [original, duplicate]);
  expect(new Set(after?.map((row) => row.case_id)).size).toBe(2);
});

test("with duplicate detection off, there is no panel and no API", async ({ browser, baseURL }) => {
  const origin = baseURL ?? "";
  const reporter = await signedIn(browser, origin, first, /\/student\/complaints$/);
  const ticketId = await reportVia(reporter, LEAK_TITLE, LEAK_TEXT, "Block Off");
  await reporter.context().close();

  const page = await signedIn(browser, origin, admin, /\/admin$/);
  await page.goto(`/admin/complaints/${ticketId}`);
  await expect(page.getByRole("heading", { name: LEAK_TITLE })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  const response = await page.request.get(`/api/complaints/${ticketId}/match-candidates`);
  expect(response.status()).toBe(404);
  const { data: jobs } = await adminClient().from("ai_jobs").select("id").eq("target_id", ticketId);
  expect(jobs).toEqual([]);
  await page.context().close();
});
