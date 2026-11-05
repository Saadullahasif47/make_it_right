/**
 * AI visual inspection journeys (plan v2 F1, A2.01-A2.02), on desktop and phone. The photo is
 * analysed by the real Edge Function worker against the Gemini stub; the test runs the worker
 * the way Supabase Cron would.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  adminClient,
  createTestUser,
  deleteUsers,
  departmentId,
  type TestUser,
} from "../integration/support/supabase";

import { FLAGGED_URL, choosePhoto, photoJobsFor, report, signedIn } from "./support/evidence";
import { LOCAL_STACK_REASON, hasLocalStack } from "./support/local-stack";
import { runWorker } from "./support/worker";

test.skip(!hasLocalStack(), LOCAL_STACK_REASON);
test.use({ baseURL: FLAGGED_URL });

const cleanup: string[] = [];
let student: TestUser;
let plumber: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [student, plumber, admin] = await Promise.all([
    createTestUser("student"),
    createTestUser("department", "plumbing"),
    createTestUser("admin"),
  ]);
  cleanup.push(student.id, plumber.id, admin.id);
});

test.afterAll(async () => {
  await deleteUsers(cleanup);
});

/** Reports, adds the synthetic photo, and runs the worker until the photo is analysed. */
async function analysedReport(page: Page, note = ""): Promise<string> {
  const ticketId = await report(page, note);
  await choosePhoto(page, "synthetic-sink.png");
  await expect(page.getByText("Photo added.", { exact: false })).toBeVisible();
  await expect
    .poll(
      async () => {
        await runWorker();
        return (await photoJobsFor(ticketId)).jobs[0]?.status;
      },
      { timeout: 30_000 },
    )
    .toBe("succeeded");
  return ticketId;
}

const photos = (page: Page) => page.getByRole("region", { name: "Photos" });

test("the reporter sees what the AI observed, labelled as a suggestion, and confirms it", async ({
  browser,
}) => {
  const page = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
  const ticketId = await analysedReport(page);

  // Leaving and coming back loses nothing: the analysis is stored server-side.
  await page.goto("/student/complaints");
  await page.goto(`/student/complaints/${ticketId}`);
  const section = photos(page);
  await expect(section.getByText("AI observation", { exact: true })).toBeVisible();
  await expect(section.getByText("A suggestion, not a finding. It may be wrong.")).toBeVisible();
  await expect(section.getByText("Plumbing", { exact: true })).toBeVisible();
  await expect(section.getByText("the cause is not visible")).toBeVisible();
  await expect(section.getByText("Needs a person to check")).toHaveCount(0);

  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);

  await section.getByRole("button", { name: "Looks right" }).click();
  await expect(section.getByText("Thanks, your response is recorded.")).toBeVisible();
  await page.reload();
  await expect(photos(page).getByText("Confirmed")).toBeVisible();
  await page.context().close();
});

test("a photo that contradicts the report is flagged for a person, and a dispute needs a reason", async ({
  browser,
}) => {
  const page = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
  const ticketId = await analysedReport(page, "STUB:VISION-MISMATCH");
  await page.goto(`/student/complaints/${ticketId}`);

  const section = photos(page);
  await expect(section.getByText("Needs a person to check")).toBeVisible();
  await expect(section.getByText("The photo and the written report do not match")).toBeVisible();

  await section.getByRole("button", { name: "Something is wrong" }).click();
  await expect(section.getByText("Say what the AI got wrong.")).toBeVisible();
  await section.getByLabel(/^Note/).fill("The water comes from the tap above, not the pipe.");
  await section.getByRole("button", { name: "Something is wrong" }).click();
  await expect(section.getByText("Thanks, your response is recorded.")).toBeVisible();
  await page.context().close();
});

test("an admin corrects the category and the assigned department sees the analysis read-only", async ({
  browser,
}) => {
  const studentPage = await signedIn(browser, FLAGGED_URL, student, /\/student\/complaints$/);
  const ticketId = await analysedReport(studentPage);
  await studentPage.context().close();

  const adminPage = await signedIn(browser, FLAGGED_URL, admin, /\/admin$/);
  await adminPage.goto(`/admin/complaints/${ticketId}`);
  const section = photos(adminPage);
  await expect(section.getByText("AI observation", { exact: true })).toBeVisible();
  await section.getByLabel("Correct category (optional)").selectOption("sanitation");
  await section.getByLabel(/^Note/).fill("Spilt cleaning water, not a leak.");
  await section.getByRole("button", { name: "Save correction" }).click();
  await expect(section.getByText("Thanks, your response is recorded.")).toBeVisible();
  await adminPage.reload();
  await expect(
    photos(adminPage).getByText("by an administrator: category Sanitation", { exact: false }),
  ).toBeVisible();
  await adminPage.context().close();

  // This server's AI triage (the Gemini stub) usually routes the report to plumbing already;
  // route it by hand only if it did not, then look as the department.
  const plumbing = await departmentId("plumbing");
  const { data: ticket } = await adminClient()
    .from("complaints")
    .select("version, assigned_department_id")
    .eq("id", ticketId)
    .single();
  if (ticket?.assigned_department_id !== plumbing) {
    const assigned = await admin.client.rpc("assign_ticket", {
      p_ticket_id: ticketId,
      p_department_id: plumbing,
      p_category: "plumbing",
      p_priority: "medium",
      p_expected_version: ticket?.version ?? 0,
    });
    expect(assigned.error).toBeNull();
  }

  const staffPage = await signedIn(browser, FLAGGED_URL, plumber, /\/department$/);
  await staffPage.goto(`/department/${ticketId}`);
  const staffSection = photos(staffPage);
  await expect(
    staffSection.getByRole("img", { name: "Photo 1 attached to this report" }),
  ).toBeVisible();
  await expect(staffSection.getByText("AI observation", { exact: true })).toBeVisible();
  await expect(staffSection.getByRole("button", { name: "Looks right" })).toHaveCount(0);
  await expect(staffSection.getByRole("button", { name: "Add a photo" })).toHaveCount(0);
  await staffPage.context().close();
});
